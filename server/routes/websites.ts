import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { generateRandomToken } from '../lib/crypto';
import { computeUptimePercent, validatePublicMonitorUrl } from '../lib/uptimeMonitor';
import { checkSingleWebsite, runUptimeChecksJob } from '../jobs/uptimeJob';
import { getDaysLeftIST } from '../../shared/dates';

const router = Router();
router.use(requireAuth);

const websiteCreateSchema = z.object({
  url: z.string().trim().min(4).max(512),
  label: z.string().trim().max(191).optional().nullable(),
  clientId: z.string().trim().min(1),
  domainId: z.string().trim().optional().nullable(),
  intervalMinutes: z.coerce.number().int().min(1).max(1440).default(5),
  expectedStatusCode: z.coerce.number().int().min(100).max(599).default(200),
  requiredKeyword: z.string().trim().max(255).optional().nullable(),
  timeoutMs: z.coerce.number().int().min(1000).max(30000).default(10000),
  failureThreshold: z.coerce.number().int().min(1).max(10).default(2),
  alertContacts: z.array(z.string().trim().max(191)).optional().default([]),
  notifyClient: z.boolean().optional().default(false),
  paused: z.boolean().optional().default(false),
});

const websiteUpdateSchema = websiteCreateSchema.partial();

function toIso(d: any): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeCheck(c: any) {
  return {
    id: c.id,
    websiteId: c.websiteId,
    checkedAt: toIso(c.checkedAt) || new Date().toISOString(),
    up: Boolean(c.up),
    httpCode: c.httpCode ?? null,
    responseMs: c.responseMs ?? null,
    error: c.error ?? null,
  };
}

function serializeIncident(inc: any) {
  return {
    id: inc.id,
    websiteId: inc.websiteId,
    startedAt: toIso(inc.startedAt) || new Date().toISOString(),
    endedAt: toIso(inc.endedAt),
    durationSeconds: inc.durationSeconds ?? null,
    notifiedOwner: Boolean(inc.notifiedOwner),
    notifiedClient: Boolean(inc.notifiedClient),
    errorSummary: inc.errorSummary ?? null,
  };
}

function serializeWebsite(
  w: any,
  checks30d: any[],
  incidents: any[],
  now: Date
) {
  const cutoff24h = now.getTime() - 86_400_000;
  const siteChecks = checks30d.filter((c) => c.websiteId === w.id);
  const checks24h = siteChecks.filter((c) => new Date(c.checkedAt).getTime() >= cutoff24h);
  const siteIncidents = incidents
    .filter((i) => i.websiteId === w.id)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const openIncident = siteIncidents.find((i) => !i.endedAt) || null;

  const sortedChecks = [...siteChecks].sort(
    (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
  );

  return {
    id: w.id,
    url: w.url,
    label: w.label ?? null,
    clientId: w.clientId,
    domainId: w.domainId ?? null,
    intervalMinutes: Number(w.intervalMinutes ?? 5),
    expectedStatusCode: Number(w.expectedStatusCode ?? 200),
    requiredKeyword: w.requiredKeyword ?? null,
    timeoutMs: Number(w.timeoutMs ?? 10000),
    failureThreshold: Number(w.failureThreshold ?? 2),
    consecutiveFailures: Number(w.consecutiveFailures ?? 0),
    isDown: Boolean(w.isDown),
    alertContacts: Array.isArray(w.alertContacts) ? w.alertContacts : [],
    notifyClient: Boolean(w.notifyClient),
    paused: Boolean(w.paused),
    sslExpiry: toIso(w.sslExpiry),
    lastCheckedAt: toIso(w.lastCheckedAt),
    lastResponseMs: w.lastResponseMs ?? null,
    publicStatusToken: w.publicStatusToken ?? null,
    createdAt: toIso(w.createdAt) || new Date().toISOString(),
    updatedAt: toIso(w.updatedAt) || new Date().toISOString(),
    client: w.client
      ? { id: w.client.id, name: w.client.name, company: w.client.company ?? null }
      : undefined,
    domain: w.domain ? { id: w.domain.id, name: w.domain.name } : null,
    uptime24h: computeUptimePercent(checks24h),
    uptime30d: computeUptimePercent(siteChecks),
    recentChecks: sortedChecks.slice(0, 30).map(serializeCheck),
    incidents: siteIncidents.slice(0, 20).map(serializeIncident),
    openIncident: openIncident ? serializeIncident(openIncident) : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const [websites, checks30d, incidents] = await Promise.all([
      db.website.findMany({
        ...(clientId ? { where: { clientId } } : {}),
        include: {
          client: { select: { id: true, name: true, company: true } },
          domain: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.uptimeCheck.findMany({
        where: { checkedAt: { gte: thirtyDaysAgo } },
        orderBy: { checkedAt: 'desc' },
      }),
      db.incident.findMany({
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    const serializedAll = (websites as any[]).map((w) =>
      serializeWebsite(w, checks30d as any[], incidents as any[], now)
    );

    const summary = {
      total: serializedAll.length,
      up: serializedAll.filter((w) => !w.paused && !w.isDown && w.lastCheckedAt !== null).length,
      down: serializedAll.filter((w) => !w.paused && w.isDown).length,
      paused: serializedAll.filter((w) => w.paused).length,
      sslExpiring14: serializedAll.filter((w) => {
        if (!w.sslExpiry) return false;
        return getDaysLeftIST(w.sslExpiry, now) <= 14;
      }).length,
      avgUptime30d: computeUptimePercent(checks30d as any[]),
    };

    const filtered = serializedAll.filter((w) => {
      if (statusFilter === 'UP' && (w.paused || w.isDown)) return false;
      if (statusFilter === 'DOWN' && (w.paused || !w.isDown)) return false;
      if (statusFilter === 'PAUSED' && !w.paused) return false;
      if (q) {
        const hay = `${w.label || ''} ${w.url} ${w.client?.name || ''} ${w.domain?.name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    res.json({ items: filtered, summary });
  } catch (err) {
    next(err);
  }
});

router.post('/check-all', async (req, res, next) => {
  try {
    const summary = await runUptimeChecksJob(db, new Date(), { forceAll: true });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'WEBSITE_CHECK_ALL',
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
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const website = await db.website.findUnique({
      where: { id: req.params.id },
      include: {
        client: { select: { id: true, name: true, company: true } },
        domain: { select: { id: true, name: true } },
      },
    });
    if (!website) {
      res.status(404).json({ error: 'Website not found' });
      return;
    }

    const [checks30d, incidents] = await Promise.all([
      db.uptimeCheck.findMany({
        where: { websiteId: website.id, checkedAt: { gte: thirtyDaysAgo } },
        orderBy: { checkedAt: 'desc' },
      }),
      db.incident.findMany({
        where: { websiteId: website.id },
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
    ]);

    const serialized = serializeWebsite(website, checks30d as any[], incidents as any[], now);
    serialized.recentChecks = (checks30d as any[]).slice(0, 60).map(serializeCheck);

    res.json({ website: serialized });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = websiteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid website fields' });
      return;
    }

    let validated;
    try {
      validated = await validatePublicMonitorUrl(parsed.data.url);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'URL failed security validation' });
      return;
    }

    const client = await db.client.findUnique({ where: { id: parsed.data.clientId } });
    if (!client) {
      res.status(404).json({ error: 'Selected client not found' });
      return;
    }

    if (parsed.data.domainId) {
      const domain = await db.domain.findUnique({ where: { id: parsed.data.domainId } });
      if (!domain) {
        res.status(404).json({ error: 'Selected domain not found' });
        return;
      }
    }

    const created = await db.website.create({
      data: {
        url: validated.normalizedUrl,
        label: parsed.data.label || validated.hostname,
        clientId: parsed.data.clientId,
        domainId: parsed.data.domainId || null,
        intervalMinutes: parsed.data.intervalMinutes,
        expectedStatusCode: parsed.data.expectedStatusCode,
        requiredKeyword: parsed.data.requiredKeyword || null,
        timeoutMs: parsed.data.timeoutMs,
        failureThreshold: parsed.data.failureThreshold,
        alertContacts: parsed.data.alertContacts || [],
        notifyClient: parsed.data.notifyClient ?? false,
        paused: parsed.data.paused ?? false,
        publicStatusToken: generateRandomToken(16),
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        domain: { select: { id: true, name: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'WEBSITE_CREATED',
      entityType: 'Website',
      entityId: created.id,
      summary: `Added monitor for ${created.url} (${client.name})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ website: serializeWebsite(created, [], [], new Date()) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.website.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Website not found' });
      return;
    }

    const parsed = websiteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update fields' });
      return;
    }

    let normalizedUrl: string | undefined;
    if (parsed.data.url !== undefined) {
      try {
        const validated = await validatePublicMonitorUrl(parsed.data.url);
        normalizedUrl = validated.normalizedUrl;
      } catch (err: any) {
        res.status(400).json({ error: err?.message || 'URL failed security validation' });
        return;
      }
    }

    const updated = await db.website.update({
      where: { id: existing.id },
      data: {
        ...(normalizedUrl !== undefined ? { url: normalizedUrl } : {}),
        ...(parsed.data.label !== undefined ? { label: parsed.data.label || null } : {}),
        ...(parsed.data.clientId !== undefined ? { clientId: parsed.data.clientId } : {}),
        ...(parsed.data.domainId !== undefined ? { domainId: parsed.data.domainId || null } : {}),
        ...(parsed.data.intervalMinutes !== undefined ? { intervalMinutes: parsed.data.intervalMinutes } : {}),
        ...(parsed.data.expectedStatusCode !== undefined
          ? { expectedStatusCode: parsed.data.expectedStatusCode }
          : {}),
        ...(parsed.data.requiredKeyword !== undefined
          ? { requiredKeyword: parsed.data.requiredKeyword || null }
          : {}),
        ...(parsed.data.timeoutMs !== undefined ? { timeoutMs: parsed.data.timeoutMs } : {}),
        ...(parsed.data.failureThreshold !== undefined
          ? { failureThreshold: parsed.data.failureThreshold }
          : {}),
        ...(parsed.data.alertContacts !== undefined ? { alertContacts: parsed.data.alertContacts } : {}),
        ...(parsed.data.notifyClient !== undefined ? { notifyClient: parsed.data.notifyClient } : {}),
        ...(parsed.data.paused !== undefined ? { paused: parsed.data.paused } : {}),
        ...(!existing.publicStatusToken ? { publicStatusToken: generateRandomToken(16) } : {}),
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        domain: { select: { id: true, name: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'WEBSITE_UPDATED',
      entityType: 'Website',
      entityId: updated.id,
      summary: `Updated monitor ${updated.label || updated.url}`,
      ipAddress: getClientIp(req),
    });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [checks30d, incidents] = await Promise.all([
      db.uptimeCheck.findMany({
        where: { websiteId: updated.id, checkedAt: { gte: thirtyDaysAgo } },
      }),
      db.incident.findMany({ where: { websiteId: updated.id } }),
    ]);

    res.json({ website: serializeWebsite(updated, checks30d as any[], incidents as any[], now) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.website.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Website not found' });
      return;
    }

    await db.website.delete({ where: { id: existing.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'WEBSITE_DELETED',
      entityType: 'Website',
      entityId: existing.id,
      summary: `Deleted monitor ${existing.label || existing.url}`,
      ipAddress: getClientIp(req),
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/check-now', async (req, res, next) => {
  try {
    const website = await db.website.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        domain: { select: { id: true, name: true } },
      },
    });
    if (!website) {
      res.status(404).json({ error: 'Website not found' });
      return;
    }

    const now = new Date();
    const checkResult = await checkSingleWebsite(db, website, now);

    const updated = await db.website.findUnique({
      where: { id: website.id },
      include: {
        client: { select: { id: true, name: true, company: true } },
        domain: { select: { id: true, name: true } },
      },
    });
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [checks30d, incidents] = await Promise.all([
      db.uptimeCheck.findMany({
        where: { websiteId: website.id, checkedAt: { gte: thirtyDaysAgo } },
        orderBy: { checkedAt: 'desc' },
      }),
      db.incident.findMany({
        where: { websiteId: website.id },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    res.json({
      result: checkResult,
      website: serializeWebsite(updated || website, checks30d as any[], incidents as any[], now),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
