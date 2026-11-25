import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';

const router = Router();
router.use(requireAuth);

const expenseSchema = z.object({
  date: z.string().min(1),
  category: z.string().trim().min(1).max(100),
  vendor: z.string().trim().min(1).max(191),
  amount: z.coerce.number().positive('Amount must be > 0'),
  notes: z.string().trim().max(2000).optional().nullable(),
  clientId: z.string().optional().nullable(),
  domainId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
});

function serializeExpense(ex: any) {
  return {
    id: ex.id,
    date: ex.date instanceof Date ? ex.date.toISOString() : ex.date,
    category: ex.category,
    vendor: ex.vendor,
    amount: Number(ex.amount ?? 0),
    notes: ex.notes ?? null,
    clientId: ex.clientId ?? null,
    domainId: ex.domainId ?? null,
    serviceId: ex.serviceId ?? null,
    createdAt: ex.createdAt instanceof Date ? ex.createdAt.toISOString() : ex.createdAt,
    updatedAt: ex.updatedAt instanceof Date ? ex.updatedAt.toISOString() : ex.updatedAt,
    ...(ex.client ? { client: { id: ex.client.id, name: ex.client.name } } : {}),
  };
}

router.get('/', async (_req, res, next) => {
  try {
    const rows = await db.expense.findMany({
      include: { client: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
    res.json({ items: rows.map(serializeExpense) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid expense data', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const created = await db.expense.create({
      data: {
        date: new Date(d.date),
        category: d.category,
        vendor: d.vendor,
        amount: d.amount,
        notes: d.notes || null,
        clientId: d.clientId || null,
        domainId: d.domainId || null,
        serviceId: d.serviceId || null,
      },
      include: { client: { select: { id: true, name: true } } },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'EXPENSE_LOGGED',
      entityType: 'Expense',
      entityId: created.id,
      summary: `Logged expense ${d.category} (${d.vendor} - ${d.amount})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ expense: serializeExpense(created) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.expense.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
