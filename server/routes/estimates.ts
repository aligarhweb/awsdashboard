import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { generateRandomToken } from '../lib/crypto';
import {
  computeDocumentTotals,
  formatPlaceOfSupply,
  getIndianFinancialYear,
  resolveDefaultGstMode,
} from '../../shared/billing';
import { getIstDateParts } from '../../shared/dates';
import {
  nextSequenceNumber,
  serializeEstimate,
  serializeInvoice,
} from '../lib/billingHelpers';
import { generateEstimatePdfBuffer } from '../lib/pdfGenerator';
import { importEstimatesFromCsv, parseEstimateCsv } from '../lib/estimateCsv';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { renderTemplateText, sendEmailMessage, whatsappProvider } from '../lib/messaging';

const router = Router();
router.use(requireAuth);

const lineItemSchema = z.object({
  itemName: z.string().trim().max(191).optional().nullable(),
  description: z.string().trim().min(1, 'Line description is required').max(4000),
  hsnSac: z.string().trim().max(32).optional().nullable(),
  qty: z.coerce.number().positive('Quantity must be > 0'),
  rate: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(18),
});

const estimateSchema = z.object({
  clientId: z.string().min(1),
  referenceNumber: z.string().trim().max(191).optional().nullable(),
  projectName: z.string().trim().max(191).optional().nullable(),
  placeOfSupply: z.string().trim().max(100).optional().nullable(),
  issueDate: z.string().min(1),
  validUntil: z.string().min(1),
  gstMode: z.enum(['CGST_SGST', 'IGST', 'NONE']).optional(),
  applyRoundOff: z.boolean().default(true),
  adjustmentOverride: z.coerce.number().finite().optional().nullable(),
  adjustmentLabel: z.string().trim().max(64).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED']).optional(),
  items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
});

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const clientId = String(req.query.clientId || '').trim();

    const rows = await db.estimate.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status: status as any } : {}),
        ...(clientId ? { clientId } : {}),
      },
      include: {
        client: {
          select: { id: true, name: true, company: true, state: true, gstin: true, emails: true, whatsappPhone: true, address: true },
        },
        items: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { issueDate: 'desc' },
    });

    const filtered = rows.filter((e: any) => {
      if (!q) return true;
      const hay = `${e.estimateNumber} ${e.referenceNumber || ''} ${e.projectName || ''} ${e.placeOfSupply || ''} ${e.client?.name || ''} ${e.client?.company || ''} ${(e.items || []).map((i: any) => `${i.itemName || ''} ${i.description}`).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });

    res.json({ items: filtered.map(serializeEstimate) });
  } catch (err) {
    next(err);
  }
});

router.get('/export', async (_req, res, next) => {
  try {
    const estimates = await db.estimate.findMany({
      include: {
        client: { select: { name: true, company: true, state: true, gstin: true } },
        items: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { issueDate: 'desc' },
    });

    const flatRows: Record<string, any>[] = [];
    for (const est of estimates as any[]) {
      const items = est.items?.length ? est.items : [{}];
      for (const it of items) {
        flatRows.push({
          'Estimate Date': est.issueDate instanceof Date ? est.issueDate.toISOString().slice(0, 10) : String(est.issueDate).slice(0, 10),
          'Estimate Number': est.estimateNumber,
          'Estimate Status': est.status,
          'Expiry Date': est.validUntil instanceof Date ? est.validUntil.toISOString().slice(0, 10) : String(est.validUntil).slice(0, 10),
          PurchaseOrder: est.referenceNumber || '',
          'Project Name': est.projectName || '',
          'Customer Name': est.client?.name || '',
          'Place of Supply': est.placeOfSupply || est.client?.state || '',
          'GST Mode': est.gstMode,
          SubTotal: Number(est.subtotal ?? 0).toFixed(2),
          Adjustment: Number(est.roundOff ?? 0).toFixed(2),
          'Adjustment Description': est.adjustmentLabel || '',
          Total: Number(est.total ?? 0).toFixed(2),
          Notes: est.notes || '',
          'Terms & Conditions': est.terms || '',
          'Item Name': it.itemName || '',
          'Item Desc': it.description || '',
          'HSN/SAC': it.hsnSac || '',
          Quantity: Number(it.qty ?? 1),
          'Item Price': Number(it.rate ?? 0).toFixed(2),
          'Discount Amount': Number(it.discount ?? 0).toFixed(2),
          'Item Tax %': Number(it.taxPercent ?? 0),
          'Item Total': Number(it.lineTotal ?? 0).toFixed(2),
        });
      }
    }

    const csv = Papa.unparse(flatRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="estimates-export.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.post('/import', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      csvText: z.string().min(1).max(5_000_000),
      dryRun: z.boolean().default(true),
    });
    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'CSV content is required' });
      return;
    }

    if (parsedBody.data.dryRun) {
      const settings = await db.settings.findUnique({ where: { id: 1 } });
      const preview = parseEstimateCsv(
        parsedBody.data.csvText,
        settings?.businessState || 'Uttar Pradesh',
        Boolean(settings?.gstEnabled ?? true)
      );
      res.json({
        dryRun: true,
        totalRows: preview.length,
        validCount: preview.filter((r) => r.valid).length,
        invalidCount: preview.filter((r) => !r.valid).length,
        rows: preview.map((r) => ({
          rowNumber: r.rowNumber,
          valid: r.valid,
          error: r.error,
          data: { name: r.estimateNumber },
          clientName: `${r.customerName} · ${r.items.length} item(s) · ₹${r.computedTotal.toFixed(2)}`,
        })),
      });
      return;
    }

    const result = await importEstimatesFromCsv(parsedBody.data.csvText);
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'ESTIMATES_IMPORTED_CSV',
      summary: `Imported ${result.createdCount} estimates (${result.skippedCount} skipped, ${result.createdClientsCount} new clients)`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const estimate = await db.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!estimate) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }
    res.json({ estimate: serializeEstimate(estimate) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const estimate = await db.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!estimate) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const pdfBuffer = await generateEstimatePdfBuffer(serializeEstimate(estimate), settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${estimate.estimateNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = estimateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid estimate data', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const client = await db.client.findUnique({ where: { id: d.clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const placeOfSupply = formatPlaceOfSupply(d.placeOfSupply || client.state);
    const gstMode =
      d.gstMode || resolveDefaultGstMode(Boolean(settings?.gstEnabled ?? true), settings?.businessState, placeOfSupply || client.state);
    const totals = computeDocumentTotals(d.items, gstMode, d.applyRoundOff, d.adjustmentOverride);

    const issueDate = new Date(d.issueDate);
    const { year } = getIstDateParts(issueDate);
    const prefix = (settings?.estimatePrefix || 'EST').trim() || 'EST';
    const estimateNumber = await nextSequenceNumber({
      model: 'estimate',
      field: 'estimateNumber',
      prefixWithDash: `${prefix}-${year}-`,
    });

    const created = await db.estimate.create({
      data: {
        estimateNumber,
        clientId: client.id,
        referenceNumber: d.referenceNumber || null,
        projectName: d.projectName || null,
        placeOfSupply,
        issueDate,
        validUntil: new Date(d.validUntil),
        gstMode: totals.gstMode,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        roundOff: totals.roundOff,
        adjustmentLabel: d.adjustmentLabel || (d.adjustmentOverride !== undefined && d.adjustmentOverride !== null ? 'Adjustment' : null),
        total: totals.total,
        notes: d.notes || null,
        terms: d.terms !== undefined ? d.terms : settings?.defaultEstimateTerms || null,
        status: d.status || 'DRAFT',
        publicToken: generateRandomToken(20),
        items: {
          create: totals.items.map((it, idx) => ({
            itemName: it.itemName || null,
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: it.qty,
            rate: it.rate,
            discount: it.discount,
            taxPercent: it.taxPercent,
            lineTotal: it.lineTotal,
            sortOrder: idx,
          })),
        },
      },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'ESTIMATE_CREATED',
      entityType: 'Estimate',
      entityId: created.id,
      summary: `Created estimate ${created.estimateNumber} for ${client.name}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ estimate: serializeEstimate(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.estimate.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }

    const parsed = estimateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid estimate update', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const client = await db.client.findUnique({ where: { id: d.clientId || existing.clientId } });
    const settings = await db.settings.findUnique({ where: { id: 1 } });

    const nextPlaceOfSupply =
      d.placeOfSupply !== undefined
        ? formatPlaceOfSupply(d.placeOfSupply)
        : existing.placeOfSupply || formatPlaceOfSupply(client?.state);

    let totalsData: Record<string, any> = {};
    if (d.items) {
      const gstMode =
        d.gstMode ||
        (existing.gstMode as any) ||
        resolveDefaultGstMode(Boolean(settings?.gstEnabled ?? true), settings?.businessState, nextPlaceOfSupply || client?.state);
      const totals = computeDocumentTotals(d.items, gstMode, d.applyRoundOff ?? true, d.adjustmentOverride);
      totalsData = {
        gstMode: totals.gstMode,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        roundOff: totals.roundOff,
        total: totals.total,
        items: {
          deleteMany: {},
          create: totals.items.map((it, idx) => ({
            itemName: it.itemName || null,
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: it.qty,
            rate: it.rate,
            discount: it.discount,
            taxPercent: it.taxPercent,
            lineTotal: it.lineTotal,
            sortOrder: idx,
          })),
        },
      };
    }

    const updated = await db.estimate.update({
      where: { id: req.params.id },
      data: {
        ...(d.clientId ? { clientId: d.clientId } : {}),
        ...(d.referenceNumber !== undefined ? { referenceNumber: d.referenceNumber || null } : {}),
        ...(d.projectName !== undefined ? { projectName: d.projectName || null } : {}),
        ...(d.placeOfSupply !== undefined ? { placeOfSupply: nextPlaceOfSupply } : {}),
        ...(d.adjustmentLabel !== undefined ? { adjustmentLabel: d.adjustmentLabel || null } : {}),
        ...(d.issueDate ? { issueDate: new Date(d.issueDate) } : {}),
        ...(d.validUntil ? { validUntil: new Date(d.validUntil) } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
        ...(d.terms !== undefined ? { terms: d.terms || null } : {}),
        ...(d.status ? { status: d.status } : {}),
        ...totalsData,
      },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });

    res.json({ estimate: serializeEstimate(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const updated = await db.estimate.update({
      where: { id: req.params.id },
      data: { status: parsed.data.status },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    res.json({ estimate: serializeEstimate(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/convert', async (req, res, next) => {
  try {
    const estimate = await db.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!estimate) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }

    if (estimate.convertedInvoiceId) {
      const existingInv = await db.invoice.findUnique({
        where: { id: estimate.convertedInvoiceId },
        include: { client: true, items: { orderBy: { sortOrder: 'asc' } }, payments: true, creditNotes: true },
      });
      if (existingInv) {
        res.json({ invoice: serializeInvoice(existingInv), alreadyConverted: true });
        return;
      }
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const now = new Date();
    const dueDate = new Date(now.getTime() + 7 * 86_400_000);
    const fy = getIndianFinancialYear(now);
    const invPrefix = (settings?.invoicePrefix || 'INV').trim() || 'INV';
    const invoiceNumber = await nextSequenceNumber({
      model: 'invoice',
      field: 'invoiceNumber',
      prefixWithDash: `${invPrefix}-${fy}-`,
    });

    const estAdj = Number(estimate.roundOff ?? 0);
    const hasCustomAdj = Boolean(estimate.adjustmentLabel) || Math.abs(estAdj) > 1;
    const totals = computeDocumentTotals(
      (estimate.items || []).map((it: any) => ({
        itemName: it.itemName || null,
        description: it.description,
        hsnSac: it.hsnSac,
        qty: Number(it.qty),
        rate: Number(it.rate),
        discount: Number(it.discount),
        taxPercent: Number(it.taxPercent),
      })),
      estimate.gstMode as any,
      estAdj !== 0,
      hasCustomAdj ? estAdj : undefined
    );

    const invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        financialYear: fy,
        clientId: estimate.clientId,
        referenceNumber: estimate.referenceNumber || null,
        projectName: estimate.projectName || null,
        placeOfSupply: estimate.placeOfSupply || formatPlaceOfSupply(estimate.client?.state),
        issueDate: now,
        dueDate,
        gstMode: totals.gstMode,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        taxTotal: totals.taxTotal,
        roundOff: totals.roundOff,
        adjustmentLabel: estimate.adjustmentLabel || null,
        total: totals.total,
        amountPaid: 0,
        status: 'DRAFT',
        notes: estimate.notes
          ? `Converted from ${estimate.estimateNumber}\n${estimate.notes}`
          : `Converted from ${estimate.estimateNumber}`,
        terms: settings?.defaultInvoiceTerms || estimate.terms || null,
        publicToken: generateRandomToken(20),
        items: {
          create: totals.items.map((it, idx) => ({
            itemName: it.itemName || null,
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: it.qty,
            rate: it.rate,
            discount: it.discount,
            taxPercent: it.taxPercent,
            lineTotal: it.lineTotal,
            sortOrder: idx,
          })),
        },
      },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: true,
        creditNotes: true,
      },
    });

    await db.estimate.update({
      where: { id: estimate.id },
      data: {
        status: 'ACCEPTED',
        convertedInvoiceId: invoice.id,
        respondedAt: estimate.respondedAt || now,
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'ESTIMATE_CONVERTED_TO_INVOICE',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Converted ${estimate.estimateNumber} to invoice ${invoice.invoiceNumber}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/send', async (req, res, next) => {
  try {
    const schema = z.object({
      channel: z.enum(['EMAIL', 'WHATSAPP']).default('EMAIL'),
      dryRun: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid send payload' });
      return;
    }

    const estimate = await db.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!estimate || !estimate.client) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const estLink = `${baseUrl}/public/estimate/${estimate.publicToken}`;

    const tpl = await db.messageTemplate.findFirst({
      where: { slug: 'estimate-sent-en', channel: parsed.data.channel },
    });

    const vars = {
      client_name: estimate.client.contactPerson || estimate.client.name,
      business_name: settings?.businessName || 'Aligarh Web Solutions',
      invoice_no: estimate.estimateNumber,
      estimate_no: estimate.estimateNumber,
      amount: formatINR(Number(estimate.total || 0), { decimals: 2 }),
      expiry_date: formatDateDDMMMYYYY(estimate.validUntil),
      pay_link: estLink,
    };

    const subject = renderTemplateText(
      tpl?.subject || `Estimate ${estimate.estimateNumber} from ${vars.business_name}`,
      vars
    );
    const bodyText = renderTemplateText(
      tpl?.body ||
        `Hello {{client_name}},\n\nPlease review Estimate {{invoice_no}} for {{amount}} (valid until {{expiry_date}}) here: {{pay_link}}\n\nRegards,\n{{business_name}}`,
      vars
    );

    let sendRes;
    if (parsed.data.channel === 'EMAIL') {
      const emails = Array.isArray(estimate.client.emails)
        ? estimate.client.emails.map((e: any) => String(e || '').trim()).filter(Boolean)
        : [];
      const pdfBuf = await generateEstimatePdfBuffer(serializeEstimate(estimate), settings || {});
      sendRes = await sendEmailMessage({
        to: emails,
        subject,
        text: bodyText,
        attachments: [
          {
            filename: `${estimate.estimateNumber}.pdf`,
            content: pdfBuf,
            contentType: 'application/pdf',
          },
        ],
        settings,
        forceDryRun: parsed.data.dryRun,
      });
    } else {
      sendRes = await whatsappProvider.sendMessage({
        to: estimate.client.whatsappPhone || '',
        templateName: tpl?.waTemplateName || null,
        languageCode: tpl?.waLanguageCode || 'en',
        renderedText: bodyText,
        settings,
        forceDryRun: parsed.data.dryRun,
      });
    }

    const now = new Date();
    await db.messageLog.create({
      data: {
        clientId: estimate.clientId,
        channel: parsed.data.channel,
        templateId: tpl?.id || null,
        renderedSubject: parsed.data.channel === 'EMAIL' ? subject : null,
        renderedContent: bodyText,
        entityType: 'ESTIMATE',
        entityId: estimate.id,
        sentAt: sendRes.ok ? now : null,
        status: sendRes.ok ? 'SENT' : 'FAILED',
        providerMessageId: sendRes.providerMessageId || null,
        error: sendRes.error || null,
        direction: 'OUTBOUND',
      },
    });

    if (sendRes.ok && estimate.status === 'DRAFT') {
      await db.estimate.update({ where: { id: estimate.id }, data: { status: 'SENT' } });
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'ESTIMATE_SENT',
      entityType: 'Estimate',
      entityId: estimate.id,
      summary: `Sent estimate ${estimate.estimateNumber} via ${parsed.data.channel} (${sendRes.ok ? 'SENT' : 'FAILED'})`,
      ipAddress: getClientIp(req),
    });

    if (!sendRes.ok) {
      res.status(400).json({ ok: false, error: sendRes.error || 'Failed to send estimate' });
      return;
    }

    const refreshed = await db.estimate.findUnique({
      where: { id: estimate.id },
      include: { client: true, items: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ ok: true, estimate: serializeEstimate(refreshed), dryRun: sendRes.dryRun });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.estimate.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }
    await db.estimate.delete({ where: { id: req.params.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'ESTIMATE_DELETED',
      entityType: 'Estimate',
      entityId: existing.id,
      summary: `Deleted estimate ${existing.estimateNumber}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
