import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { computeAutoExpiryStatus, getDaysLeftIST } from '../../shared/dates';

const router = Router();
router.use(requireAuth);

const serviceSchema = z.object({
  type: z.enum(['HOSTING', 'EMAIL_HOSTING', 'SSL', 'MAINTENANCE_AMC', 'CDN', 'OTHER']).default('HOSTING'),
  providerAccountId: z.string().optional().nullable(),
  planName: z.string().trim().min(1, 'Plan name is required').max(191),
  clientId: z.string().min(1, 'Client is required'),
  startDate: z.string().optional().nullable(),
  renewalDate: z.string().min(1, 'Renewal date is required'),
  billingCycle: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'MULTI_YEAR']).default('YEARLY'),
  costPrice: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().min(0).default(0),
  autoRenew: z.boolean().default(false),
  status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'CANCELLED']).optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
  domainIds: z.array(z.string()).optional().default([]),
});

function serializeService(s: any) {
  return {
    ...s,
    costPrice: Number(s.costPrice ?? 0),
    sellingPrice: Number(s.sellingPrice ?? 0),
    startDate: s.startDate instanceof Date ? s.startDate.toISOString() : s.startDate,
    renewalDate: s.renewalDate instanceof Date ? s.renewalDate.toISOString() : s.renewalDate,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
    linkedDomains: Array.isArray(s.domainLinks)
      ? s.domainLinks.map((l: any) => l.domain).filter(Boolean).map((d: any) => ({ id: d.id, name: d.name }))
      : [],
  };
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const clientId = String(req.query.clientId || '').trim();
    const providerAccountId = String(req.query.providerAccountId || '').trim();
    const type = String(req.query.type || '').trim();
    const expiryWindow = String(req.query.expiryWindow || '').trim();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));

    const all = await db.service.findMany({
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
        domainLinks: { include: { domain: true } },
      },
      orderBy: { renewalDate: 'asc' },
    });

    const now = new Date();
    const filtered = all.filter((s: any) => {
      if (clientId && s.clientId !== clientId) return false;
      if (providerAccountId && s.providerAccountId !== providerAccountId) return false;
      if (type && type !== 'ALL' && s.type !== type) return false;
      if (status && status !== 'ALL' && s.status !== status) return false;

      if (expiryWindow && expiryWindow !== 'ALL') {
        const days = getDaysLeftIST(s.renewalDate, now);
        if (expiryWindow === 'expired' && days >= 0) return false;
        if (expiryWindow === '7' && (days < 0 || days > 7)) return false;
        if (expiryWindow === '30' && (days < 0 || days > 30)) return false;
        if (expiryWindow === '60' && (days < 0 || days > 60)) return false;
        if (expiryWindow === 'healthy' && days <= 60) return false;
      }

      if (q) {
        const domainNames = (s.domainLinks || []).map((l: any) => l.domain?.name || '').join(' ');
        const hay = `${s.planName} ${s.type} ${s.client?.name || ''} ${s.providerAccount?.name || ''} ${domainNames}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      items: paged.map(serializeService),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/export', async (_req, res, next) => {
  try {
    const services = await db.service.findMany({
      include: { client: true, providerAccount: true, domainLinks: { include: { domain: true } } },
      orderBy: { renewalDate: 'asc' },
    });

    const rows = services.map((s: any) => ({
      planName: s.planName,
      type: s.type,
      client: s.client?.name || '',
      provider: s.providerAccount?.name || '',
      linkedDomains: (s.domainLinks || []).map((l: any) => l.domain?.name).filter(Boolean).join('; '),
      renewalDate: s.renewalDate instanceof Date ? s.renewalDate.toISOString().slice(0, 10) : String(s.renewalDate).slice(0, 10),
      billingCycle: s.billingCycle,
      costPrice: Number(s.costPrice),
      sellingPrice: Number(s.sellingPrice),
      autoRenew: s.autoRenew ? 'true' : 'false',
      status: s.status,
      notes: s.notes || '',
    }));

    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="services-export.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid service data', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const renewal = new Date(d.renewalDate);
    if (Number.isNaN(renewal.getTime())) {
      res.status(400).json({ error: 'Invalid renewal date' });
      return;
    }

    const autoStatus = computeAutoExpiryStatus(renewal, d.status || 'ACTIVE') as any;

    const created = await db.service.create({
      data: {
        type: d.type,
        providerAccountId: d.providerAccountId || null,
        planName: d.planName,
        clientId: d.clientId,
        startDate: d.startDate ? new Date(d.startDate) : null,
        renewalDate: renewal,
        billingCycle: d.billingCycle,
        costPrice: d.costPrice,
        sellingPrice: d.sellingPrice,
        autoRenew: d.autoRenew,
        status: autoStatus,
        notes: d.notes || null,
        ...(d.domainIds.length > 0
          ? {
              domainLinks: {
                create: d.domainIds.map((domainId) => ({ domainId })),
              },
            }
          : {}),
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
        domainLinks: { include: { domain: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'SERVICE_CREATED',
      entityType: 'Service',
      entityId: created.id,
      summary: `Added service ${created.planName}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ service: serializeService(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/bulk', async (req, res, next) => {
  try {
    const bulkSchema = z.object({
      ids: z.array(z.string().min(1)).min(1),
      autoRenew: z.boolean().optional(),
      status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'CANCELLED']).optional(),
    });
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bulk update payload' });
      return;
    }

    const { ids, ...fields } = parsed.data;
    const data: Record<string, any> = {};
    if (fields.autoRenew !== undefined) data.autoRenew = fields.autoRenew;
    if (fields.status !== undefined) data.status = fields.status;

    const result = await db.service.updateMany({
      where: { id: { in: ids } },
      data,
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'SERVICES_BULK_UPDATED',
      entityType: 'Service',
      summary: `Bulk updated ${result.count} services`,
      ipAddress: getClientIp(req),
    });

    res.json({ updatedCount: result.count });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.service.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid service update', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const nextRenewal = d.renewalDate ? new Date(d.renewalDate) : existing.renewalDate;
    const nextStatus =
      d.status !== undefined
        ? d.status
        : computeAutoExpiryStatus(nextRenewal, existing.status);

    const updated = await db.service.update({
      where: { id: req.params.id },
      data: {
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...(d.providerAccountId !== undefined ? { providerAccountId: d.providerAccountId || null } : {}),
        ...(d.planName !== undefined ? { planName: d.planName } : {}),
        ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
        ...(d.startDate !== undefined ? { startDate: d.startDate ? new Date(d.startDate) : null } : {}),
        ...(d.renewalDate !== undefined ? { renewalDate: nextRenewal } : {}),
        ...(d.billingCycle !== undefined ? { billingCycle: d.billingCycle } : {}),
        ...(d.costPrice !== undefined ? { costPrice: d.costPrice } : {}),
        ...(d.sellingPrice !== undefined ? { sellingPrice: d.sellingPrice } : {}),
        ...(d.autoRenew !== undefined ? { autoRenew: d.autoRenew } : {}),
        status: nextStatus as any,
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
        ...(d.domainIds !== undefined
          ? {
              domainLinks: {
                deleteMany: {},
                create: d.domainIds.map((domainId) => ({ domainId })),
              },
            }
          : {}),
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
        domainLinks: { include: { domain: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'SERVICE_UPDATED',
      entityType: 'Service',
      entityId: updated.id,
      summary: `Updated service ${updated.planName}`,
      ipAddress: getClientIp(req),
    });

    res.json({ service: serializeService(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.service.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    await db.service.delete({ where: { id: req.params.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'SERVICE_DELETED',
      entityType: 'Service',
      entityId: existing.id,
      summary: `Deleted service ${existing.planName}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/import', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      csvText: z.string().min(1).max(2_000_000),
      dryRun: z.boolean().default(true),
    });
    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'CSV content is required' });
      return;
    }

    const clients = await db.client.findMany();
    const providers = await db.providerAccount.findMany();

    const parsedCsv = Papa.parse<Record<string, string>>(parsedBody.data.csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    const validTypes = new Set(['HOSTING', 'EMAIL_HOSTING', 'SSL', 'MAINTENANCE_AMC', 'CDN', 'OTHER']);
    const validCycles = new Set(['MONTHLY', 'QUARTERLY', 'YEARLY', 'MULTI_YEAR']);

    const previewRows: Array<{
      rowNumber: number;
      valid: boolean;
      error?: string;
      planName: string;
      clientName: string;
      renewalDate: string;
      payload?: any;
    }> = [];

    for (let i = 0; i < parsedCsv.data.length; i++) {
      const r = parsedCsv.data[i];
      const planName = (r.plan_name || r.planname || r.plan || '').trim();
      const clientHint = (r.client || r.client_name || '').trim().toLowerCase();
      const providerHint = (r.provider || '').trim().toLowerCase();
      const renewalRaw = (r.renewal_date || r.renewaldate || '').trim();
      const rawType = (r.type || 'HOSTING').trim().toUpperCase();
      const rawCycle = (r.billing_cycle || r.billingcycle || 'YEARLY').trim().toUpperCase();

      const matchedClient = clients.find(
        (c: any) =>
          c.name.toLowerCase() === clientHint ||
          (c.company && c.company.toLowerCase() === clientHint)
      );
      const matchedProvider = providers.find((p: any) => p.name.toLowerCase().includes(providerHint));

      let error: string | undefined;
      if (!planName) {
        error = 'Missing plan_name';
      } else if (!matchedClient) {
        error = `Client "${r.client || r.client_name || ''}" not found`;
      } else if (!renewalRaw || Number.isNaN(new Date(renewalRaw).getTime())) {
        error = 'Invalid renewal_date (use YYYY-MM-DD)';
      }

      if (error) {
        previewRows.push({
          rowNumber: i + 2,
          valid: false,
          error,
          planName,
          clientName: r.client || r.client_name || '',
          renewalDate: renewalRaw,
        });
      } else {
        previewRows.push({
          rowNumber: i + 2,
          valid: true,
          planName,
          clientName: matchedClient!.name,
          renewalDate: renewalRaw,
          payload: {
            planName,
            type: validTypes.has(rawType) ? rawType : 'HOSTING',
            clientId: matchedClient!.id,
            providerAccountId: matchedProvider?.id || null,
            renewalDate: new Date(renewalRaw),
            billingCycle: validCycles.has(rawCycle) ? rawCycle : 'YEARLY',
            costPrice: Number(r.cost_price || r.costprice || 0) || 0,
            sellingPrice: Number(r.selling_price || r.sellingprice || 0) || 0,
            autoRenew: (r.auto_renew || r.autorenew || 'false').toLowerCase() === 'true',
            status: computeAutoExpiryStatus(new Date(renewalRaw), 'ACTIVE'),
            notes: r.notes || null,
          },
        });
      }
    }

    if (parsedBody.data.dryRun) {
      res.json({
        dryRun: true,
        totalRows: previewRows.length,
        validCount: previewRows.filter((r) => r.valid).length,
        invalidCount: previewRows.filter((r) => !r.valid).length,
        rows: previewRows,
      });
      return;
    }

    let createdCount = 0;
    for (const row of previewRows) {
      if (!row.valid || !row.payload) continue;
      await db.service.create({ data: row.payload });
      createdCount += 1;
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'SERVICES_CSV_IMPORTED',
      entityType: 'Service',
      summary: `Imported ${createdCount} services from CSV`,
      ipAddress: getClientIp(req),
    });

    res.json({ dryRun: false, createdCount, totalRows: previewRows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
