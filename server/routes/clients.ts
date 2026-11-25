import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { generateRandomToken } from '../lib/crypto';
import { clientInputSchema, parseClientCsv } from '../lib/clientCsv';

const router = Router();
router.use(requireAuth);

const clientSchema = clientInputSchema;

function serializeClient(c: any) {
  return {
    ...c,
    emails: Array.isArray(c.emails) ? c.emails : [],
    secondaryPhones: Array.isArray(c.secondaryPhones) ? c.secondaryPhones : [],
    tags: Array.isArray(c.tags) ? c.tags : [],
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));

    const all = await db.client.findMany({
      where: status && status !== 'ALL' ? { status: status as any } : undefined,
      include: {
        _count: { select: { domains: true, services: true, invoices: true } },
      },
      orderBy: { name: 'asc' },
    });

    const filtered = all.filter((c: any) => {
      if (!q) return true;
      const emails = Array.isArray(c.emails) ? c.emails.join(' ') : '';
      const tags = Array.isArray(c.tags) ? c.tags.join(' ') : '';
      const hay = `${c.name} ${c.company || ''} ${c.contactPerson || ''} ${emails} ${c.whatsappPhone || ''} ${c.gstin || ''} ${tags}`.toLowerCase();
      return hay.includes(q);
    });

    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      items: paged.map(serializeClient),
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
    const clients = await db.client.findMany({ orderBy: { name: 'asc' } });
    const rows = clients.map((c: any) => ({
      name: c.name,
      company: c.company || '',
      contactPerson: c.contactPerson || '',
      emails: Array.isArray(c.emails) ? c.emails.join('; ') : '',
      whatsappPhone: c.whatsappPhone || '',
      state: c.state || '',
      gstin: c.gstin || '',
      preferredChannel: c.preferredChannel,
      remindersEnabled: c.remindersEnabled ? 'true' : 'false',
      status: c.status,
      tags: Array.isArray(c.tags) ? c.tags.join('; ') : '',
      address: c.address || '',
      notes: c.notes || '',
    }));

    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients-export.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const client = await db.client.findUnique({
      where: { id: req.params.id },
      include: {
        domains: {
          include: { providerAccount: true },
          orderBy: { expiryDate: 'asc' },
        },
        services: {
          include: { providerAccount: true, domainLinks: { include: { domain: true } } },
          orderBy: { renewalDate: 'asc' },
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const timeline = await db.auditLog.findMany({
      where: { entityId: client.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const clientMessages = await db.messageLog.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const messagesSent = (clientMessages as any[]).filter(
      (m) => m.direction !== 'INBOUND' && ['SENT', 'DELIVERED', 'READ'].includes(m.status)
    ).length;
    const inboundReplies = (clientMessages as any[]).filter((m) => m.direction === 'INBOUND').length;

    res.json({
      client: {
        ...serializeClient(client),
        messagesSent,
        inboundReplies,
        messageLogs: clientMessages.map((m: any) => ({
          id: m.id,
          channel: m.channel,
          direction: m.direction || 'OUTBOUND',
          renderedSubject: m.renderedSubject ?? null,
          renderedContent: m.renderedContent,
          status: m.status,
          sentAt: m.sentAt instanceof Date ? m.sentAt.toISOString() : m.sentAt ?? null,
          createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
        })),
        domains: client.domains.map((d: any) => ({
          ...d,
          costPrice: Number(d.costPrice),
          sellingPrice: Number(d.sellingPrice),
          expiryDate: d.expiryDate instanceof Date ? d.expiryDate.toISOString() : d.expiryDate,
          registeredOn: d.registeredOn instanceof Date ? d.registeredOn.toISOString() : d.registeredOn,
        })),
        services: client.services.map((s: any) => ({
          ...s,
          costPrice: Number(s.costPrice),
          sellingPrice: Number(s.sellingPrice),
          renewalDate: s.renewalDate instanceof Date ? s.renewalDate.toISOString() : s.renewalDate,
          startDate: s.startDate instanceof Date ? s.startDate.toISOString() : s.startDate,
          linkedDomains: (s.domainLinks || []).map((l: any) => l.domain).filter(Boolean),
        })),
      },
      timeline,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid client data', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const created = await db.client.create({
      data: {
        name: d.name,
        company: d.company || null,
        contactPerson: d.contactPerson || null,
        emails: d.emails,
        whatsappPhone: d.whatsappPhone || null,
        secondaryPhones: d.secondaryPhones,
        address: d.address || null,
        state: d.state || null,
        gstin: d.gstin || null,
        notes: d.notes || null,
        preferredChannel: d.preferredChannel,
        remindersEnabled: d.remindersEnabled,
        status: d.status,
        tags: d.tags,
        publicStatusToken: generateRandomToken(16),
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'CLIENT_CREATED',
      entityType: 'Client',
      entityId: created.id,
      summary: `Created client ${created.name}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ client: serializeClient(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.client.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const parsed = clientSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid client update', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const updated = await db.client.update({
      where: { id: req.params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.company !== undefined ? { company: d.company || null } : {}),
        ...(d.contactPerson !== undefined ? { contactPerson: d.contactPerson || null } : {}),
        ...(d.emails !== undefined ? { emails: d.emails } : {}),
        ...(d.whatsappPhone !== undefined ? { whatsappPhone: d.whatsappPhone || null } : {}),
        ...(d.secondaryPhones !== undefined ? { secondaryPhones: d.secondaryPhones } : {}),
        ...(d.address !== undefined ? { address: d.address || null } : {}),
        ...(d.state !== undefined ? { state: d.state || null } : {}),
        ...(d.gstin !== undefined ? { gstin: d.gstin || null } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
        ...(d.preferredChannel !== undefined ? { preferredChannel: d.preferredChannel } : {}),
        ...(d.remindersEnabled !== undefined ? { remindersEnabled: d.remindersEnabled } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.tags !== undefined ? { tags: d.tags } : {}),
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'CLIENT_UPDATED',
      entityType: 'Client',
      entityId: updated.id,
      summary: `Updated client ${updated.name}`,
      ipAddress: getClientIp(req),
    });

    res.json({ client: serializeClient(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.client.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    await db.client.delete({ where: { id: req.params.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'CLIENT_DELETED',
      entityType: 'Client',
      entityId: existing.id,
      summary: `Deleted client ${existing.name}`,
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

    const previewRows = parseClientCsv(parsedBody.data.csvText);

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

    const existingClients = await db.client.findMany({
      select: { id: true, name: true, notes: true },
    });
    const existingNames = new Set(existingClients.map((c: any) => String(c.name || '').trim().toLowerCase()));
    const existingZohoIds = new Set<string>();
    for (const c of existingClients as any[]) {
      const m = String(c.notes || '').match(/Zoho Contact ID:\s*(\S+)/);
      if (m?.[1]) existingZohoIds.add(m[1]);
    }

    let createdCount = 0;
    let skippedCount = 0;
    for (const row of previewRows) {
      if (!row.valid || !row.data) continue;
      const normName = row.data.name.trim().toLowerCase();
      if (
        (row.zohoContactId && existingZohoIds.has(row.zohoContactId)) ||
        existingNames.has(normName)
      ) {
        skippedCount += 1;
        continue;
      }

      await db.client.create({
        data: {
          ...row.data,
          whatsappPhone: row.data.whatsappPhone || null,
          gstin: row.data.gstin || null,
          secondaryPhones: row.data.secondaryPhones || [],
          isDemo: false,
          publicStatusToken: generateRandomToken(16),
        },
      });
      existingNames.add(normName);
      if (row.zohoContactId) existingZohoIds.add(row.zohoContactId);
      createdCount += 1;
    }

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'CLIENTS_CSV_IMPORTED',
      entityType: 'Client',
      summary: `Imported ${createdCount} clients from CSV (${skippedCount} skipped duplicates)`,
      ipAddress: getClientIp(req),
    });

    res.json({ dryRun: false, createdCount, skippedCount, totalRows: previewRows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
