import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { computeAutoExpiryStatus, getDaysLeftIST } from '../../shared/dates';
import { runRdapVerificationJob, verifySingleDomainRdap } from '../jobs/phase6Jobs';

const router = Router();
router.use(requireAuth);

const domainSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a valid domain name like example.in'),
  clientId: z.string().min(1, 'Client is required'),
  providerAccountId: z.string().optional().nullable(),
  registeredOn: z.string().optional().nullable(),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  autoRenew: z.boolean().default(false),
  nameservers: z.array(z.string().trim()).optional().default([]),
  dnsProvider: z.string().trim().max(191).optional().nullable(),
  whoisPrivacy: z.boolean().default(true),
  costPrice: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().min(0).default(0),
  renewalYears: z.coerce.number().int().min(1).max(10).default(1),
  status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'REDEMPTION', 'TRANSFERRED']).optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
  whoPays: z.enum(['CLIENT', 'ME']).default('CLIENT'),
  sslExpiryDate: z.string().optional().nullable(),
});

function serializeDomain(d: any) {
  return {
    ...d,
    costPrice: Number(d.costPrice ?? 0),
    sellingPrice: Number(d.sellingPrice ?? 0),
    nameservers: Array.isArray(d.nameservers) ? d.nameservers : [],
    expiryDate: d.expiryDate instanceof Date ? d.expiryDate.toISOString() : d.expiryDate,
    registeredOn: d.registeredOn instanceof Date ? d.registeredOn.toISOString() : d.registeredOn,
    lastRdapVerifiedAt:
      d.lastRdapVerifiedAt instanceof Date ? d.lastRdapVerifiedAt.toISOString() : d.lastRdapVerifiedAt,
    rdapExpiryDate: d.rdapExpiryDate instanceof Date ? d.rdapExpiryDate.toISOString() : d.rdapExpiryDate,
    sslExpiryDate: d.sslExpiryDate instanceof Date ? d.sslExpiryDate.toISOString() : d.sslExpiryDate,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : d.updatedAt,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const clientId = String(req.query.clientId || '').trim();
    const providerAccountId = String(req.query.providerAccountId || '').trim();
    const expiryWindow = String(req.query.expiryWindow || '').trim();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));

    const all = await db.domain.findMany({
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    const now = new Date();
    const filtered = all.filter((d: any) => {
      if (clientId && d.clientId !== clientId) return false;
      if (providerAccountId && d.providerAccountId !== providerAccountId) return false;
      if (status && status !== 'ALL' && d.status !== status) return false;

      if (expiryWindow && expiryWindow !== 'ALL') {
        const days = getDaysLeftIST(d.expiryDate, now);
        if (expiryWindow === 'expired' && days >= 0) return false;
        if (expiryWindow === '7' && (days < 0 || days > 7)) return false;
        if (expiryWindow === '30' && (days < 0 || days > 30)) return false;
        if (expiryWindow === '60' && (days < 0 || days > 60)) return false;
        if (expiryWindow === 'healthy' && days <= 60) return false;
      }

      if (q) {
        const hay = `${d.name} ${d.client?.name || ''} ${d.client?.company || ''} ${d.providerAccount?.name || ''} ${d.dnsProvider || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      items: paged.map(serializeDomain),
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
    const domains = await db.domain.findMany({
      include: { client: true, providerAccount: true },
      orderBy: { expiryDate: 'asc' },
    });

    const rows = domains.map((d: any) => ({
      domain: d.name,
      client: d.client?.name || '',
      provider: d.providerAccount?.name || '',
      expiryDate: d.expiryDate instanceof Date ? d.expiryDate.toISOString().slice(0, 10) : String(d.expiryDate).slice(0, 10),
      registeredOn: d.registeredOn ? new Date(d.registeredOn).toISOString().slice(0, 10) : '',
      autoRenew: d.autoRenew ? 'true' : 'false',
      whoPays: d.whoPays,
      costPrice: Number(d.costPrice),
      sellingPrice: Number(d.sellingPrice),
      renewalYears: d.renewalYears,
      dnsProvider: d.dnsProvider || '',
      whoisPrivacy: d.whoisPrivacy ? 'true' : 'false',
      status: d.status,
      notes: d.notes || '',
    }));

    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="domains-export.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = domainSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid domain data', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const expiry = new Date(d.expiryDate);
    if (Number.isNaN(expiry.getTime())) {
      res.status(400).json({ error: 'Invalid expiry date' });
      return;
    }

    const existing = await db.domain.findUnique({ where: { name: d.name } });
    if (existing) {
      res.status(409).json({ error: `Domain ${d.name} is already tracked` });
      return;
    }

    const autoStatus = computeAutoExpiryStatus(expiry, d.status || 'ACTIVE') as any;

    const created = await db.domain.create({
      data: {
        name: d.name,
        clientId: d.clientId,
        providerAccountId: d.providerAccountId || null,
        registeredOn: d.registeredOn ? new Date(d.registeredOn) : null,
        expiryDate: expiry,
        autoRenew: d.autoRenew,
        nameservers: d.nameservers,
        dnsProvider: d.dnsProvider || null,
        whoisPrivacy: d.whoisPrivacy,
        costPrice: d.costPrice,
        sellingPrice: d.sellingPrice,
        renewalYears: d.renewalYears,
        status: autoStatus,
        notes: d.notes || null,
        whoPays: d.whoPays,
        sslExpiryDate: d.sslExpiryDate ? new Date(d.sslExpiryDate) : null,
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAIN_CREATED',
      entityType: 'Domain',
      entityId: created.id,
      summary: `Added domain ${created.name}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ domain: serializeDomain(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/bulk', async (req, res, next) => {
  try {
    const bulkSchema = z.object({
      ids: z.array(z.string().min(1)).min(1),
      providerAccountId: z.string().optional().nullable(),
      autoRenew: z.boolean().optional(),
      whoPays: z.enum(['CLIENT', 'ME']).optional(),
      status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'REDEMPTION', 'TRANSFERRED']).optional(),
    });
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bulk update payload' });
      return;
    }

    const { ids, ...fields } = parsed.data;
    const data: Record<string, any> = {};
    if (fields.providerAccountId !== undefined) data.providerAccountId = fields.providerAccountId;
    if (fields.autoRenew !== undefined) data.autoRenew = fields.autoRenew;
    if (fields.whoPays !== undefined) data.whoPays = fields.whoPays;
    if (fields.status !== undefined) data.status = fields.status;

    const result = await db.domain.updateMany({
      where: { id: { in: ids } },
      data,
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAINS_BULK_UPDATED',
      entityType: 'Domain',
      summary: `Bulk updated ${result.count} domains`,
      ipAddress: getClientIp(req),
    });

    res.json({ updatedCount: result.count });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-rdap-all', async (req, res, next) => {
  try {
    const summary = await runRdapVerificationJob(db, new Date(), { forceAll: true, batchLimit: 50 });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAINS_RDAP_VERIFIED_ALL',
      entityType: 'Domain',
      summary,
      ipAddress: getClientIp(req),
    });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/verify-rdap', async (req, res, next) => {
  try {
    const existing = await db.domain.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }

    const result = await verifySingleDomainRdap(db, existing, new Date());
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAIN_RDAP_VERIFIED',
      entityType: 'Domain',
      entityId: existing.id,
      summary: `RDAP check for ${existing.name}: ${
        !result.rdap.supported
          ? 'unsupported TLD'
          : result.mismatchDetected
            ? 'expiry mismatch detected'
            : 'verified'
      }`,
      ipAddress: getClientIp(req),
    });

    res.json({
      domain: serializeDomain(result.domain),
      rdap: result.rdap,
      mismatchDetected: result.mismatchDetected,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.domain.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }

    const parsed = domainSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid domain update', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const nextExpiry = d.expiryDate ? new Date(d.expiryDate) : existing.expiryDate;
    const nextStatus =
      d.status !== undefined
        ? d.status
        : computeAutoExpiryStatus(nextExpiry, existing.status);

    const updated = await db.domain.update({
      where: { id: req.params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
        ...(d.providerAccountId !== undefined ? { providerAccountId: d.providerAccountId || null } : {}),
        ...(d.registeredOn !== undefined ? { registeredOn: d.registeredOn ? new Date(d.registeredOn) : null } : {}),
        ...(d.expiryDate !== undefined ? { expiryDate: nextExpiry } : {}),
        ...(d.autoRenew !== undefined ? { autoRenew: d.autoRenew } : {}),
        ...(d.nameservers !== undefined ? { nameservers: d.nameservers } : {}),
        ...(d.dnsProvider !== undefined ? { dnsProvider: d.dnsProvider || null } : {}),
        ...(d.whoisPrivacy !== undefined ? { whoisPrivacy: d.whoisPrivacy } : {}),
        ...(d.costPrice !== undefined ? { costPrice: d.costPrice } : {}),
        ...(d.sellingPrice !== undefined ? { sellingPrice: d.sellingPrice } : {}),
        ...(d.renewalYears !== undefined ? { renewalYears: d.renewalYears } : {}),
        status: nextStatus as any,
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
        ...(d.whoPays !== undefined ? { whoPays: d.whoPays } : {}),
        ...(d.sslExpiryDate !== undefined ? { sslExpiryDate: d.sslExpiryDate ? new Date(d.sslExpiryDate) : null } : {}),
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAIN_UPDATED',
      entityType: 'Domain',
      entityId: updated.id,
      summary: `Updated domain ${updated.name}`,
      ipAddress: getClientIp(req),
    });

    res.json({ domain: serializeDomain(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.domain.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }
    await db.domain.delete({ where: { id: req.params.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAIN_DELETED',
      entityType: 'Domain',
      entityId: existing.id,
      summary: `Deleted domain ${existing.name}`,
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
    const existingDomains = await db.domain.findMany();
    const existingSet = new Set(existingDomains.map((d: any) => d.name.toLowerCase()));

    const parsedCsv = Papa.parse<Record<string, string>>(parsedBody.data.csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    const previewRows: Array<{
      rowNumber: number;
      valid: boolean;
      error?: string;
      domainName: string;
      clientName: string;
      expiryDate: string;
      payload?: any;
    }> = [];

    for (let i = 0; i < parsedCsv.data.length; i++) {
      const r = parsedCsv.data[i];
      const domainName = (r.domain || r.name || '').trim().toLowerCase();
      const clientHint = (r.client || r.client_name || '').trim().toLowerCase();
      const providerHint = (r.provider || r.registrar || '').trim().toLowerCase();
      const expiryRaw = (r.expiry_date || r.expirydate || r.expiry || '').trim();

      const matchedClient = clients.find(
        (c: any) =>
          c.name.toLowerCase() === clientHint ||
          (c.company && c.company.toLowerCase() === clientHint)
      );
      const matchedProvider = providers.find((p: any) => p.name.toLowerCase().includes(providerHint));

      let error: string | undefined;
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domainName)) {
        error = 'Invalid domain name';
      } else if (existingSet.has(domainName)) {
        error = 'Domain already exists';
      } else if (!matchedClient) {
        error = `Client "${r.client || r.client_name || ''}" not found`;
      } else if (!expiryRaw || Number.isNaN(new Date(expiryRaw).getTime())) {
        error = 'Invalid expiry_date (use YYYY-MM-DD)';
      }

      if (error) {
        previewRows.push({
          rowNumber: i + 2,
          valid: false,
          error,
          domainName,
          clientName: r.client || r.client_name || '',
          expiryDate: expiryRaw,
        });
      } else {
        previewRows.push({
          rowNumber: i + 2,
          valid: true,
          domainName,
          clientName: matchedClient!.name,
          expiryDate: expiryRaw,
          payload: {
            name: domainName,
            clientId: matchedClient!.id,
            providerAccountId: matchedProvider?.id || null,
            expiryDate: new Date(expiryRaw),
            registeredOn: r.registered_on ? new Date(r.registered_on) : null,
            autoRenew: (r.auto_renew || r.autorenew || 'false').toLowerCase() === 'true',
            costPrice: Number(r.cost_price || r.costprice || 0) || 0,
            sellingPrice: Number(r.selling_price || r.sellingprice || 0) || 0,
            renewalYears: Math.max(1, Number(r.renewal_years || 1) || 1),
            dnsProvider: r.dns_provider || null,
            whoPays: (r.who_pays || 'CLIENT').toUpperCase() === 'ME' ? 'ME' : 'CLIENT',
            status: computeAutoExpiryStatus(new Date(expiryRaw), 'ACTIVE'),
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
      await db.domain.create({ data: row.payload });
      createdCount += 1;
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DOMAINS_CSV_IMPORTED',
      entityType: 'Domain',
      summary: `Imported ${createdCount} domains from CSV`,
      ipAddress: getClientIp(req),
    });

    res.json({ dryRun: false, createdCount, totalRows: previewRows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
