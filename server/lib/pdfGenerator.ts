import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { amountInWordsINR, buildUpiUri, round2 } from '../../shared/billing';

function formatPdfINR(amount: number | string | null | undefined): string {
  const n = round2(Number(amount ?? 0));
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return `Rs. ${formatted}`;
}

function decodeDataUrlImage(dataUrl?: string | null): Buffer | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
  if (!m?.[2]) return null;
  try {
    return Buffer.from(m[2], 'base64');
  } catch {
    return null;
  }
}

function docToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function drawBusinessHeader(
  doc: PDFKit.PDFDocument,
  settings: any,
  title: string,
  docNumber: string,
  metaLines: Array<{ label: string; value: string }>,
  stampText?: string | null
): number {
  const pageWidth = doc.page.width;
  const left = 42;
  const right = pageWidth - 42;
  let y = 40;

  const logoBuf = decodeDataUrlImage(settings?.logoDataUrl);
  let textStartX = left;
  if (logoBuf) {
    try {
      doc.image(logoBuf, left, y, { fit: [48, 48] });
      textStartX = left + 58;
    } catch {
      textStartX = left;
    }
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor('#0F172A')
    .text(settings?.businessName || 'Aligarh Web Solutions', textStartX, y, { width: 270 });

  let leftY = doc.y + 2;
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
  if (settings?.address) {
    doc.text(settings.address, textStartX, leftY, { width: 270 });
    leftY = doc.y + 1;
  }
  const taxIds: string[] = [];
  if (settings?.gstin) taxIds.push(`GSTIN: ${settings.gstin}`);
  if (settings?.pan) taxIds.push(`PAN: ${settings.pan}`);
  if (settings?.businessState) taxIds.push(`State: ${settings.businessState}`);
  if (taxIds.length > 0) {
    doc.text(taxIds.join(' | '), textStartX, leftY, { width: 270 });
    leftY = doc.y + 1;
  }
  if (settings?.smtpFromEmail || settings?.ownerAlertEmail) {
    doc.text(settings.smtpFromEmail || settings.ownerAlertEmail, textStartX, leftY, { width: 270 });
    leftY = doc.y + 1;
  }

  // Right document block
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#0284C7')
    .text(title, right - 210, y, { width: 210, align: 'right' });

  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor('#0F172A')
    .text(docNumber, right - 210, y + 23, { width: 210, align: 'right' });

  let rightY = y + 40;
  doc.fontSize(8.5);
  for (const m of metaLines) {
    doc
      .font('Helvetica')
      .fillColor('#64748B')
      .text(`${m.label}: `, right - 210, rightY, { width: 115, align: 'right' });
    doc
      .font('Helvetica-Bold')
      .fillColor('#0F172A')
      .text(m.value, right - 92, rightY, { width: 92, align: 'right' });
    rightY += 13;
  }

  if (stampText) {
    const badgeColor =
      stampText === 'PAID' || stampText === 'ACCEPTED'
        ? '#16A34A'
        : stampText === 'CANCELLED' || stampText === 'REJECTED' || stampText === 'OVERDUE'
          ? '#DC2626'
          : '#0284C7';
    doc
      .save()
      .roundedRect(right - 88, rightY + 2, 88, 18, 3)
      .lineWidth(1)
      .strokeColor(badgeColor)
      .stroke()
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(badgeColor)
      .text(stampText, right - 88, rightY + 6, { width: 88, align: 'center' })
      .restore();
    rightY += 24;
  }

  const bottomY = Math.max(leftY, rightY) + 12;
  doc
    .moveTo(left, bottomY)
    .lineTo(right, bottomY)
    .lineWidth(0.75)
    .strokeColor('#E2E8F0')
    .stroke();

  return bottomY + 14;
}

function drawBillTo(doc: PDFKit.PDFDocument, client: any, startY: number, docMeta?: any): number {
  const left = 42;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#64748B').text('BILL TO', left, startY);
  let y = startY + 13;

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0F172A').text(client?.name || 'Client', left, y, { width: 290 });
  y = doc.y + 2;

  doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
  if (client?.company && client.company !== client.name) {
    doc.text(client.company, left, y, { width: 290 });
    y = doc.y + 1;
  }
  if (client?.address) {
    doc.text(client.address, left, y, { width: 290 });
    y = doc.y + 1;
  }
  const clientMeta: string[] = [];
  const supplyPlace = docMeta?.placeOfSupply || client?.state;
  if (supplyPlace) clientMeta.push(`Place of Supply: ${supplyPlace}`);
  if (client?.gstin) clientMeta.push(`GSTIN: ${client.gstin}`);
  if (clientMeta.length > 0) {
    doc.text(clientMeta.join(' | '), left, y, { width: 290 });
    y = doc.y + 1;
  }
  const contactParts: string[] = [];
  if (Array.isArray(client?.emails) && client.emails[0]) contactParts.push(client.emails[0]);
  if (client?.whatsappPhone) contactParts.push(client.whatsappPhone);
  if (contactParts.length > 0) {
    doc.text(contactParts.join(' | '), left, y, { width: 290 });
    y = doc.y + 1;
  }
  if (docMeta?.projectName || docMeta?.referenceNumber) {
    const extraParts: string[] = [];
    if (docMeta.projectName) extraParts.push(`Project: ${docMeta.projectName}`);
    if (docMeta.referenceNumber) extraParts.push(`Ref #: ${docMeta.referenceNumber}`);
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#0F172A').text(extraParts.join('  |  '), left, y + 2, { width: 480 });
    y = doc.y + 1;
  }

  return y + 14;
}

function drawLineItemsTable(
  doc: PDFKit.PDFDocument,
  items: any[],
  gstMode: string,
  startY: number
): number {
  const left = 42;
  const right = doc.page.width - 42;
  const tableWidth = right - left; // ~511

  const cols = {
    idx: { x: left, w: 22 },
    desc: { x: left + 22, w: 205 },
    hsn: { x: left + 227, w: 48 },
    qty: { x: left + 275, w: 32 },
    rate: { x: left + 307, w: 68 },
    tax: { x: left + 375, w: 46 },
    total: { x: left + 421, w: 90 },
  };

  function drawHeaderRow(yPos: number): number {
    doc.rect(left, yPos, tableWidth, 22).fill('#F1F5F9');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155');
    doc.text('#', cols.idx.x + 4, yPos + 7, { width: cols.idx.w - 4 });
    doc.text('DESCRIPTION', cols.desc.x + 2, yPos + 7, { width: cols.desc.w - 4 });
    doc.text('HSN/SAC', cols.hsn.x, yPos + 7, { width: cols.hsn.w });
    doc.text('QTY', cols.qty.x, yPos + 7, { width: cols.qty.w, align: 'right' });
    doc.text('RATE', cols.rate.x, yPos + 7, { width: cols.rate.w, align: 'right' });
    doc.text(gstMode === 'NONE' ? 'DISC' : 'GST %', cols.tax.x, yPos + 7, { width: cols.tax.w, align: 'right' });
    doc.text('AMOUNT', cols.total.x, yPos + 7, { width: cols.total.w - 4, align: 'right' });
    return yPos + 24;
  }

  let y = drawHeaderRow(startY);

  items.forEach((it, index) => {
    const hasTitle = Boolean(it.itemName && it.itemName.trim() && it.itemName.trim() !== (it.description || '').trim());
    const titleHeight = hasTitle
      ? doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(it.itemName.trim(), { width: cols.desc.w - 6 }) + 2
      : 0;
    const descHeight = doc.font('Helvetica').fontSize(8.5).heightOfString(it.description || '', {
      width: cols.desc.w - 6,
    });
    const hasDiscountNote = Number(it.discount || 0) > 0 && gstMode !== 'NONE';
    const rowHeight = Math.max(22, titleHeight + descHeight + (hasDiscountNote ? 18 : 10));

    if (y + rowHeight > doc.page.height - 150) {
      doc.addPage();
      y = drawHeaderRow(42);
    }

    doc.font('Helvetica').fontSize(8.5).fillColor('#0F172A');
    doc.text(String(index + 1), cols.idx.x + 4, y + 5, { width: cols.idx.w - 4 });
    let textCursorY = y + 5;
    if (hasTitle) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0F172A').text(it.itemName.trim(), cols.desc.x + 2, textCursorY, {
        width: cols.desc.w - 6,
      });
      textCursorY += titleHeight;
    }
    doc.font('Helvetica').fontSize(8.5).fillColor('#0F172A').text(it.description || '', cols.desc.x + 2, textCursorY, {
      width: cols.desc.w - 6,
    });
    if (hasDiscountNote) {
      doc
        .fontSize(7.5)
        .fillColor('#64748B')
        .text(`Discount: -${formatPdfINR(it.discount)}`, cols.desc.x + 2, textCursorY + descHeight + 1, {
          width: cols.desc.w - 6,
        });
      doc.fontSize(8.5).fillColor('#0F172A');
    }

    doc.fillColor('#475569').text(it.hsnSac || '998314', cols.hsn.x, y + 5, { width: cols.hsn.w });
    doc.fillColor('#0F172A').text(String(Number(it.qty ?? 1)), cols.qty.x, y + 5, {
      width: cols.qty.w,
      align: 'right',
    });
    doc.text(formatPdfINR(it.rate), cols.rate.x, y + 5, { width: cols.rate.w, align: 'right' });
    doc.text(
      gstMode === 'NONE'
        ? Number(it.discount || 0) > 0
          ? formatPdfINR(it.discount)
          : '-'
        : `${Number(it.taxPercent ?? 0)}%`,
      cols.tax.x,
      y + 5,
      { width: cols.tax.w, align: 'right' }
    );
    doc.font('Helvetica-Bold').text(formatPdfINR(it.lineTotal), cols.total.x, y + 5, {
      width: cols.total.w - 4,
      align: 'right',
    });

    y += rowHeight;
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .lineWidth(0.5)
      .strokeColor('#E2E8F0')
      .stroke();
  });

  return y + 12;
}

export async function generateInvoicePdfBuffer(invoice: any, settings: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  const left = 42;
  const right = doc.page.width - 42;

  const meta = [
    { label: 'Issue Date', value: formatDateDDMMMYYYY(invoice.issueDate) },
    { label: 'Due Date', value: formatDateDDMMMYYYY(invoice.dueDate) },
    { label: 'Financial Year', value: invoice.financialYear || '-' },
  ];

  const stamp =
    invoice.status === 'PAID' || invoice.status === 'CANCELLED' || invoice.status === 'OVERDUE'
      ? invoice.status
      : null;

  const afterHeaderY = drawBusinessHeader(
    doc,
    settings,
    invoice.gstMode === 'NONE' ? 'INVOICE' : 'TAX INVOICE',
    invoice.invoiceNumber,
    meta,
    stamp
  );

  const afterBillToY = drawBillTo(doc, invoice.client, afterHeaderY, invoice);
  let y = drawLineItemsTable(doc, invoice.items || [], invoice.gstMode, afterBillToY);

  if (y > doc.page.height - 230) {
    doc.addPage();
    y = 46;
  }

  // Left: Amount in Words + Payment / Bank + UPI QR
  const balanceDue = Math.max(0, round2(Number(invoice.total) - Number(invoice.amountPaid || 0)));
  const words = amountInWordsINR(invoice.total);

  let leftBlockY = y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('AMOUNT IN WORDS', left, leftBlockY);
  leftBlockY += 11;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0F172A').text(words, left, leftBlockY, { width: 265 });
  leftBlockY = doc.y + 12;

  // Totals box on right
  const totalsX = right - 220;
  let totY = y;
  const drawSummaryLine = (label: string, val: string, bold = false, accent?: string) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 10 : 8.5)
      .fillColor(accent || (bold ? '#0F172A' : '#475569'))
      .text(label, totalsX, totY, { width: 115 });
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 10 : 8.5)
      .fillColor(accent || '#0F172A')
      .text(val, totalsX + 115, totY, { width: 105, align: 'right' });
    totY += bold ? 17 : 13;
  };

  drawSummaryLine('Subtotal', formatPdfINR(invoice.subtotal));
  if (Number(invoice.discountTotal) > 0) {
    drawSummaryLine('Discount', `- ${formatPdfINR(invoice.discountTotal)}`);
  }
  if (invoice.gstMode === 'CGST_SGST') {
    drawSummaryLine('CGST', formatPdfINR(invoice.cgstTotal));
    drawSummaryLine('SGST', formatPdfINR(invoice.sgstTotal));
  } else if (invoice.gstMode === 'IGST') {
    drawSummaryLine('IGST', formatPdfINR(invoice.igstTotal));
  }
  if (Number(invoice.roundOff) !== 0) {
    drawSummaryLine(invoice.adjustmentLabel || 'Round Off', formatPdfINR(invoice.roundOff));
  }

  doc.moveTo(totalsX, totY).lineTo(right, totY).lineWidth(0.75).strokeColor('#CBD5E1').stroke();
  totY += 6;
  drawSummaryLine('Grand Total', formatPdfINR(invoice.total), true);
  if (Number(invoice.amountPaid) > 0) {
    drawSummaryLine('Amount Paid', `- ${formatPdfINR(invoice.amountPaid)}`, false, '#16A34A');
  }
  drawSummaryLine(
    'Balance Due',
    formatPdfINR(balanceDue),
    true,
    balanceDue > 0 ? '#0284C7' : '#16A34A'
  );

  // Payment details & UPI QR
  const hasBank = Boolean(settings?.bankName || settings?.bankAccountNumber || settings?.upiId);
  if (hasBank) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('PAYMENT & BANK DETAILS', left, leftBlockY);
    leftBlockY += 12;

    let qrDrawnBottom = leftBlockY;
    let bankTextX = left;
    if (settings?.upiId && balanceDue > 0 && invoice.status !== 'CANCELLED') {
      try {
        const upiUri = buildUpiUri({
          upiId: settings.upiId,
          payeeName: settings.businessName || 'Aligarh Web Solutions',
          amount: balanceDue,
          note: invoice.invoiceNumber,
        });
        const qrBuf = await QRCode.toBuffer(upiUri, { width: 160, margin: 1 });
        doc.image(qrBuf, left, leftBlockY, { width: 74, height: 74 });
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#64748B')
          .text('Scan UPI QR', left, leftBlockY + 76, { width: 74, align: 'center' });
        qrDrawnBottom = leftBlockY + 88;
        bankTextX = left + 86;
      } catch {
        bankTextX = left;
      }
    }

    doc.font('Helvetica').fontSize(8.2).fillColor('#334155');
    if (settings?.upiId) {
      doc.text(`UPI ID: ${settings.upiId}`, bankTextX, leftBlockY, { width: 185 });
      leftBlockY = doc.y + 2;
    }
    if (settings?.bankName) {
      doc.text(`Bank: ${settings.bankName}`, bankTextX, leftBlockY, { width: 185 });
      leftBlockY = doc.y + 2;
    }
    if (settings?.bankAccountName) {
      doc.text(`A/C Name: ${settings.bankAccountName}`, bankTextX, leftBlockY, { width: 185 });
      leftBlockY = doc.y + 2;
    }
    if (settings?.bankAccountNumber) {
      doc.text(`A/C No: ${settings.bankAccountNumber}`, bankTextX, leftBlockY, { width: 185 });
      leftBlockY = doc.y + 2;
    }
    if (settings?.bankIfsc) {
      doc.text(`IFSC: ${settings.bankIfsc}`, bankTextX, leftBlockY, { width: 185 });
      leftBlockY = doc.y + 2;
    }
    leftBlockY = Math.max(leftBlockY, qrDrawnBottom) + 8;
  }

  let footerY = Math.max(leftBlockY, totY) + 12;
  if (invoice.notes || invoice.terms) {
    if (footerY > doc.page.height - 110) {
      doc.addPage();
      footerY = 46;
    }
    if (invoice.notes) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('NOTES', left, footerY);
      footerY += 11;
      doc.font('Helvetica').fontSize(8.2).fillColor('#334155').text(invoice.notes, left, footerY, { width: right - left });
      footerY = doc.y + 10;
    }
    if (invoice.terms) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('TERMS & CONDITIONS', left, footerY);
      footerY += 11;
      doc.font('Helvetica').fontSize(8).fillColor('#475569').text(invoice.terms, left, footerY, { width: right - left });
    }
  }

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#94A3B8')
    .text(
      `Generated by ${settings?.businessName || 'Aligarh Web Solutions'} · Computer-generated invoice`,
      left,
      doc.page.height - 38,
      { width: right - left, align: 'center' }
    );

  return docToBuffer(doc);
}

export async function generateEstimatePdfBuffer(estimate: any, settings: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  const left = 42;
  const right = doc.page.width - 42;

  const meta = [
    { label: 'Issue Date', value: formatDateDDMMMYYYY(estimate.issueDate) },
    { label: 'Valid Until', value: formatDateDDMMMYYYY(estimate.validUntil) },
  ];

  const stamp =
    estimate.status === 'ACCEPTED' || estimate.status === 'REJECTED' || estimate.status === 'EXPIRED'
      ? estimate.status
      : null;

  const afterHeaderY = drawBusinessHeader(
    doc,
    settings,
    'ESTIMATE',
    estimate.estimateNumber,
    meta,
    stamp
  );

  const afterBillToY = drawBillTo(doc, estimate.client, afterHeaderY, estimate);
  let y = drawLineItemsTable(doc, estimate.items || [], estimate.gstMode, afterBillToY);

  if (y > doc.page.height - 210) {
    doc.addPage();
    y = 46;
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('AMOUNT IN WORDS', left, y);
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#0F172A')
    .text(amountInWordsINR(estimate.total), left, y + 11, { width: 265 });
  let leftBlockY = doc.y + 12;

  const hasBank = Boolean(settings?.bankName || settings?.bankAccountNumber || settings?.upiId);
  if (hasBank) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('BANK & PAYMENT DETAILS', left, leftBlockY);
    leftBlockY += 11;
    doc.font('Helvetica').fontSize(8.2).fillColor('#334155');
    if (settings?.bankAccountName) {
      doc.text(`Account Name: ${settings.bankAccountName}`, left, leftBlockY, { width: 265 });
      leftBlockY = doc.y + 1;
    }
    if (settings?.bankName) {
      doc.text(`Bank: ${settings.bankName}`, left, leftBlockY, { width: 265 });
      leftBlockY = doc.y + 1;
    }
    if (settings?.bankAccountNumber) {
      doc.text(`A/C No: ${settings.bankAccountNumber}`, left, leftBlockY, { width: 265 });
      leftBlockY = doc.y + 1;
    }
    if (settings?.bankIfsc) {
      doc.text(`IFSC: ${settings.bankIfsc}`, left, leftBlockY, { width: 265 });
      leftBlockY = doc.y + 1;
    }
    if (settings?.upiId) {
      doc.text(`UPI ID: ${settings.upiId}`, left, leftBlockY, { width: 265 });
      leftBlockY = doc.y + 1;
    }
    leftBlockY += 8;
  }

  const totalsX = right - 220;
  let totY = y;
  const drawSummaryLine = (label: string, val: string, bold = false) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 10 : 8.5)
      .fillColor(bold ? '#0F172A' : '#475569')
      .text(label, totalsX, totY, { width: 115 });
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 10 : 8.5)
      .fillColor('#0F172A')
      .text(val, totalsX + 115, totY, { width: 105, align: 'right' });
    totY += bold ? 17 : 13;
  };

  drawSummaryLine('Subtotal', formatPdfINR(estimate.subtotal));
  if (Number(estimate.discountTotal) > 0) {
    drawSummaryLine('Discount', `- ${formatPdfINR(estimate.discountTotal)}`);
  }
  if (estimate.gstMode !== 'NONE') {
    if (estimate.gstMode === 'CGST_SGST') {
      const half = round2(Number(estimate.taxTotal) / 2);
      drawSummaryLine('CGST', formatPdfINR(half));
      drawSummaryLine('SGST', formatPdfINR(round2(Number(estimate.taxTotal) - half)));
    } else {
      drawSummaryLine('IGST', formatPdfINR(estimate.taxTotal));
    }
  }
  if (Number(estimate.roundOff) !== 0) {
    drawSummaryLine(estimate.adjustmentLabel || 'Round Off', formatPdfINR(estimate.roundOff));
  }
  doc.moveTo(totalsX, totY).lineTo(right, totY).lineWidth(0.75).strokeColor('#CBD5E1').stroke();
  totY += 6;
  drawSummaryLine('Estimated Total', formatPdfINR(estimate.total), true);

  let footerY = Math.max(leftBlockY, totY) + 12;
  if (estimate.notes || estimate.terms) {
    if (footerY > doc.page.height - 110) {
      doc.addPage();
      footerY = 46;
    }
    if (estimate.notes) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('NOTES', left, footerY);
      footerY += 11;
      doc.font('Helvetica').fontSize(8.2).fillColor('#334155').text(estimate.notes, left, footerY, { width: right - left });
      footerY = doc.y + 10;
    }
    if (estimate.terms) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B').text('TERMS & CONDITIONS', left, footerY);
      footerY += 11;
      doc.font('Helvetica').fontSize(8).fillColor('#475569').text(estimate.terms, left, footerY, { width: right - left });
    }
  }

  return docToBuffer(doc);
}

export async function generateReceiptPdfBuffer(payment: any, invoice: any, settings: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  const left = 42;
  const right = doc.page.width - 42;

  const afterHeaderY = drawBusinessHeader(
    doc,
    settings,
    'PAYMENT RECEIPT',
    payment.receiptNumber,
    [
      { label: 'Payment Date', value: formatDateDDMMMYYYY(payment.paidAt) },
      { label: 'Payment Method', value: payment.method },
      { label: 'Invoice Ref', value: invoice?.invoiceNumber || '-' },
    ],
    'RECEIVED'
  );

  let y = drawBillTo(doc, payment.client || invoice?.client, afterHeaderY);

  doc
    .roundedRect(left, y, right - left, 92, 6)
    .fillAndStroke('#F8FAFC', '#CBD5E1');

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748B').text('AMOUNT RECEIVED', left + 16, y + 14);
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor('#16A34A')
    .text(formatPdfINR(payment.amount), left + 16, y + 28);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#334155')
    .text(amountInWordsINR(payment.amount), left + 16, y + 56, { width: right - left - 32 });

  y += 112;

  const details: Array<[string, string]> = [
    ['Receipt Number', payment.receiptNumber],
    ['Invoice Number', invoice?.invoiceNumber || '-'],
    ['Invoice Total', formatPdfINR(invoice?.total || payment.amount)],
    ['Total Paid to Date', formatPdfINR(invoice?.amountPaid || payment.amount)],
    [
      'Remaining Invoice Balance',
      formatPdfINR(Math.max(0, round2(Number(invoice?.total || 0) - Number(invoice?.amountPaid || 0)))),
    ],
    ['Payment Mode', payment.method],
    ['Transaction / UTR Ref', payment.referenceUtr || '-'],
  ];

  for (const [k, v] of details) {
    doc.font('Helvetica').fontSize(9).fillColor('#64748B').text(k, left, y, { width: 200 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A').text(v, left + 210, y, { width: 280 });
    y += 18;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
  }

  if (payment.notes) {
    y += 10;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#64748B').text('NOTES', left, y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(payment.notes, left, y + 12, { width: right - left });
  }

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#64748B')
    .text(
      `Thank you for your payment! — ${settings?.businessName || 'Aligarh Web Solutions'}`,
      left,
      doc.page.height - 44,
      { width: right - left, align: 'center' }
    );

  return docToBuffer(doc);
}
