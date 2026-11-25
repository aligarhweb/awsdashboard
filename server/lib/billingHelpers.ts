import { db } from '../db';
import { getDaysLeftIST, getIstDateParts } from '../../shared/dates';
import { round2 } from '../../shared/billing';
import { BillingCycle, InvoiceStatus } from '../../shared/types';

export async function nextSequenceNumber(params: {
  model: 'invoice' | 'estimate' | 'payment' | 'creditNote';
  field: 'invoiceNumber' | 'estimateNumber' | 'receiptNumber' | 'creditNoteNumber';
  prefixWithDash: string;
}): Promise<string> {
  const rows = await (db as any)[params.model].findMany({
    where: {
      [params.field]: { contains: params.prefixWithDash },
    },
  });

  let maxSeq = 0;
  for (const r of rows as any[]) {
    const val = String(r[params.field] || '');
    if (!val.startsWith(params.prefixWithDash)) continue;
    const tail = val.slice(params.prefixWithDash.length);
    const num = Number.parseInt(tail, 10);
    if (Number.isFinite(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  return `${params.prefixWithDash}${String(maxSeq + 1).padStart(4, '0')}`;
}

export function deriveInvoiceStatus(params: {
  currentStatus: string;
  total: number;
  amountPaid: number;
  creditTotal?: number;
  dueDate: Date | string;
  now?: Date;
}): InvoiceStatus {
  if (params.currentStatus === 'CANCELLED') return 'CANCELLED';

  const total = round2(params.total);
  const effectiveSettled = round2(params.amountPaid + (params.creditTotal || 0));
  const balance = round2(total - effectiveSettled);

  if (total > 0 && balance <= 0.01) return 'PAID';
  if (params.currentStatus === 'DRAFT') return 'DRAFT';
  if (params.amountPaid > 0 && balance > 0.01) {
    const daysLeft = getDaysLeftIST(params.dueDate, params.now || new Date());
    return daysLeft < 0 ? 'OVERDUE' : 'PARTIALLY_PAID';
  }

  const daysLeft = getDaysLeftIST(params.dueDate, params.now || new Date());
  if (daysLeft < 0 && ['SENT', 'VIEWED', 'OVERDUE'].includes(params.currentStatus)) {
    return 'OVERDUE';
  }

  if (params.currentStatus === 'VIEWED') return 'VIEWED';
  return 'SENT';
}

export function addBillingCycleDate(baseDate: Date | string, cycle: BillingCycle, yearsOverride = 1): Date {
  const d = new Date(baseDate);
  if (cycle === 'MONTHLY') {
    d.setUTCMonth(d.getUTCMonth() + 1);
  } else if (cycle === 'QUARTERLY') {
    d.setUTCMonth(d.getUTCMonth() + 3);
  } else if (cycle === 'MULTI_YEAR') {
    d.setUTCFullYear(d.getUTCFullYear() + Math.max(2, yearsOverride));
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + Math.max(1, yearsOverride));
  }
  return d;
}

export function serializeEstimate(e: any) {
  return {
    id: e.id,
    estimateNumber: e.estimateNumber,
    zohoEstimateId: e.zohoEstimateId ?? null,
    clientId: e.clientId,
    referenceNumber: e.referenceNumber ?? null,
    projectName: e.projectName ?? null,
    placeOfSupply: e.placeOfSupply ?? null,
    issueDate: e.issueDate instanceof Date ? e.issueDate.toISOString() : e.issueDate,
    validUntil: e.validUntil instanceof Date ? e.validUntil.toISOString() : e.validUntil,
    gstMode: e.gstMode,
    subtotal: Number(e.subtotal ?? 0),
    discountTotal: Number(e.discountTotal ?? 0),
    taxTotal: Number(e.taxTotal ?? 0),
    roundOff: Number(e.roundOff ?? 0),
    adjustmentLabel: e.adjustmentLabel ?? null,
    total: Number(e.total ?? 0),
    notes: e.notes ?? null,
    terms: e.terms ?? null,
    status: e.status,
    publicToken: e.publicToken,
    clientComment: e.clientComment ?? null,
    convertedInvoiceId: e.convertedInvoiceId ?? null,
    viewedAt: e.viewedAt instanceof Date ? e.viewedAt.toISOString() : e.viewedAt ?? null,
    respondedAt: e.respondedAt instanceof Date ? e.respondedAt.toISOString() : e.respondedAt ?? null,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
    updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : e.updatedAt,
    ...(e.client
      ? {
          client: {
            id: e.client.id,
            name: e.client.name,
            company: e.client.company ?? null,
            state: e.client.state ?? null,
            gstin: e.client.gstin ?? null,
            emails: Array.isArray(e.client.emails) ? e.client.emails : [],
            whatsappPhone: e.client.whatsappPhone ?? null,
            address: e.client.address ?? null,
          },
        }
      : {}),
    items: (e.items || []).map((it: any) => ({
      id: it.id,
      itemName: it.itemName ?? null,
      description: it.description,
      hsnSac: it.hsnSac ?? null,
      qty: Number(it.qty ?? 1),
      rate: Number(it.rate ?? 0),
      discount: Number(it.discount ?? 0),
      taxPercent: Number(it.taxPercent ?? 0),
      lineTotal: Number(it.lineTotal ?? 0),
      sortOrder: Number(it.sortOrder ?? 0),
    })),
  };
}

export function serializePayment(p: any) {
  return {
    id: p.id,
    receiptNumber: p.receiptNumber,
    invoiceId: p.invoiceId,
    clientId: p.clientId,
    paidAt: p.paidAt instanceof Date ? p.paidAt.toISOString() : p.paidAt,
    amount: Number(p.amount ?? 0),
    method: p.method,
    referenceUtr: p.referenceUtr ?? null,
    notes: p.notes ?? null,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    ...(p.client
      ? {
          client: {
            id: p.client.id,
            name: p.client.name,
            company: p.client.company ?? null,
          },
        }
      : {}),
    ...(p.invoice
      ? {
          invoice: {
            id: p.invoice.id,
            invoiceNumber: p.invoice.invoiceNumber,
            total: Number(p.invoice.total ?? 0),
            amountPaid: Number(p.invoice.amountPaid ?? 0),
            status: p.invoice.status,
          },
        }
      : {}),
  };
}

export function serializeCreditNote(cn: any) {
  return {
    id: cn.id,
    creditNoteNumber: cn.creditNoteNumber,
    invoiceId: cn.invoiceId,
    clientId: cn.clientId,
    issuedAt: cn.issuedAt instanceof Date ? cn.issuedAt.toISOString() : cn.issuedAt,
    amount: Number(cn.amount ?? 0),
    reason: cn.reason ?? null,
    createdAt: cn.createdAt instanceof Date ? cn.createdAt.toISOString() : cn.createdAt,
    ...(cn.client
      ? {
          client: {
            id: cn.client.id,
            name: cn.client.name,
            company: cn.client.company ?? null,
          },
        }
      : {}),
    ...(cn.invoice
      ? {
          invoice: {
            id: cn.invoice.id,
            invoiceNumber: cn.invoice.invoiceNumber,
          },
        }
      : {}),
  };
}

export function serializeInvoice(inv: any) {
  const total = Number(inv.total ?? 0);
  const amountPaid = Number(inv.amountPaid ?? 0);
  const creditTotal = Array.isArray(inv.creditNotes)
    ? inv.creditNotes.reduce((acc: number, c: any) => acc + Number(c.amount ?? 0), 0)
    : 0;
  const balanceDue = Math.max(0, round2(total - amountPaid - creditTotal));

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    financialYear: inv.financialYear,
    clientId: inv.clientId,
    referenceNumber: inv.referenceNumber ?? null,
    projectName: inv.projectName ?? null,
    placeOfSupply: inv.placeOfSupply ?? null,
    issueDate: inv.issueDate instanceof Date ? inv.issueDate.toISOString() : inv.issueDate,
    dueDate: inv.dueDate instanceof Date ? inv.dueDate.toISOString() : inv.dueDate,
    gstMode: inv.gstMode,
    subtotal: Number(inv.subtotal ?? 0),
    discountTotal: Number(inv.discountTotal ?? 0),
    cgstTotal: Number(inv.cgstTotal ?? 0),
    sgstTotal: Number(inv.sgstTotal ?? 0),
    igstTotal: Number(inv.igstTotal ?? 0),
    taxTotal: Number(inv.taxTotal ?? 0),
    roundOff: Number(inv.roundOff ?? 0),
    adjustmentLabel: inv.adjustmentLabel ?? null,
    total,
    amountPaid,
    balanceDue,
    status: inv.status,
    notes: inv.notes ?? null,
    terms: inv.terms ?? null,
    publicToken: inv.publicToken,
    viewedAt: inv.viewedAt instanceof Date ? inv.viewedAt.toISOString() : inv.viewedAt ?? null,
    recurring: Boolean(inv.recurring),
    recurringCycle: inv.recurringCycle ?? null,
    nextRecurringAt:
      inv.nextRecurringAt instanceof Date
        ? inv.nextRecurringAt.toISOString()
        : inv.nextRecurringAt ?? null,
    razorpayOrderId: inv.razorpayOrderId ?? null,
    razorpayLinkUrl: inv.razorpayLinkUrl ?? null,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt,
    updatedAt: inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : inv.updatedAt,
    ...(inv.client
      ? {
          client: {
            id: inv.client.id,
            name: inv.client.name,
            company: inv.client.company ?? null,
            state: inv.client.state ?? null,
            gstin: inv.client.gstin ?? null,
            emails: Array.isArray(inv.client.emails) ? inv.client.emails : [],
            whatsappPhone: inv.client.whatsappPhone ?? null,
            address: inv.client.address ?? null,
          },
        }
      : {}),
    items: (inv.items || []).map((it: any) => ({
      id: it.id,
      itemName: it.itemName ?? null,
      description: it.description,
      hsnSac: it.hsnSac ?? null,
      qty: Number(it.qty ?? 1),
      rate: Number(it.rate ?? 0),
      discount: Number(it.discount ?? 0),
      taxPercent: Number(it.taxPercent ?? 0),
      lineTotal: Number(it.lineTotal ?? 0),
      domainId: it.domainId ?? null,
      serviceId: it.serviceId ?? null,
      sortOrder: Number(it.sortOrder ?? 0),
    })),
    ...(Array.isArray(inv.payments) ? { payments: inv.payments.map(serializePayment) } : {}),
    ...(Array.isArray(inv.creditNotes) ? { creditNotes: inv.creditNotes.map(serializeCreditNote) } : {}),
  };
}

export function getCurrentMonthIstBounds(now = new Date()): { start: Date; end: Date } {
  const { year, month } = getIstDateParts(now);
  // IST is UTC+05:30 -> start of month 00:00 IST = previous day 18:30 UTC
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 330 * 60_000);
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 330 * 60_000 - 1);
  return { start, end };
}

export function getCurrentFyIstBounds(now = new Date()): { start: Date; end: Date } {
  const { year, month } = getIstDateParts(now);
  const fyStartYear = month >= 4 ? year : year - 1;
  const start = new Date(Date.UTC(fyStartYear, 3, 1, 0, 0, 0) - 330 * 60_000);
  const end = new Date(Date.UTC(fyStartYear + 1, 3, 1, 0, 0, 0) - 330 * 60_000 - 1);
  return { start, end };
}
