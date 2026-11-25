import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { getClientIp, requireAuth } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { ensureDefaultRulesAndTemplates, ensureDefaultSettings } from '../lib/demoSeed';
import {
  renderTemplateText,
  sendEmailMessage,
  whatsappProvider,
  EmailAttachment,
} from '../lib/messaging';
import {
  dispatchMessageLogRow,
  runOwnerDigestJob,
  runReminderJob,
} from '../jobs/reminderEngine';
import { generateEstimatePdfBuffer, generateInvoicePdfBuffer } from '../lib/pdfGenerator';
import { serializeEstimate, serializeInvoice } from '../lib/billingHelpers';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';

const router = Router();
router.use(requireAuth);

function serializeRule(r: any) {
  return {
    id: r.id,
    name: r.name,
    itemType: r.itemType,
    offsets: Array.isArray(r.offsets) ? r.offsets.map(Number) : [],
    channels: Array.isArray(r.channels) ? r.channels : ['EMAIL'],
    templateId: r.templateId || null,
    templateName: r.template?.name || null,
    enabled: Boolean(r.enabled),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

function serializeTemplate(t: any) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    language: t.language || 'en',
    channel: t.channel,
    subject: t.subject ?? null,
    body: t.body,
    waTemplateName: t.waTemplateName ?? null,
    waLanguageCode: t.waLanguageCode ?? null,
    waVariableMapping: Array.isArray(t.waVariableMapping) ? t.waVariableMapping : [],
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  };
}

function serializeLog(l: any) {
  return {
    id: l.id,
    clientId: l.clientId ?? null,
    clientName: l.client?.name || null,
    clientPhone: l.client?.whatsappPhone ?? null,
    channel: l.channel,
    templateId: l.templateId ?? null,
    templateName: l.template?.name || null,
    renderedSubject: l.renderedSubject ?? null,
    renderedContent: l.renderedContent,
    entityType: l.entityType ?? null,
    entityId: l.entityId ?? null,
    offsetDays: l.offsetDays !== undefined && l.offsetDays !== null ? Number(l.offsetDays) : null,
    idempotencyKey: l.idempotencyKey ?? null,
    scheduledAt: l.scheduledAt instanceof Date ? l.scheduledAt.toISOString() : l.scheduledAt ?? null,
    sentAt: l.sentAt instanceof Date ? l.sentAt.toISOString() : l.sentAt ?? null,
    status: l.status,
    providerMessageId: l.providerMessageId ?? null,
    error: l.error ?? null,
    retryCount: Number(l.retryCount ?? 0),
    nextRetryAt: l.nextRetryAt instanceof Date ? l.nextRetryAt.toISOString() : l.nextRetryAt ?? null,
    direction: l.direction || 'OUTBOUND',
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    updatedAt: l.updatedAt instanceof Date ? l.updatedAt.toISOString() : l.updatedAt,
  };
}

// ==========================================
// Notification Logs
// ==========================================

router.get('/logs', async (req, res, next) => {
  try {
    await ensureDefaultRulesAndTemplates(db);
    const channel = String(req.query.channel || '').trim();
    const status = String(req.query.status || '').trim();
    const direction = String(req.query.direction || '').trim();
    const clientId = String(req.query.clientId || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));

    const all = await db.messageLog.findMany({
      where: {
        ...(channel && channel !== 'ALL' ? { channel: channel as any } : {}),
        ...(status && status !== 'ALL' ? { status: status as any } : {}),
        ...(direction && direction !== 'ALL' ? { direction } : {}),
        ...(clientId ? { clientId } : {}),
      },
      include: {
        client: { select: { id: true, name: true, whatsappPhone: true } },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const filtered = (all as any[]).filter((row) => {
      if (!q) return true;
      const hay = `${row.client?.name || ''} ${row.renderedSubject || ''} ${row.renderedContent || ''} ${row.entityType || ''} ${row.error || ''}`.toLowerCase();
      return hay.includes(q);
    });

    const allForCounts = await db.messageLog.findMany({ select: { status: true, direction: true } });
    const counts = {
      total: allForCounts.length,
      queued: allForCounts.filter((r: any) => r.status === 'QUEUED').length,
      sent: allForCounts.filter((r: any) => r.direction !== 'INBOUND' && ['SENT', 'DELIVERED', 'READ'].includes(r.status)).length,
      delivered: allForCounts.filter((r: any) => r.direction !== 'INBOUND' && r.status === 'DELIVERED').length,
      read: allForCounts.filter((r: any) => r.direction !== 'INBOUND' && r.status === 'READ').length,
      failed: allForCounts.filter((r: any) => r.status === 'FAILED').length,
      skipped: allForCounts.filter((r: any) => r.status === 'SKIPPED').length,
      inbound: allForCounts.filter((r: any) => r.direction === 'INBOUND').length,
      unreadInbound: allForCounts.filter((r: any) => r.direction === 'INBOUND' && r.status !== 'READ').length,
    };

    res.json({
      items: filtered.slice(0, limit).map(serializeLog),
      counts,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logs/:id/retry', async (req, res, next) => {
  try {
    const row = await db.messageLog.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Message log entry not found' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const result = await dispatchMessageLogRow(db, row, settings, new Date());

    const updated = await db.messageLog.findUnique({
      where: { id: row.id },
      include: {
        client: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'MESSAGE_RETRIED',
      entityType: 'MessageLog',
      entityId: row.id,
      summary: `Retried ${row.channel} notification (${result.status})`,
      ipAddress: getClientIp(req),
    });

    res.json({ log: serializeLog(updated), result });
  } catch (err) {
    next(err);
  }
});

router.post('/logs/:id/skip', async (req, res, next) => {
  try {
    const updated = await db.messageLog.update({
      where: { id: req.params.id },
      data: { status: 'SKIPPED', nextRetryAt: null },
      include: {
        client: { select: { id: true, name: true, whatsappPhone: true } },
        template: { select: { id: true, name: true } },
      },
    });
    res.json({ log: serializeLog(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/logs/:id/mark-read', async (req, res, next) => {
  try {
    const updated = await db.messageLog.update({
      where: { id: req.params.id },
      data: { status: 'READ' },
      include: {
        client: { select: { id: true, name: true, whatsappPhone: true } },
        template: { select: { id: true, name: true } },
      },
    });
    res.json({ log: serializeLog(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/logs/mark-all-read', async (_req, res, next) => {
  try {
    const resUpdate = await db.messageLog.updateMany({
      where: { direction: 'INBOUND', status: { not: 'READ' } },
      data: { status: 'READ' },
    });
    res.json({ ok: true, updated: resUpdate.count });
  } catch (err) {
    next(err);
  }
});

router.get('/whatsapp/status', async (_req, res, next) => {
  try {
    await ensureDefaultSettings(db);
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const hasAccessToken = Boolean(settings?.whatsappAccessTokenEnc || process.env.WHATSAPP_ACCESS_TOKEN);
    const hasVerifyToken = Boolean(settings?.whatsappVerifyTokenEnc || process.env.WHATSAPP_VERIFY_TOKEN);
    const hasAppSecret = Boolean(settings?.whatsappAppSecretEnc || process.env.WHATSAPP_APP_SECRET);
    const phoneNumberId = settings?.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null;

    const waLogs = await db.messageLog.findMany({
      where: { channel: 'WHATSAPP' },
      select: { status: true, direction: true },
    });

    res.json({
      configured: Boolean(phoneNumberId && hasAccessToken),
      webhookReady: Boolean(hasVerifyToken && hasAppSecret),
      phoneNumberId,
      businessAccountId: settings?.whatsappBusinessAccountId || null,
      hasAccessToken,
      hasVerifyToken,
      hasAppSecret,
      webhookPath: '/api/webhooks/whatsapp',
      stats: {
        outboundSent: waLogs.filter((l: any) => l.direction !== 'INBOUND' && ['SENT', 'DELIVERED', 'READ'].includes(l.status)).length,
        delivered: waLogs.filter((l: any) => l.direction !== 'INBOUND' && l.status === 'DELIVERED').length,
        read: waLogs.filter((l: any) => l.direction !== 'INBOUND' && l.status === 'READ').length,
        inboundTotal: waLogs.filter((l: any) => l.direction === 'INBOUND').length,
        unreadInbound: waLogs.filter((l: any) => l.direction === 'INBOUND' && l.status !== 'READ').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Manual Dispatch & Engine Triggers
// ==========================================

router.post('/send-manual', async (req, res, next) => {
  try {
    const schema = z.object({
      clientId: z.string().min(1),
      channel: z.enum(['EMAIL', 'WHATSAPP']),
      templateId: z.string().optional().nullable(),
      subject: z.string().trim().max(255).optional().nullable(),
      body: z.string().trim().min(1).max(10000),
      attachInvoiceId: z.string().optional().nullable(),
      attachEstimateId: z.string().optional().nullable(),
      dryRun: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid manual message payload', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const client = await db.client.findUnique({ where: { id: d.clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    await ensureDefaultSettings(db);
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const vars = {
      client_name: client.contactPerson || client.name,
      business_name: settings?.businessName || 'Aligarh Web Solutions',
      pay_link: baseUrl,
      domain: '',
      expiry_date: formatDateDDMMMYYYY(new Date()),
      days_left: 0,
      amount: '',
      invoice_no: '',
    };

    const renderedSubject = d.channel === 'EMAIL' ? renderTemplateText(d.subject || 'Update from Aligarh Web Solutions', vars) : null;
    const renderedContent = renderTemplateText(d.body, vars);

    const attachments: EmailAttachment[] = [];
    let entityType: string | null = 'MANUAL';
    let entityId: string | null = client.id;

    if (d.channel === 'EMAIL' && d.attachInvoiceId) {
      const inv = await db.invoice.findUnique({
        where: { id: d.attachInvoiceId },
        include: { client: true, items: { orderBy: { sortOrder: 'asc' } }, payments: true, creditNotes: true },
      });
      if (inv) {
        const buf = await generateInvoicePdfBuffer(serializeInvoice(inv), settings || {});
        attachments.push({
          filename: `${inv.invoiceNumber}.pdf`,
          content: buf,
          contentType: 'application/pdf',
        });
        entityType = 'INVOICE';
        entityId = inv.id;
      }
    } else if (d.channel === 'EMAIL' && d.attachEstimateId) {
      const est = await db.estimate.findUnique({
        where: { id: d.attachEstimateId },
        include: { client: true, items: { orderBy: { sortOrder: 'asc' } } },
      });
      if (est) {
        const buf = await generateEstimatePdfBuffer(serializeEstimate(est), settings || {});
        attachments.push({
          filename: `${est.estimateNumber}.pdf`,
          content: buf,
          contentType: 'application/pdf',
        });
        entityType = 'ESTIMATE';
        entityId = est.id;
      }
    }

    let sendRes;
    if (d.channel === 'EMAIL') {
      const emails = Array.isArray(client.emails)
        ? client.emails.map((e: any) => String(e || '').trim()).filter(Boolean)
        : [];
      sendRes = await sendEmailMessage({
        to: emails,
        subject: renderedSubject || 'Message from Aligarh Web Solutions',
        text: renderedContent,
        attachments,
        settings,
        forceDryRun: d.dryRun,
      });
    } else {
      const tpl = d.templateId ? await db.messageTemplate.findUnique({ where: { id: d.templateId } }) : null;
      sendRes = await whatsappProvider.sendMessage({
        to: client.whatsappPhone || '',
        templateName: tpl?.waTemplateName || null,
        languageCode: tpl?.waLanguageCode || tpl?.language || 'en',
        renderedText: renderedContent,
        settings,
        forceDryRun: d.dryRun,
      });
    }

    const now = new Date();
    const createdLog = await db.messageLog.create({
      data: {
        clientId: client.id,
        channel: d.channel,
        templateId: d.templateId || null,
        renderedSubject,
        renderedContent,
        entityType,
        entityId,
        sentAt: sendRes.ok ? now : null,
        status: sendRes.ok ? 'SENT' : 'FAILED',
        providerMessageId: sendRes.providerMessageId || null,
        error: sendRes.error || null,
        direction: 'OUTBOUND',
      },
      include: {
        client: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'MANUAL_MESSAGE_SENT',
      entityType: 'Client',
      entityId: client.id,
      summary: `Sent manual ${d.channel} to ${client.name} (${createdLog.status})`,
      ipAddress: getClientIp(req),
    });

    res.status(sendRes.ok ? 200 : 400).json({
      log: serializeLog(createdLog),
      ok: sendRes.ok,
      error: sendRes.error,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/run-reminders', async (req, res, next) => {
  try {
    const dispatchNow = Boolean(req.body?.dispatchNow);
    const summary = await runReminderJob(db, new Date(), {
      forceEval: true,
      ignoreQuietHours: dispatchNow,
    });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'REMINDERS_MANUAL_RUN',
      summary,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

router.post('/run-digest', async (req, res, next) => {
  try {
    const summary = await runOwnerDigestJob(db, new Date(), { force: true });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'OWNER_DIGEST_MANUAL_RUN',
      summary,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Reminder Rules CRUD
// ==========================================

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(191),
  itemType: z.enum(['DOMAIN', 'SERVICE', 'INVOICE', 'ESTIMATE', 'UPTIME']),
  offsets: z.array(z.coerce.number().int().min(-365).max(365)).min(1),
  channels: z.array(z.enum(['EMAIL', 'WHATSAPP'])).min(1),
  templateId: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
});

router.get('/rules', async (_req, res, next) => {
  try {
    await ensureDefaultRulesAndTemplates(db);
    const rules = await db.reminderRule.findMany({
      include: { template: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items: rules.map(serializeRule) });
  } catch (err) {
    next(err);
  }
});

router.post('/rules', async (req, res, next) => {
  try {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reminder rule', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const created = await db.reminderRule.create({
      data: {
        name: d.name,
        itemType: d.itemType,
        offsets: Array.from(new Set(d.offsets)).sort((a, b) => b - a),
        channels: Array.from(new Set(d.channels)),
        templateId: d.templateId || null,
        enabled: d.enabled,
      },
      include: { template: { select: { id: true, name: true } } },
    });
    res.status(201).json({ rule: serializeRule(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/rules/:id', async (req, res, next) => {
  try {
    const parsed = ruleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reminder rule update' });
      return;
    }
    const d = parsed.data;
    const updated = await db.reminderRule.update({
      where: { id: req.params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.itemType !== undefined ? { itemType: d.itemType } : {}),
        ...(d.offsets !== undefined
          ? { offsets: Array.from(new Set(d.offsets)).sort((a, b) => b - a) }
          : {}),
        ...(d.channels !== undefined ? { channels: Array.from(new Set(d.channels)) } : {}),
        ...(d.templateId !== undefined ? { templateId: d.templateId || null } : {}),
        ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
      },
      include: { template: { select: { id: true, name: true } } },
    });
    res.json({ rule: serializeRule(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    await db.reminderRule.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Message Templates CRUD & Preview
// ==========================================

const templateSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, hyphens'),
  name: z.string().trim().min(1).max(191),
  language: z.string().trim().min(2).max(16).default('en'),
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  subject: z.string().trim().max(255).optional().nullable(),
  body: z.string().trim().min(1).max(10000),
  waTemplateName: z.string().trim().max(191).optional().nullable(),
  waLanguageCode: z.string().trim().max(16).optional().nullable(),
  waVariableMapping: z.array(z.string().trim()).optional(),
});

router.get('/templates', async (_req, res, next) => {
  try {
    await ensureDefaultRulesAndTemplates(db);
    const items = await db.messageTemplate.findMany({ orderBy: { name: 'asc' } });
    res.json({ items: items.map(serializeTemplate) });
  } catch (err) {
    next(err);
  }
});

router.post('/templates', async (req, res, next) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid template data', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const existing = await db.messageTemplate.findUnique({ where: { slug: d.slug } });
    if (existing) {
      res.status(409).json({ error: 'A template with this slug already exists' });
      return;
    }
    const created = await db.messageTemplate.create({
      data: {
        slug: d.slug,
        name: d.name,
        language: d.language,
        channel: d.channel,
        subject: d.channel === 'EMAIL' ? d.subject || null : null,
        body: d.body,
        waTemplateName: d.channel === 'WHATSAPP' ? d.waTemplateName || null : null,
        waLanguageCode: d.channel === 'WHATSAPP' ? d.waLanguageCode || d.language : null,
        waVariableMapping: d.waVariableMapping || [],
      },
    });
    res.status(201).json({ template: serializeTemplate(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/templates/:id', async (req, res, next) => {
  try {
    const parsed = templateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid template update' });
      return;
    }
    const d = parsed.data;
    const updated = await db.messageTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.language !== undefined ? { language: d.language } : {}),
        ...(d.channel !== undefined ? { channel: d.channel } : {}),
        ...(d.subject !== undefined ? { subject: d.subject || null } : {}),
        ...(d.body !== undefined ? { body: d.body } : {}),
        ...(d.waTemplateName !== undefined ? { waTemplateName: d.waTemplateName || null } : {}),
        ...(d.waLanguageCode !== undefined ? { waLanguageCode: d.waLanguageCode || null } : {}),
        ...(d.waVariableMapping !== undefined ? { waVariableMapping: d.waVariableMapping } : {}),
      },
    });
    res.json({ template: serializeTemplate(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/templates/:id', async (req, res, next) => {
  try {
    await db.messageTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/templates/preview', async (req, res, next) => {
  try {
    const schema = z.object({
      subject: z.string().optional().nullable(),
      body: z.string(),
      clientId: z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid preview request' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const client = parsed.data.clientId
      ? await db.client.findUnique({
          where: { id: parsed.data.clientId },
          include: { domains: true, invoices: true },
        })
      : await db.client.findFirst({ include: { domains: true, invoices: true } });

    const sampleDomain = (client as any)?.domains?.[0];
    const sampleInv = (client as any)?.invoices?.[0];
    const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

    const vars = {
      client_name: (client as any)?.contactPerson || (client as any)?.name || 'Tariq Ahmad',
      business_name: settings?.businessName || 'Aligarh Web Solutions',
      domain: sampleDomain?.name || 'example.in',
      service_name: sampleDomain?.name || 'Business Cloud Hosting',
      expiry_date: formatDateDDMMMYYYY(sampleDomain?.expiryDate || new Date(Date.now() + 7 * 86_400_000)),
      days_left: 7,
      amount: formatINR(Number(sampleInv?.total || sampleDomain?.sellingPrice || 1500), { decimals: 2 }),
      invoice_no: sampleInv?.invoiceNumber || 'INV-26-27-0001',
      estimate_no: 'EST-000053',
      pay_link: sampleInv ? `${baseUrl}/public/invoice/${sampleInv.publicToken}` : `${baseUrl}/public/invoice/sample`,
    };

    res.json({
      renderedSubject: parsed.data.subject ? renderTemplateText(parsed.data.subject, vars) : null,
      renderedBody: renderTemplateText(parsed.data.body, vars),
      sampleClientName: (client as any)?.name || 'Sample Client',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
