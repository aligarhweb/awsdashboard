import { Router } from 'express';
import Papa from 'papaparse';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { round2 } from '../../shared/billing';
import { formatDateDDMMMYYYY, getDaysLeftIST, getIstDateParts } from '../../shared/dates';
import { getCurrentFyIstBounds } from '../lib/billingHelpers';
import { ReportsSummaryDTO } from '../../shared/types';

const router = Router();
router.use(requireAuth);

function parseDateBounds(req: any) {
  const fyBounds = getCurrentFyIstBounds();
  const fromStr = String(req.query.from || '').trim();
  const toStr = String(req.query.to || '').trim();
  const from = fromStr ? new Date(`${fromStr}T00:00:00+05:30`) : fyBounds.start;
  const to = toStr ? new Date(`${toStr}T23:59:59+05:30`) : fyBounds.end;
  return {
    from: Number.isNaN(from.getTime()) ? fyBounds.start : from,
    to: Number.isNaN(to.getTime()) ? fyBounds.end : to,
  };
}

async function buildReportsData(from: Date, to: Date): Promise<ReportsSummaryDTO> {
  const now = new Date();
  const [invoices, payments, expenses, domains, services] = await Promise.all([
    db.invoice.findMany({
      include: {
        client: { select: { id: true, name: true, gstin: true, state: true } },
        creditNotes: true,
      },
      orderBy: { issueDate: 'desc' },
    }),
    db.payment.findMany({ orderBy: { paidAt: 'desc' } }),
    db.expense.findMany({ orderBy: { date: 'desc' } }),
    db.domain.findMany({
      include: { client: { select: { id: true, name: true } } },
      orderBy: { expiryDate: 'asc' },
    }),
    db.service.findMany({
      include: { client: { select: { id: true, name: true } } },
      orderBy: { renewalDate: 'asc' },
    }),
  ]);

  const inRangeInvoices = (invoices as any[]).filter((inv) => {
    if (inv.status === 'CANCELLED') return false;
    const t = new Date(inv.issueDate).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

  const inRangePayments = (payments as any[]).filter((p) => {
    const t = new Date(p.paidAt).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

  const inRangeExpenses = (expenses as any[]).filter((e) => {
    const t = new Date(e.date).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

  let billedTotal = 0;
  let taxableTotal = 0;
  let taxTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  const gstMap = new Map<
    string,
    {
      monthKey: string;
      monthLabel: string;
      invoiceCount: number;
      taxableValue: number;
      cgst: number;
      sgst: number;
      igst: number;
      totalTax: number;
      invoiceTotal: number;
    }
  >();

  const salesRegister: ReportsSummaryDTO['salesRegister'] = [];

  for (const inv of inRangeInvoices) {
    const total = Number(inv.total ?? 0);
    const taxable = round2(Number(inv.subtotal ?? 0) - Number(inv.discountTotal ?? 0));
    const cgst = Number(inv.cgstTotal ?? 0);
    const sgst = Number(inv.sgstTotal ?? 0);
    const igst = Number(inv.igstTotal ?? 0);
    const tax = Number(inv.taxTotal ?? 0);
    const paid = Number(inv.amountPaid ?? 0);
    const credits = (inv.creditNotes || []).reduce((acc: number, c: any) => acc + Number(c.amount ?? 0), 0);
    const balance = Math.max(0, round2(total - paid - credits));

    billedTotal = round2(billedTotal + total);
    taxableTotal = round2(taxableTotal + taxable);
    taxTotal = round2(taxTotal + tax);
    cgstTotal = round2(cgstTotal + cgst);
    sgstTotal = round2(sgstTotal + sgst);
    igstTotal = round2(igstTotal + igst);

    salesRegister.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      issueDate: new Date(inv.issueDate).toISOString(),
      dueDate: new Date(inv.dueDate).toISOString(),
      clientId: inv.clientId,
      clientName: inv.client?.name || 'Unknown',
      clientGstin: inv.client?.gstin || null,
      placeOfSupply: inv.placeOfSupply || inv.client?.state || null,
      gstMode: inv.gstMode,
      taxableValue: taxable,
      cgst,
      sgst,
      igst,
      total,
      amountPaid: paid,
      balanceDue: balance,
      status: inv.status,
    });

    const parts = getIstDateParts(inv.issueDate);
    const monthKey = `${parts.year}-${String(parts.month).padStart(2, '0')}`;
    const monthLabel = new Date(Date.UTC(parts.year, parts.month - 1, 1)).toLocaleString('en-IN', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const bucket = gstMap.get(monthKey) || {
      monthKey,
      monthLabel,
      invoiceCount: 0,
      taxableValue: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      invoiceTotal: 0,
    };
    bucket.invoiceCount += 1;
    bucket.taxableValue = round2(bucket.taxableValue + taxable);
    bucket.cgst = round2(bucket.cgst + cgst);
    bucket.sgst = round2(bucket.sgst + sgst);
    bucket.igst = round2(bucket.igst + igst);
    bucket.totalTax = round2(bucket.totalTax + tax);
    bucket.invoiceTotal = round2(bucket.invoiceTotal + total);
    gstMap.set(monthKey, bucket);
  }

  // Outstanding aging across all open invoices
  const agingBuckets: ReportsSummaryDTO['agingBuckets'] = {
    current: { count: 0, amount: 0 },
    days0to30: { count: 0, amount: 0 },
    days31to60: { count: 0, amount: 0 },
    days61Plus: { count: 0, amount: 0 },
    items: [],
  };

  let outstandingTotal = 0;
  for (const inv of invoices as any[]) {
    if (['DRAFT', 'CANCELLED', 'PAID'].includes(inv.status)) continue;
    const credits = (inv.creditNotes || []).reduce((acc: number, c: any) => acc + Number(c.amount ?? 0), 0);
    const balance = Math.max(0, round2(Number(inv.total) - Number(inv.amountPaid || 0) - credits));
    if (balance <= 0.01) continue;

    outstandingTotal = round2(outstandingTotal + balance);
    const daysLeft = getDaysLeftIST(inv.dueDate, now);
    const daysOverdue = Math.max(0, -daysLeft);

    let bucketName: 'CURRENT' | '0-30' | '31-60' | '61+' = 'CURRENT';
    if (daysLeft >= 0) {
      agingBuckets.current.count += 1;
      agingBuckets.current.amount = round2(agingBuckets.current.amount + balance);
    } else if (daysOverdue <= 30) {
      bucketName = '0-30';
      agingBuckets.days0to30.count += 1;
      agingBuckets.days0to30.amount = round2(agingBuckets.days0to30.amount + balance);
    } else if (daysOverdue <= 60) {
      bucketName = '31-60';
      agingBuckets.days31to60.count += 1;
      agingBuckets.days31to60.amount = round2(agingBuckets.days31to60.amount + balance);
    } else {
      bucketName = '61+';
      agingBuckets.days61Plus.count += 1;
      agingBuckets.days61Plus.amount = round2(agingBuckets.days61Plus.amount + balance);
    }

    agingBuckets.items.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: inv.client?.name || 'Unknown',
      dueDate: new Date(inv.dueDate).toISOString(),
      daysOverdue,
      bucket: bucketName,
      balanceDue: balance,
      status: inv.status,
    });
  }

  const renewalProfitItems: ReportsSummaryDTO['renewalProfitItems'] = [];
  let estimatedRenewalProfit90d = 0;

  for (const d of domains as any[]) {
    if (d.status === 'TRANSFERRED') continue;
    const daysLeft = getDaysLeftIST(d.expiryDate, now);
    if (daysLeft >= 0 && daysLeft <= 90) {
      const cost = Number(d.costPrice ?? 0);
      const sell = Number(d.sellingPrice ?? 0);
      const profit = round2(sell - cost);
      estimatedRenewalProfit90d = round2(estimatedRenewalProfit90d + profit);
      renewalProfitItems.push({
        kind: 'DOMAIN',
        id: d.id,
        name: d.name,
        clientName: d.client?.name || 'Unknown',
        renewalDate: new Date(d.expiryDate).toISOString(),
        costPrice: cost,
        sellingPrice: sell,
        profit,
      });
    }
  }

  for (const s of services as any[]) {
    if (['CANCELLED', 'SUSPENDED'].includes(s.status)) continue;
    const daysLeft = getDaysLeftIST(s.renewalDate, now);
    if (daysLeft >= 0 && daysLeft <= 90) {
      const cost = Number(s.costPrice ?? 0);
      const sell = Number(s.sellingPrice ?? 0);
      const profit = round2(sell - cost);
      estimatedRenewalProfit90d = round2(estimatedRenewalProfit90d + profit);
      renewalProfitItems.push({
        kind: 'SERVICE',
        id: s.id,
        name: s.planName,
        clientName: s.client?.name || 'Unknown',
        renewalDate: new Date(s.renewalDate).toISOString(),
        costPrice: cost,
        sellingPrice: sell,
        profit,
      });
    }
  }

  renewalProfitItems.sort((a, b) => new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime());

  const collectedTotal = round2(inRangePayments.reduce((acc, p) => acc + Number(p.amount ?? 0), 0));
  const expensesTotal = round2(inRangeExpenses.reduce((acc, e) => acc + Number(e.amount ?? 0), 0));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      billedTotal,
      taxableTotal,
      taxTotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      collectedTotal,
      outstandingTotal,
      expensesTotal,
      estimatedRenewalProfit90d,
    },
    salesRegister,
    gstMonthly: Array.from(gstMap.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    agingBuckets,
    renewalProfitItems,
  };
}

router.get('/summary', async (req, res, next) => {
  try {
    const { from, to } = parseDateBounds(req);
    const summary = await buildReportsData(from, to);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/client-statement/:clientId', async (req, res, next) => {
  try {
    const client = await db.client.findUnique({ where: { id: req.params.clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const [invoices, payments, creditNotes] = await Promise.all([
      db.invoice.findMany({ where: { clientId: client.id } }),
      db.payment.findMany({
        where: { clientId: client.id },
        include: { invoice: { select: { invoiceNumber: true } } },
      }),
      db.creditNote.findMany({
        where: { clientId: client.id },
        include: { invoice: { select: { invoiceNumber: true } } },
      }),
    ]);

    const entries: Array<{
      date: string;
      type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE';
      reference: string;
      details: string;
      debit: number;
      credit: number;
      runningBalance: number;
    }> = [];

    for (const inv of invoices as any[]) {
      if (inv.status === 'CANCELLED' || inv.status === 'DRAFT') continue;
      entries.push({
        date: new Date(inv.issueDate).toISOString(),
        type: 'INVOICE',
        reference: inv.invoiceNumber,
        details: `Invoice due ${formatDateDDMMMYYYY(inv.dueDate)} (${inv.status})`,
        debit: Number(inv.total ?? 0),
        credit: 0,
        runningBalance: 0,
      });
    }

    for (const p of payments as any[]) {
      entries.push({
        date: new Date(p.paidAt).toISOString(),
        type: 'PAYMENT',
        reference: p.receiptNumber,
        details: `${p.method} payment for ${p.invoice?.invoiceNumber || 'Invoice'}${p.referenceUtr ? ` (${p.referenceUtr})` : ''}`,
        debit: 0,
        credit: Number(p.amount ?? 0),
        runningBalance: 0,
      });
    }

    for (const cn of creditNotes as any[]) {
      entries.push({
        date: new Date(cn.issuedAt).toISOString(),
        type: 'CREDIT_NOTE',
        reference: cn.creditNoteNumber,
        details: `Credit note for ${cn.invoice?.invoiceNumber || 'Invoice'}${cn.reason ? ` — ${cn.reason}` : ''}`,
        debit: 0,
        credit: Number(cn.amount ?? 0),
        runningBalance: 0,
      });
    }

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    let totalInvoiced = 0;
    let totalPaid = 0;
    for (const entry of entries) {
      totalInvoiced = round2(totalInvoiced + entry.debit);
      totalPaid = round2(totalPaid + entry.credit);
      running = round2(running + entry.debit - entry.credit);
      entry.runningBalance = running;
    }

    res.json({
      client: { id: client.id, name: client.name, company: client.company, gstin: client.gstin },
      totals: { totalInvoiced, totalPaid, closingBalance: running },
      entries,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/export/sales-csv', async (req, res, next) => {
  try {
    const { from, to } = parseDateBounds(req);
    const summary = await buildReportsData(from, to);
    const rows = summary.salesRegister.map((r) => ({
      invoice_number: r.invoiceNumber,
      issue_date: formatDateDDMMMYYYY(r.issueDate),
      due_date: formatDateDDMMMYYYY(r.dueDate),
      client_name: r.clientName,
      client_gstin: r.clientGstin || '',
      place_of_supply: r.placeOfSupply || '',
      gst_mode: r.gstMode,
      taxable_value: r.taxableValue.toFixed(2),
      cgst: r.cgst.toFixed(2),
      sgst: r.sgst.toFixed(2),
      igst: r.igst.toFixed(2),
      total: r.total.toFixed(2),
      amount_paid: r.amountPaid.toFixed(2),
      balance_due: r.balanceDue.toFixed(2),
      status: r.status,
    }));
    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-register.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get('/export/gst-csv', async (req, res, next) => {
  try {
    const { from, to } = parseDateBounds(req);
    const summary = await buildReportsData(from, to);
    const rows = summary.gstMonthly.map((m) => ({
      month: m.monthLabel,
      invoice_count: m.invoiceCount,
      taxable_value: m.taxableValue.toFixed(2),
      cgst: m.cgst.toFixed(2),
      sgst: m.sgst.toFixed(2),
      igst: m.igst.toFixed(2),
      total_tax: m.totalTax.toFixed(2),
      invoice_total: m.invoiceTotal.toFixed(2),
    }));
    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gst-monthly-summary.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get('/export/zoho-books-csv', async (req, res, next) => {
  try {
    const { from, to } = parseDateBounds(req);
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const invoices = await db.invoice.findMany({
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        creditNotes: true,
      },
      orderBy: { issueDate: 'asc' },
    });

    const rows: Record<string, any>[] = [];
    for (const inv of invoices as any[]) {
      if (inv.status === 'CANCELLED') continue;
      const t = new Date(inv.issueDate).getTime();
      if (t < from.getTime() || t > to.getTime()) continue;
      const credits = (inv.creditNotes || []).reduce((acc: number, c: any) => acc + Number(c.amount ?? 0), 0);
      const balance = Math.max(0, round2(Number(inv.total) - Number(inv.amountPaid || 0) - credits));

      const zohoStatus =
        inv.status === 'PAID'
          ? 'Closed'
          : inv.status === 'OVERDUE'
            ? 'Overdue'
            : inv.status === 'DRAFT'
              ? 'Draft'
              : 'Sent';

      for (const it of (inv.items || []) as any[]) {
        rows.push({
          'Invoice Date': new Date(inv.issueDate).toISOString().slice(0, 10),
          'Invoice Number': inv.invoiceNumber,
          'Invoice Status': zohoStatus,
          'Customer Name': inv.client?.name || '',
          'GST Identification Number (GSTIN)': inv.client?.gstin || '',
          'Place of Supply': inv.client?.state || settings?.businessState || 'Uttar Pradesh',
          'Due Date': new Date(inv.dueDate).toISOString().slice(0, 10),
          'Currency Code': 'INR',
          'SubTotal': Number(inv.subtotal ?? 0).toFixed(2),
          'Total': Number(inv.total ?? 0).toFixed(2),
          'Balance': balance.toFixed(2),
          'Item Name': it.description,
          'Item Desc': it.description,
          'HSN/SAC': it.hsnSac || '998314',
          'Quantity': Number(it.qty ?? 1),
          'Item Price': Number(it.rate ?? 0).toFixed(2),
          'Discount Amount': Number(it.discount ?? 0).toFixed(2),
          'Tax Name':
            inv.gstMode === 'NONE'
              ? ''
              : inv.gstMode === 'IGST'
                ? `IGST${Number(it.taxPercent ?? 18)}`
                : `GST${Number(it.taxPercent ?? 18)}`,
          'Tax Percentage': inv.gstMode === 'NONE' ? 0 : Number(it.taxPercent ?? 18),
        });
      }
    }

    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zoho-books-invoices.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
