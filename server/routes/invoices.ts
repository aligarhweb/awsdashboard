import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { generateRandomToken } from '../lib/crypto';
import {
  buildUpiUri,
  computeDocumentTotals,
  formatPlaceOfSupply,
  getIndianFinancialYear,
  resolveDefaultGstMode,
  round2,
} from '../../shared/billing';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import {
  addBillingCycleDate,
  deriveInvoiceStatus,
  nextSequenceNumber,
  serializeCreditNote,
  serializeInvoice,
} from '../lib/billingHelpers';
import { generateInvoicePdfBuffer } from '../lib/pdfGenerator';
import { formatINR } from '../../shared/currency';
import { renderTemplateText, sendEmailMessage, whatsappProvider } from '../lib/messaging';
import { runRecurringInvoicesJob } from '../jobs/phase6Jobs';

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
  domainId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
});

const invoiceSchema = z.object({
  clientId: z.string().min(1),
  referenceNumber: z.string().trim().max(191).optional().nullable(),
  projectName: z.string().trim().max(191).optional().nullable(),
  placeOfSupply: z.string().trim().max(100).optional().nullable(),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  gstMode: z.enum(['CGST_SGST', 'IGST', 'NONE']).optional(),
  applyRoundOff: z.boolean().default(true),
  adjustmentOverride: z.coerce.number().finite().optional().nullable(),
  adjustmentLabel: z.string().trim().max(64).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  recurring: z.boolean().default(false),
  recurringCycle: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'MULTI_YEAR']).optional().nullable(),
  items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
});

async function attachUpiInfo(dto: any, settings: any) {
  const balance = Number(dto.balanceDue ?? 0);
  if (settings?.upiId && balance > 0 && dto.status !== 'CANCELLED') {
    const upiUri = buildUpiUri({
      upiId: settings.upiId,
      payeeName: settings.businessName || 'Aligarh Web Solutions',
      amount: balance,
      note: dto.invoiceNumber,
    });
    const upiQrDataUrl = await QRCode.toDataURL(upiUri, { width: 220, margin: 1 });
    return { ...dto, upiUri, upiQrDataUrl };
  }
  return { ...dto, upiUri: null, upiQrDataUrl: null };
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const fy = String(req.query.fy || '').trim();
    const clientId = String(req.query.clientId || '').trim();

    const rows = await db.invoice.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status: status as any } : {}),
        ...(fy && fy !== 'ALL' ? { financialYear: fy } : {}),
        ...(clientId ? { clientId } : {}),
      },
      include: {
        client: {
          select: { id: true, name: true, company: true, state: true, gstin: true, emails: true, whatsappPhone: true, address: true },
        },
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
      orderBy: { issueDate: 'desc' },
    });

    const filtered = rows.filter((inv: any) => {
      if (!q) return true;
      const hay = `${inv.invoiceNumber} ${inv.client?.name || ''} ${inv.client?.company || ''} ${(inv.items || []).map((i: any) => i.description).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });

    res.json({ items: filtered.map(serializeInvoice) });
  } catch (err) {
    next(err);
  }
});

router.post('/run-recurring', async (req, res, next) => {
  try {
    const summary = await runRecurringInvoicesJob(db, new Date());
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'RECURRING_INVOICES_RUN',
      entityType: 'Invoice',
      summary,
      ipAddress: getClientIp(req),
    });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const inv = await db.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
    });
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const dto = await attachUpiInfo(serializeInvoice(inv), settings);
    res.json({ invoice: dto });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const inv = await db.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: true,
        creditNotes: true,
      },
    });
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const pdfBuffer = await generateInvoicePdfBuffer(serializeInvoice(inv), settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = invoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid invoice data', issues: parsed.error.flatten() });
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
    const dueDate = new Date(d.dueDate);
    const fy = getIndianFinancialYear(issueDate);
    const prefix = (settings?.invoicePrefix || 'INV').trim() || 'INV';
    const invoiceNumber = await nextSequenceNumber({
      model: 'invoice',
      field: 'invoiceNumber',
      prefixWithDash: `${prefix}-${fy}-`,
    });

    const nextRecurringAt =
      d.recurring && d.recurringCycle ? addBillingCycleDate(issueDate, d.recurringCycle) : null;

    const created = await db.invoice.create({
      data: {
        invoiceNumber,
        financialYear: fy,
        clientId: client.id,
        referenceNumber: d.referenceNumber || null,
        projectName: d.projectName || null,
        placeOfSupply,
        issueDate,
        dueDate,
        gstMode: totals.gstMode,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        taxTotal: totals.taxTotal,
        roundOff: totals.roundOff,
        adjustmentLabel: d.adjustmentLabel || (d.adjustmentOverride !== undefined && d.adjustmentOverride !== null ? 'Adjustment' : null),
        total: totals.total,
        amountPaid: 0,
        status: d.status || 'DRAFT',
        notes: d.notes || null,
        terms: d.terms !== undefined ? d.terms : settings?.defaultInvoiceTerms || null,
        publicToken: generateRandomToken(20),
        recurring: d.recurring,
        recurringCycle: d.recurring ? d.recurringCycle || 'YEARLY' : null,
        nextRecurringAt,
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
            domainId: it.domainId || null,
            serviceId: it.serviceId || null,
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

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: created.id,
      summary: `Created invoice ${created.invoiceNumber} (${totals.total}) for ${client.name}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ invoice: await attachUpiInfo(serializeInvoice(created), settings) });
  } catch (err) {
    next(err);
  }
});

router.post('/from-renewal', async (req, res, next) => {
  try {
    const schema = z.object({
      kind: z.enum(['DOMAIN', 'SERVICE']),
      id: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'kind (DOMAIN|SERVICE) and id are required' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const now = new Date();
    const defaultTax = Number(settings?.defaultTaxRate ?? 18);

    let client: any = null;
    let itemInput: any = null;
    let dueDate = new Date(now.getTime() + 7 * 86_400_000);
    let noteText = '';

    if (parsed.data.kind === 'DOMAIN') {
      const domain = await db.domain.findUnique({
        where: { id: parsed.data.id },
        include: { client: true },
      });
      if (!domain || !domain.client) {
        res.status(404).json({ error: 'Domain or client not found' });
        return;
      }
      client = domain.client;
      const yrs = Number(domain.renewalYears || 1);
      itemInput = {
        description: `Domain Renewal: ${domain.name} (${yrs} ${yrs === 1 ? 'Year' : 'Years'})`,
        hsnSac: '998314',
        qty: 1,
        rate: Number(domain.sellingPrice || 0),
        discount: 0,
        taxPercent: defaultTax,
        domainId: domain.id,
      };
      if (new Date(domain.expiryDate).getTime() > now.getTime()) {
        dueDate = new Date(domain.expiryDate);
      }
      noteText = `Renewal invoice for domain ${domain.name} (current expiry: ${formatDateDDMMMYYYY(domain.expiryDate)}).`;
    } else {
      const service = await db.service.findUnique({
        where: { id: parsed.data.id },
        include: { client: true },
      });
      if (!service || !service.client) {
        res.status(404).json({ error: 'Service or client not found' });
        return;
      }
      client = service.client;
      itemInput = {
        description: `Service Renewal: ${service.planName} (${String(service.billingCycle).toLowerCase()})`,
        hsnSac: '998315',
        qty: 1,
        rate: Number(service.sellingPrice || 0),
        discount: 0,
        taxPercent: defaultTax,
        serviceId: service.id,
      };
      if (new Date(service.renewalDate).getTime() > now.getTime()) {
        dueDate = new Date(service.renewalDate);
      }
      noteText = `Renewal invoice for ${service.planName} (renewal date: ${formatDateDDMMMYYYY(service.renewalDate)}).`;
    }

    const gstMode = resolveDefaultGstMode(
      Boolean(settings?.gstEnabled ?? true),
      settings?.businessState,
      client.state
    );
    const totals = computeDocumentTotals([itemInput], gstMode, true);
    const fy = getIndianFinancialYear(now);
    const prefix = (settings?.invoicePrefix || 'INV').trim() || 'INV';
    const invoiceNumber = await nextSequenceNumber({
      model: 'invoice',
      field: 'invoiceNumber',
      prefixWithDash: `${prefix}-${fy}-`,
    });

    const created = await db.invoice.create({
      data: {
        invoiceNumber,
        financialYear: fy,
        clientId: client.id,
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
        total: totals.total,
        amountPaid: 0,
        status: 'DRAFT',
        notes: noteText,
        terms: settings?.defaultInvoiceTerms || null,
        publicToken: generateRandomToken(20),
        items: {
          create: totals.items.map((it, idx) => ({
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: it.qty,
            rate: it.rate,
            discount: it.discount,
            taxPercent: it.taxPercent,
            lineTotal: it.lineTotal,
            domainId: it.domainId || null,
            serviceId: it.serviceId || null,
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

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'RENEWAL_INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: created.id,
      summary: `Generated renewal invoice ${created.invoiceNumber} for ${client.name}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ invoice: await attachUpiInfo(serializeInvoice(created), settings) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.invoice.findUnique({
      where: { id: req.params.id },
      include: { creditNotes: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const parsed = invoiceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid invoice update', issues: parsed.error.flatten() });
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
    let nextTotal = Number(existing.total);
    if (d.items) {
      const gstMode =
        d.gstMode ||
        (existing.gstMode as any) ||
        resolveDefaultGstMode(Boolean(settings?.gstEnabled ?? true), settings?.businessState, nextPlaceOfSupply || client?.state);
      const totals = computeDocumentTotals(d.items, gstMode, d.applyRoundOff ?? true, d.adjustmentOverride);
      nextTotal = totals.total;
      totalsData = {
        gstMode: totals.gstMode,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
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
            domainId: it.domainId || null,
            serviceId: it.serviceId || null,
            sortOrder: idx,
          })),
        },
      };
    }

    const creditTotal = (existing.creditNotes || []).reduce(
      (acc: number, c: any) => acc + Number(c.amount ?? 0),
      0
    );
    const nextDue = d.dueDate ? new Date(d.dueDate) : existing.dueDate;
    const nextStatus = d.status
      ? d.status
      : deriveInvoiceStatus({
          currentStatus: existing.status,
          total: nextTotal,
          amountPaid: Number(existing.amountPaid || 0),
          creditTotal,
          dueDate: nextDue,
        });

    const updated = await db.invoice.update({
      where: { id: req.params.id },
      data: {
        ...(d.clientId ? { clientId: d.clientId } : {}),
        ...(d.referenceNumber !== undefined ? { referenceNumber: d.referenceNumber || null } : {}),
        ...(d.projectName !== undefined ? { projectName: d.projectName || null } : {}),
        ...(d.placeOfSupply !== undefined ? { placeOfSupply: nextPlaceOfSupply } : {}),
        ...(d.adjustmentLabel !== undefined ? { adjustmentLabel: d.adjustmentLabel || null } : {}),
        ...(d.issueDate ? { issueDate: new Date(d.issueDate) } : {}),
        ...(d.dueDate ? { dueDate: nextDue } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
        ...(d.terms !== undefined ? { terms: d.terms || null } : {}),
        ...(d.recurring !== undefined ? { recurring: d.recurring } : {}),
        ...(d.recurringCycle !== undefined ? { recurringCycle: d.recurringCycle || null } : {}),
        status: nextStatus,
        ...totalsData,
      },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
    });

    res.json({ invoice: await attachUpiInfo(serializeInvoice(updated), settings) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const updated = await db.invoice.update({
      where: { id: req.params.id },
      data: { status: parsed.data.status },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
    });
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    res.json({ invoice: await attachUpiInfo(serializeInvoice(updated), settings) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const existing = await db.invoice.findUnique({
      where: { id: req.params.id },
      include: { client: true, items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!existing) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const now = new Date();
    const dueDate = new Date(now.getTime() + 7 * 86_400_000);
    const fy = getIndianFinancialYear(now);
    const prefix = (settings?.invoicePrefix || 'INV').trim() || 'INV';
    const invoiceNumber = await nextSequenceNumber({
      model: 'invoice',
      field: 'invoiceNumber',
      prefixWithDash: `${prefix}-${fy}-`,
    });

    const created = await db.invoice.create({
      data: {
        invoiceNumber,
        financialYear: fy,
        clientId: existing.clientId,
        referenceNumber: existing.referenceNumber || null,
        projectName: existing.projectName || null,
        placeOfSupply: existing.placeOfSupply || null,
        issueDate: now,
        dueDate,
        gstMode: existing.gstMode,
        subtotal: existing.subtotal,
        discountTotal: existing.discountTotal,
        cgstTotal: existing.cgstTotal,
        sgstTotal: existing.sgstTotal,
        igstTotal: existing.igstTotal,
        taxTotal: existing.taxTotal,
        roundOff: existing.roundOff,
        adjustmentLabel: existing.adjustmentLabel || null,
        total: existing.total,
        amountPaid: 0,
        status: 'DRAFT',
        notes: existing.notes,
        terms: existing.terms,
        publicToken: generateRandomToken(20),
        items: {
          create: (existing.items || []).map((it: any, idx: number) => ({
            itemName: it.itemName || null,
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: Number(it.qty),
            rate: Number(it.rate),
            discount: Number(it.discount),
            taxPercent: Number(it.taxPercent),
            lineTotal: Number(it.lineTotal),
            domainId: it.domainId || null,
            serviceId: it.serviceId || null,
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

    res.status(201).json({ invoice: await attachUpiInfo(serializeInvoice(created), settings) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/credit-note', async (req, res, next) => {
  try {
    const schema = z.object({
      amount: z.coerce.number().positive('Credit amount must be > 0'),
      reason: z.string().trim().max(2000).optional().nullable(),
      issuedAt: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid credit note input' });
      return;
    }

    const invoice = await db.invoice.findUnique({
      where: { id: req.params.id },
      include: { creditNotes: true },
    });
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const existingCredits = (invoice.creditNotes || []).reduce(
      (acc: number, c: any) => acc + Number(c.amount ?? 0),
      0
    );
    const remaining = round2(Number(invoice.total) - Number(invoice.amountPaid || 0) - existingCredits);
    if (parsed.data.amount > remaining + 0.01) {
      res.status(400).json({ error: `Credit note exceeds remaining balance (${remaining.toFixed(2)})` });
      return;
    }

    const issuedAt = parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : new Date();
    const fy = getIndianFinancialYear(issuedAt);
    const creditNoteNumber = await nextSequenceNumber({
      model: 'creditNote',
      field: 'creditNoteNumber',
      prefixWithDash: `CN-${fy}-`,
    });

    const createdCn = await db.creditNote.create({
      data: {
        creditNoteNumber,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        issuedAt,
        amount: parsed.data.amount,
        reason: parsed.data.reason || null,
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    });

    const newStatus = deriveInvoiceStatus({
      currentStatus: invoice.status,
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid || 0),
      creditTotal: existingCredits + parsed.data.amount,
      dueDate: invoice.dueDate,
    });
    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: newStatus },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'CREDIT_NOTE_ISSUED',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Issued credit note ${createdCn.creditNoteNumber} (${parsed.data.amount}) on ${invoice.invoiceNumber}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ creditNote: serializeCreditNote(createdCn), invoiceStatus: newStatus });
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

    const invoice = await db.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
    });
    if (!invoice || !invoice.client) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const payLink = `${baseUrl}/public/invoice/${invoice.publicToken}`;
    const balance = Math.max(0, Number(invoice.total) - Number(invoice.amountPaid || 0));

    const tpl = await db.messageTemplate.findFirst({
      where: { slug: 'invoice-sent-en', channel: parsed.data.channel },
    });

    const vars = {
      client_name: invoice.client.contactPerson || invoice.client.name,
      business_name: settings?.businessName || 'Aligarh Web Solutions',
      invoice_no: invoice.invoiceNumber,
      amount: formatINR(balance > 0 ? balance : Number(invoice.total), { decimals: 2 }),
      expiry_date: formatDateDDMMMYYYY(invoice.dueDate),
      pay_link: payLink,
    };

    const subject = renderTemplateText(
      tpl?.subject || `Invoice ${invoice.invoiceNumber} from ${vars.business_name}`,
      vars
    );
    const bodyText = renderTemplateText(
      tpl?.body ||
        `Hello {{client_name}},\n\nPlease find attached Invoice {{invoice_no}} for {{amount}} (due {{expiry_date}}).\n\nView & Pay Online: {{pay_link}}\n\nRegards,\n{{business_name}}`,
      vars
    );

    let sendRes;
    if (parsed.data.channel === 'EMAIL') {
      const emails = Array.isArray(invoice.client.emails)
        ? invoice.client.emails.map((e: any) => String(e || '').trim()).filter(Boolean)
        : [];
      const pdfBuf = await generateInvoicePdfBuffer(serializeInvoice(invoice), settings || {});
      sendRes = await sendEmailMessage({
        to: emails,
        subject,
        text: bodyText,
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            content: pdfBuf,
            contentType: 'application/pdf',
          },
        ],
        settings,
        forceDryRun: parsed.data.dryRun,
      });
    } else {
      sendRes = await whatsappProvider.sendMessage({
        to: invoice.client.whatsappPhone || '',
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
        clientId: invoice.clientId,
        channel: parsed.data.channel,
        templateId: tpl?.id || null,
        renderedSubject: parsed.data.channel === 'EMAIL' ? subject : null,
        renderedContent: bodyText,
        entityType: 'INVOICE',
        entityId: invoice.id,
        sentAt: sendRes.ok ? now : null,
        status: sendRes.ok ? 'SENT' : 'FAILED',
        providerMessageId: sendRes.providerMessageId || null,
        error: sendRes.error || null,
        direction: 'OUTBOUND',
      },
    });

    if (sendRes.ok && invoice.status === 'DRAFT') {
      await db.invoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'INVOICE_SENT',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Sent invoice ${invoice.invoiceNumber} via ${parsed.data.channel} (${sendRes.ok ? 'SENT' : 'FAILED'})`,
      ipAddress: getClientIp(req),
    });

    if (!sendRes.ok) {
      res.status(400).json({ ok: false, error: sendRes.error || 'Failed to send invoice' });
      return;
    }

    const refreshed = await db.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
    });
    res.json({ ok: true, invoice: await attachUpiInfo(serializeInvoice(refreshed), settings), dryRun: sendRes.dryRun });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    await db.invoice.delete({ where: { id: req.params.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'INVOICE_DELETED',
      entityType: 'Invoice',
      entityId: existing.id,
      summary: `Deleted invoice ${existing.invoiceNumber}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
