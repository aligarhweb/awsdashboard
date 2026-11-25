import { PrismaClient } from '@prisma/client';
import { formatDateDDMMMYYYY, getDaysLeftIST, getIstDateParts } from '../../shared/dates';
import { ensureDefaultSettings } from '../lib/demoSeed';
import {
  renderTemplateText,
  sendEmailMessage,
  whatsappProvider,
} from '../lib/messaging';
import {
  probeWebsite,
  WebsiteProbeResult,
  WebsiteProbeTarget,
} from '../lib/uptimeMonitor';

function getIstYmd(date: Date, tz = 'Asia/Kolkata'): string {
  const p = getIstDateParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function formatDurationCompact(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (mins < 60) return `${mins}m ${remSec}s`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${remMin}m`;
}

async function sendAlertEmailWithLog(params: {
  prisma: PrismaClient;
  settings: any;
  recipient: string;
  subject: string;
  body: string;
  clientId?: string | null;
  entityType: string;
  entityId: string;
  offsetDays?: number | null;
  idempotencyKey: string;
  now: Date;
}): Promise<boolean> {
  const {
    prisma,
    settings,
    recipient,
    subject,
    body,
    clientId,
    entityType,
    entityId,
    offsetDays,
    idempotencyKey,
    now,
  } = params;

  const existing = await prisma.messageLog.findUnique({ where: { idempotencyKey } });
  if (existing) return existing.status === 'SENT';

  const sendRes = await sendEmailMessage({
    to: recipient,
    subject,
    text: body,
    settings,
    // Uptime alerts are urgent operational alerts, not quiet-hours-held marketing
  });

  await prisma.messageLog.create({
    data: {
      clientId: clientId || null,
      channel: 'EMAIL',
      renderedSubject: subject,
      renderedContent: body,
      entityType,
      entityId,
      offsetDays: offsetDays ?? null,
      idempotencyKey,
      sentAt: sendRes.ok ? now : null,
      status: sendRes.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendRes.providerMessageId || null,
      error: sendRes.error || null,
      direction: 'OUTBOUND',
    },
  });

  return sendRes.ok;
}

async function sendAlertWhatsappWithLog(params: {
  prisma: PrismaClient;
  settings: any;
  phone: string;
  body: string;
  clientId?: string | null;
  entityType: string;
  entityId: string;
  offsetDays?: number | null;
  idempotencyKey: string;
  now: Date;
}): Promise<boolean> {
  const {
    prisma,
    settings,
    phone,
    body,
    clientId,
    entityType,
    entityId,
    offsetDays,
    idempotencyKey,
    now,
  } = params;

  const existing = await prisma.messageLog.findUnique({ where: { idempotencyKey } });
  if (existing) return existing.status === 'SENT';

  const sendRes = await whatsappProvider.sendMessage({
    to: phone,
    renderedText: body,
    settings,
  });

  await prisma.messageLog.create({
    data: {
      clientId: clientId || null,
      channel: 'WHATSAPP',
      renderedSubject: null,
      renderedContent: body,
      entityType,
      entityId,
      offsetDays: offsetDays ?? null,
      idempotencyKey,
      sentAt: sendRes.ok ? now : null,
      status: sendRes.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendRes.providerMessageId || null,
      error: sendRes.error || null,
      direction: 'OUTBOUND',
    },
  });

  return sendRes.ok;
}

async function dispatchIncidentAlerts(params: {
  prisma: PrismaClient;
  website: any;
  incident: any;
  kind: 'DOWN' | 'RECOVERY';
  now: Date;
  settings: any;
  errorSummary?: string | null;
  durationSeconds?: number | null;
}): Promise<{ notifiedOwner: boolean; notifiedClient: boolean }> {
  const { prisma, website, incident, kind, now, settings, errorSummary, durationSeconds } = params;
  const tz = settings?.timezone || 'Asia/Kolkata';
  const businessName = settings?.businessName || 'Aligarh Web Solutions';
  const siteName = website.label || website.url;
  const client = website.client || null;

  const ownerEmail = settings?.ownerAlertEmail?.trim() || null;
  const ownerWa = settings?.ownerAlertWhatsapp?.trim() || null;
  const extraContacts: string[] = Array.isArray(website.alertContacts)
    ? website.alertContacts.map((c: any) => String(c || '').trim()).filter(Boolean)
    : [];

  let notifiedOwner = false;
  let notifiedClient = false;

  const subject =
    kind === 'DOWN'
      ? `[DOWN ALERT] ${siteName} is unreachable`
      : `[RECOVERED] ${siteName} is back online`;

  const ownerBody =
    kind === 'DOWN'
      ? `${siteName} (${website.url}) failed ${website.consecutiveFailures || website.failureThreshold} consecutive uptime checks at ${formatDateDDMMMYYYY(now, tz)}.\nError: ${errorSummary || 'Unreachable'}\nClient: ${client?.name || '—'}`
      : `${siteName} (${website.url}) has recovered and is responding normally.\nDowntime duration: ${formatDurationCompact(durationSeconds)}\nClient: ${client?.name || '—'}`;

  if (ownerEmail) {
    const ok = await sendAlertEmailWithLog({
      prisma,
      settings,
      recipient: ownerEmail,
      subject,
      body: ownerBody,
      clientId: website.clientId,
      entityType: 'UPTIME',
      entityId: website.id,
      idempotencyKey: `UPTIME_${kind}:${incident.id}:OWNER:EMAIL`,
      now,
    });
    if (ok) notifiedOwner = true;
  }

  for (const contact of extraContacts) {
    if (contact.includes('@')) {
      const ok = await sendAlertEmailWithLog({
        prisma,
        settings,
        recipient: contact,
        subject,
        body: ownerBody,
        clientId: website.clientId,
        entityType: 'UPTIME',
        entityId: website.id,
        idempotencyKey: `UPTIME_${kind}:${incident.id}:EXTRA:${contact}:EMAIL`,
        now,
      });
      if (ok) notifiedOwner = true;
    }
  }

  if (ownerWa) {
    const ok = await sendAlertWhatsappWithLog({
      prisma,
      settings,
      phone: ownerWa,
      body: ownerBody,
      clientId: website.clientId,
      entityType: 'UPTIME',
      entityId: website.id,
      idempotencyKey: `UPTIME_${kind}:${incident.id}:OWNER:WHATSAPP`,
      now,
    });
    if (ok) notifiedOwner = true;
  }

  // Optional client notification if enabled on both website & client
  if (website.notifyClient && client && client.remindersEnabled !== false) {
    const clientEmails = Array.isArray(client.emails) ? client.emails.filter(Boolean) : [];
    const pref = String(client.preferredChannel || 'BOTH').toUpperCase();
    const downTpl =
      kind === 'DOWN'
        ? await prisma.messageTemplate.findUnique({ where: { slug: 'site-down-en' } })
        : null;

    const clientBody =
      kind === 'DOWN' && downTpl?.body
        ? renderTemplateText(downTpl.body, {
            client_name: client.contactPerson || client.name,
            business_name: businessName,
            domain: siteName,
            service_name: website.url,
          })
        : kind === 'DOWN'
          ? `Hello ${client.contactPerson || client.name},\n\nOur uptime monitor detected that ${siteName} (${website.url}) is currently unreachable (${errorSummary || 'timeout'}). We are investigating and will update you once recovered.\n\nRegards,\n${businessName}`
          : `Hello ${client.contactPerson || client.name},\n\nGood news — ${siteName} (${website.url}) is back online after ${formatDurationCompact(durationSeconds)}.\n\nRegards,\n${businessName}`;

    const clientSubject =
      kind === 'DOWN' && downTpl?.subject
        ? renderTemplateText(downTpl.subject, { domain: siteName, business_name: businessName })
        : kind === 'DOWN'
          ? `Alert: ${siteName} is currently unreachable`
          : `Resolved: ${siteName} is back online`;

    if (clientEmails.length > 0 && (pref === 'EMAIL' || pref === 'BOTH')) {
      const ok = await sendAlertEmailWithLog({
        prisma,
        settings,
        recipient: clientEmails[0],
        subject: clientSubject,
        body: clientBody,
        clientId: client.id,
        entityType: 'UPTIME',
        entityId: website.id,
        idempotencyKey: `UPTIME_${kind}:${incident.id}:CLIENT:EMAIL`,
        now,
      });
      if (ok) notifiedClient = true;
    }

    if (client.whatsappPhone && (pref === 'WHATSAPP' || pref === 'BOTH')) {
      const ok = await sendAlertWhatsappWithLog({
        prisma,
        settings,
        phone: client.whatsappPhone,
        body: clientBody,
        clientId: client.id,
        entityType: 'UPTIME',
        entityId: website.id,
        idempotencyKey: `UPTIME_${kind}:${incident.id}:CLIENT:WHATSAPP`,
        now,
      });
      if (ok) notifiedClient = true;
    }
  }

  return { notifiedOwner, notifiedClient };
}

export async function checkSingleWebsite(
  prisma: PrismaClient,
  website: any,
  now: Date = new Date(),
  options: {
    probeFn?: (target: WebsiteProbeTarget) => Promise<WebsiteProbeResult>;
    settings?: any;
  } = {}
): Promise<{
  websiteId: string;
  up: boolean;
  httpCode: number | null;
  responseMs: number;
  error: string | null;
  sslExpiry: Date | null;
  incidentOpened: boolean;
  incidentResolved: boolean;
}> {
  const settings = options.settings ?? (await prisma.settings.findUnique({ where: { id: 1 } }));
  const probeFn = options.probeFn || ((t: WebsiteProbeTarget) => probeWebsite(t));

  const result = await probeFn({
    url: website.url,
    expectedStatusCode: website.expectedStatusCode,
    requiredKeyword: website.requiredKeyword,
    timeoutMs: website.timeoutMs,
  });

  await prisma.uptimeCheck.create({
    data: {
      websiteId: website.id,
      checkedAt: now,
      up: result.up,
      httpCode: result.httpCode,
      responseMs: result.responseMs,
      error: result.error,
    },
  });

  const effectiveSslExpiry = result.sslExpiry ?? (website.sslExpiry ? new Date(website.sslExpiry) : null);
  const threshold = Math.max(1, Number(website.failureThreshold || 2));

  let incidentOpened = false;
  let incidentResolved = false;

  if (!result.up) {
    const nextFailures = Number(website.consecutiveFailures || 0) + 1;
    const shouldMarkDown = nextFailures >= threshold;
    const becameDown = shouldMarkDown && !website.isDown;

    await prisma.website.update({
      where: { id: website.id },
      data: {
        consecutiveFailures: nextFailures,
        isDown: website.isDown || shouldMarkDown,
        lastCheckedAt: now,
        lastResponseMs: result.responseMs,
        ...(result.sslExpiry ? { sslExpiry: result.sslExpiry } : {}),
      },
    });

    if (becameDown) {
      const incident = await prisma.incident.create({
        data: {
          websiteId: website.id,
          startedAt: now,
          errorSummary: result.error || 'Website unreachable',
        },
      });
      incidentOpened = true;

      const alertOutcome = await dispatchIncidentAlerts({
        prisma,
        website: { ...website, consecutiveFailures: nextFailures },
        incident,
        kind: 'DOWN',
        now,
        settings,
        errorSummary: result.error,
      });

      if (alertOutcome.notifiedOwner || alertOutcome.notifiedClient) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            notifiedOwner: alertOutcome.notifiedOwner,
            notifiedClient: alertOutcome.notifiedClient,
          },
        });
      }
    }
  } else {
    await prisma.website.update({
      where: { id: website.id },
      data: {
        consecutiveFailures: 0,
        isDown: false,
        lastCheckedAt: now,
        lastResponseMs: result.responseMs,
        ...(result.sslExpiry ? { sslExpiry: result.sslExpiry } : {}),
      },
    });

    const openIncidents = await prisma.incident.findMany({
      where: { websiteId: website.id, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    for (const openInc of openIncidents as any[]) {
      const startedAtMs = new Date(openInc.startedAt).getTime();
      const durationSeconds = Math.max(0, Math.round((now.getTime() - startedAtMs) / 1000));
      await prisma.incident.update({
        where: { id: openInc.id },
        data: {
          endedAt: now,
          durationSeconds,
        },
      });
      incidentResolved = true;

      if (openInc.notifiedOwner || openInc.notifiedClient) {
        await dispatchIncidentAlerts({
          prisma,
          website,
          incident: openInc,
          kind: 'RECOVERY',
          now,
          settings,
          durationSeconds,
        });
      }
    }
  }

  // SSL Expiry warning (30 / 14 / 7 / 3 / 1 / 0 days)
  if (effectiveSslExpiry && settings?.ownerAlertEmail) {
    const tz = settings.timezone || 'Asia/Kolkata';
    const sslDaysLeft = getDaysLeftIST(effectiveSslExpiry, now, tz);
    if ([30, 14, 7, 3, 1, 0].includes(sslDaysLeft)) {
      const sslYmd = getIstYmd(effectiveSslExpiry, tz);
      const siteName = website.label || website.url;
      await sendAlertEmailWithLog({
        prisma,
        settings,
        recipient: settings.ownerAlertEmail,
        subject: `[SSL Alert] ${siteName} certificate expires in ${sslDaysLeft} day(s)`,
        body: `SSL Certificate for ${siteName} (${website.url}) expires on ${formatDateDDMMMYYYY(effectiveSslExpiry, tz)} (${sslDaysLeft} days remaining).`,
        clientId: website.clientId,
        entityType: 'SSL',
        entityId: website.id,
        offsetDays: sslDaysLeft,
        idempotencyKey: `SSL_EXPIRY:${website.id}:${sslYmd}:${sslDaysLeft}:EMAIL`,
        now,
      });
    }
  }

  return {
    websiteId: website.id,
    up: result.up,
    httpCode: result.httpCode,
    responseMs: result.responseMs,
    error: result.error,
    sslExpiry: effectiveSslExpiry,
    incidentOpened,
    incidentResolved,
  };
}

export async function runUptimeChecksJob(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: {
    forceAll?: boolean;
    probeFn?: (target: WebsiteProbeTarget) => Promise<WebsiteProbeResult>;
  } = {}
): Promise<string> {
  await ensureDefaultSettings(prisma);
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  const websites = await prisma.website.findMany({
    where: { paused: false },
    include: { client: true },
  });

  const due = (websites as any[]).filter((w) => {
    if (options.forceAll) return true;
    if (!w.lastCheckedAt) return true;
    const elapsedMs = now.getTime() - new Date(w.lastCheckedAt).getTime();
    const intervalMs = Math.max(1, Number(w.intervalMinutes || 5)) * 60_000;
    return elapsedMs >= intervalMs;
  });

  if (due.length === 0) {
    return `0 of ${websites.length} websites due for check`;
  }

  let upCount = 0;
  let downCount = 0;
  const concurrency = 5;

  for (let i = 0; i < due.length; i += concurrency) {
    const chunk = due.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((w) =>
        checkSingleWebsite(prisma, w, now, {
          probeFn: options.probeFn,
          settings,
        })
      )
    );
    for (const r of results) {
      if (r.up) upCount += 1;
      else downCount += 1;
    }
  }

  return `Checked ${due.length} websites (${upCount} up, ${downCount} down)`;
}

export async function runDataRetentionJob(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<string> {
  const retentionCutoff = new Date(now.getTime() - 90 * 86_400_000);
  const prunedChecks = await prisma.uptimeCheck.deleteMany({
    where: { checkedAt: { lt: retentionCutoff } },
  });
  const prunedSessions = await prisma.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  return `Pruned ${prunedChecks.count} uptime checks (>90d) and ${prunedSessions.count} expired sessions`;
}
