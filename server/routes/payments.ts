import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { round2 } from '../../shared/billing';
import { getIstDateParts } from '../../shared/dates';
import {
  addBillingCycleDate,
  deriveInvoiceStatus,
  nextSequenceNumber,
  serializeCreditNote,
  serializePayment,
} from '../lib/billingHelpers';
import { generateReceiptPdfBuffer } from '../lib/pdfGenerator';

const router = Router();
router.use(requireAuth);

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  paidAt: z.string().min(1),
  amount: z.coerce.number().positive('Payment amount must be > 0'),
  method: z.enum(['UPI', 'BANK', 'CASH', 'RAZORPAY', 'OTHER']).default('UPI'),
  referenceUtr: z.string().trim().max(128).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const method = String(req.query.method || '').trim();
    const clientId = String(req.query.clientId || '').trim();

    const [payments, creditNotes] = await Promise.all([
      db.payment.findMany({
        where: {
          ...(method && method !== 'ALL' ? { method: method as any } : {}),
          ...(clientId ? { clientId } : {}),
        },
        include: {
          client: { select: { id: true, name: true, company: true } },
          invoice: { select: { id: true, invoiceNumber: true, total: true, amountPaid: true, status: true } },
        },
        orderBy: { paidAt: 'desc' },
      }),
      db.creditNote.findMany({
        where: clientId ? { clientId } : undefined,
        include: {
          client: { select: { id: true, name: true, company: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: { issuedAt: 'desc' },
      }),
    ]);

    const filteredPayments = payments.filter((p: any) => {
      if (!q) return true;
      const hay = `${p.receiptNumber} ${p.referenceUtr || ''} ${p.client?.name || ''} ${p.invoice?.invoiceNumber || ''}`.toLowerCase();
      return hay.includes(q);
    });

    res.json({
      items: filteredPayments.map(serializePayment),
      creditNotes: creditNotes.map(serializeCreditNote),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const payment = await db.payment.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        invoice: { include: { client: true } },
      },
    });
    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const pdfBuffer = await generateReceiptPdfBuffer(
      serializePayment(payment),
      payment.invoice,
      settings
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payment.receiptNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payment data', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const invoice = await db.invoice.findUnique({
      where: { id: d.invoiceId },
      include: {
        client: true,
        items: { include: { domain: true, service: true } },
        creditNotes: true,
      },
    });
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    if (invoice.status === 'CANCELLED') {
      res.status(400).json({ error: 'Cannot record payment on a cancelled invoice' });
      return;
    }

    const creditTotal = (invoice.creditNotes || []).reduce(
      (acc: number, c: any) => acc + Number(c.amount ?? 0),
      0
    );
    const currentPaid = Number(invoice.amountPaid || 0);
    const remaining = round2(Number(invoice.total) - currentPaid - creditTotal);
    if (d.amount > remaining + 0.01) {
      res.status(400).json({ error: `Payment exceeds remaining balance (${remaining.toFixed(2)})` });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const paidAt = new Date(d.paidAt);
    const { year } = getIstDateParts(paidAt);
    const prefix = (settings?.receiptPrefix || 'RCPT').trim() || 'RCPT';
    const receiptNumber = await nextSequenceNumber({
      model: 'payment',
      field: 'receiptNumber',
      prefixWithDash: `${prefix}-${year}-`,
    });

    const created = await db.payment.create({
      data: {
        receiptNumber,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        paidAt,
        amount: d.amount,
        method: d.method,
        referenceUtr: d.referenceUtr || null,
        notes: d.notes || null,
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        invoice: { select: { id: true, invoiceNumber: true, total: true, amountPaid: true, status: true } },
      },
    });

    const nextAmountPaid = round2(currentPaid + d.amount);
    const nextStatus = deriveInvoiceStatus({
      currentStatus: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
      total: Number(invoice.total),
      amountPaid: nextAmountPaid,
      creditTotal,
      dueDate: invoice.dueDate,
    });

    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: nextAmountPaid,
        status: nextStatus,
      },
    });

    // If invoice became PAID and references domains/services, suggest extending expiry/renewal dates
    const linkedRenewals: Array<{
      kind: 'DOMAIN' | 'SERVICE';
      id: string;
      name: string;
      currentDate: string;
      nextDate: string;
    }> = [];

    if (nextStatus === 'PAID') {
      const seen = new Set<string>();
      for (const it of (invoice.items || []) as any[]) {
        if (it.domainId && it.domain && !seen.has(`D:${it.domainId}`)) {
          seen.add(`D:${it.domainId}`);
          const base =
            new Date(it.domain.expiryDate).getTime() < Date.now()
              ? new Date()
              : new Date(it.domain.expiryDate);
          const next = new Date(base);
          next.setUTCFullYear(next.getUTCFullYear() + Math.max(1, Number(it.domain.renewalYears || 1)));
          linkedRenewals.push({
            kind: 'DOMAIN',
            id: it.domain.id,
            name: it.domain.name,
            currentDate: new Date(it.domain.expiryDate).toISOString(),
            nextDate: next.toISOString(),
          });
        }
        if (it.serviceId && it.service && !seen.has(`S:${it.serviceId}`)) {
          seen.add(`S:${it.serviceId}`);
          const base =
            new Date(it.service.renewalDate).getTime() < Date.now()
              ? new Date()
              : new Date(it.service.renewalDate);
          const next = addBillingCycleDate(base, it.service.billingCycle || 'YEARLY');
          linkedRenewals.push({
            kind: 'SERVICE',
            id: it.service.id,
            name: it.service.planName,
            currentDate: new Date(it.service.renewalDate).toISOString(),
            nextDate: next.toISOString(),
          });
        }
      }
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'PAYMENT_RECORDED',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Recorded ${d.method} payment ${created.receiptNumber} (${d.amount}) on ${invoice.invoiceNumber}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      payment: serializePayment(created),
      invoiceStatus: nextStatus,
      amountPaid: nextAmountPaid,
      linkedRenewals,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/extend-linked', async (req, res, next) => {
  try {
    const schema = z.object({
      items: z
        .array(
          z.object({
            kind: z.enum(['DOMAIN', 'SERVICE']),
            id: z.string().min(1),
            nextDate: z.string().min(1),
          })
        )
        .min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid renewal extension payload' });
      return;
    }

    let updatedCount = 0;
    for (const item of parsed.data.items) {
      const nextDate = new Date(item.nextDate);
      if (item.kind === 'DOMAIN') {
        await db.domain.update({
          where: { id: item.id },
          data: { expiryDate: nextDate, status: 'ACTIVE' },
        });
        updatedCount += 1;
      } else {
        await db.service.update({
          where: { id: item.id },
          data: { renewalDate: nextDate, status: 'ACTIVE' },
        });
        updatedCount += 1;
      }
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'RENEWAL_DATES_EXTENDED',
      summary: `Extended expiry/renewal date for ${updatedCount} item(s) after payment`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, updatedCount });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const payment = await db.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    await db.payment.delete({ where: { id: payment.id } });

    const invoice = await db.invoice.findUnique({
      where: { id: payment.invoiceId },
      include: { payments: true, creditNotes: true },
    });
    if (invoice) {
      const sumPaid = (invoice.payments || []).reduce((acc: number, p: any) => acc + Number(p.amount ?? 0), 0);
      const sumCredit = (invoice.creditNotes || []).reduce((acc: number, c: any) => acc + Number(c.amount ?? 0), 0);
      const nextStatus = deriveInvoiceStatus({
        currentStatus: invoice.status === 'PAID' ? 'SENT' : invoice.status,
        total: Number(invoice.total),
        amountPaid: round2(sumPaid),
        creditTotal: round2(sumCredit),
        dueDate: invoice.dueDate,
      });
      await db.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: round2(sumPaid), status: nextStatus },
      });
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'PAYMENT_DELETED',
      entityType: 'Invoice',
      entityId: payment.invoiceId,
      summary: `Deleted payment ${payment.receiptNumber}`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
