import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { encryptSecret } from '../lib/crypto';
import { recordAudit } from '../lib/audit';
import { clearDemoData, ensureDefaultSettings, seedDemoData } from '../lib/demoSeed';
import { sendEmailMessage } from '../lib/messaging';
import { buildSanitizedBackupPayload, compressBackupPayload } from '../lib/backup';
import { runWeeklyBackupJob } from '../jobs/phase6Jobs';

const router = Router();
router.use(requireAuth);

function serializeSettings(s: any) {
  return {
    businessName: s.businessName,
    businessState: s.businessState,
    address: s.address,
    gstin: s.gstin,
    pan: s.pan,
    bankName: s.bankName,
    bankAccountNumber: s.bankAccountNumber,
    bankIfsc: s.bankIfsc,
    bankAccountName: s.bankAccountName,
    upiId: s.upiId,
    logoDataUrl: s.logoDataUrl,
    invoicePrefix: s.invoicePrefix,
    estimatePrefix: s.estimatePrefix,
    receiptPrefix: s.receiptPrefix,
    defaultTaxRate: Number(s.defaultTaxRate ?? 18),
    gstEnabled: Boolean(s.gstEnabled),
    defaultInvoiceTerms: s.defaultInvoiceTerms,
    defaultEstimateTerms: s.defaultEstimateTerms,
    currency: s.currency,
    timezone: s.timezone,
    smtpHost: s.smtpHost,
    smtpPort: Number(s.smtpPort ?? 465),
    smtpSecure: Boolean(s.smtpSecure),
    smtpUser: s.smtpUser,
    hasSmtpPass: Boolean(s.smtpPassEncrypted),
    smtpFromName: s.smtpFromName,
    smtpFromEmail: s.smtpFromEmail,
    emailProvider: s.emailProvider,
    hasEmailApiKey: Boolean(s.emailApiKeyEncrypted),
    whatsappPhoneNumberId: s.whatsappPhoneNumberId,
    whatsappBusinessAccountId: s.whatsappBusinessAccountId,
    hasWhatsappAccessToken: Boolean(s.whatsappAccessTokenEnc),
    hasWhatsappVerifyToken: Boolean(s.whatsappVerifyTokenEnc),
    hasWhatsappAppSecret: Boolean(s.whatsappAppSecretEnc),
    ownerAlertEmail: s.ownerAlertEmail,
    ownerAlertWhatsapp: s.ownerAlertWhatsapp,
    quietHoursStart: s.quietHoursStart,
    quietHoursEnd: s.quietHoursEnd,
    reminderEvalHourIst: Number(s.reminderEvalHourIst ?? 6),
    dryRunMode: Boolean(s.dryRunMode),
    recurringAutoSend: Boolean(s.recurringAutoSend),
    razorpayEnabled: Boolean(s.razorpayEnabled),
    razorpayKeyId: s.razorpayKeyId,
    hasRazorpaySecret: Boolean(s.razorpayKeySecretEnc),
  };
}

router.get('/', async (_req, res, next) => {
  try {
    await ensureDefaultSettings(db);
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    res.json({ settings: serializeSettings(settings) });
  } catch (err) {
    next(err);
  }
});

const settingsPatchSchema = z.object({
  businessName: z.string().trim().min(1).max(191).optional(),
  businessState: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().max(2000).optional().nullable(),
  gstin: z.string().trim().max(32).optional().nullable(),
  pan: z.string().trim().max(32).optional().nullable(),
  bankName: z.string().trim().max(191).optional().nullable(),
  bankAccountNumber: z.string().trim().max(64).optional().nullable(),
  bankIfsc: z.string().trim().max(32).optional().nullable(),
  bankAccountName: z.string().trim().max(191).optional().nullable(),
  upiId: z.string().trim().max(128).optional().nullable(),
  logoDataUrl: z.string().max(400_000).optional().nullable(),
  invoicePrefix: z.string().trim().min(1).max(20).optional(),
  estimatePrefix: z.string().trim().min(1).max(20).optional(),
  receiptPrefix: z.string().trim().min(1).max(20).optional(),
  defaultTaxRate: z.coerce.number().min(0).max(50).optional(),
  gstEnabled: z.boolean().optional(),
  defaultInvoiceTerms: z.string().max(4000).optional().nullable(),
  defaultEstimateTerms: z.string().max(4000).optional().nullable(),
  currency: z.string().trim().min(3).max(8).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  smtpHost: z.string().trim().max(191).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(191).optional().nullable(),
  smtpPass: z.string().max(512).optional(),
  smtpFromName: z.string().trim().max(191).optional(),
  smtpFromEmail: z.string().trim().max(191).optional().nullable(),
  emailProvider: z.enum(['SMTP', 'BREVO', 'RESEND']).optional(),
  emailApiKey: z.string().max(512).optional(),
  whatsappPhoneNumberId: z.string().trim().max(128).optional().nullable(),
  whatsappBusinessAccountId: z.string().trim().max(128).optional().nullable(),
  whatsappAccessToken: z.string().max(1024).optional(),
  whatsappVerifyToken: z.string().max(512).optional(),
  whatsappAppSecret: z.string().max(512).optional(),
  ownerAlertEmail: z.string().trim().email().optional().nullable().or(z.literal('')),
  ownerAlertWhatsapp: z.string().trim().max(32).optional().nullable(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reminderEvalHourIst: z.coerce.number().int().min(0).max(23).optional(),
  dryRunMode: z.boolean().optional(),
  recurringAutoSend: z.boolean().optional(),
  razorpayEnabled: z.boolean().optional(),
  razorpayKeyId: z.string().trim().max(128).optional().nullable(),
  razorpayKeySecret: z.string().max(512).optional(),
});

router.patch('/', async (req, res, next) => {
  try {
    await ensureDefaultSettings(db);
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settings payload', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const data: Record<string, any> = {};
    const directKeys = [
      'businessName', 'businessState', 'address', 'gstin', 'pan',
      'bankName', 'bankAccountNumber', 'bankIfsc', 'bankAccountName', 'upiId', 'logoDataUrl',
      'invoicePrefix', 'estimatePrefix', 'receiptPrefix', 'defaultTaxRate', 'gstEnabled',
      'defaultInvoiceTerms', 'defaultEstimateTerms', 'currency', 'timezone',
      'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFromName', 'smtpFromEmail',
      'emailProvider', 'whatsappPhoneNumberId', 'whatsappBusinessAccountId',
      'ownerAlertEmail', 'ownerAlertWhatsapp', 'quietHoursStart', 'quietHoursEnd',
      'reminderEvalHourIst', 'dryRunMode', 'recurringAutoSend', 'razorpayEnabled', 'razorpayKeyId',
    ] as const;

    for (const k of directKeys) {
      if (d[k] !== undefined) {
        data[k] = d[k] === '' ? null : d[k];
      }
    }

    if (d.smtpPass) data.smtpPassEncrypted = encryptSecret(d.smtpPass);
    if (d.emailApiKey) data.emailApiKeyEncrypted = encryptSecret(d.emailApiKey);
    if (d.whatsappAccessToken) data.whatsappAccessTokenEnc = encryptSecret(d.whatsappAccessToken);
    if (d.whatsappVerifyToken) data.whatsappVerifyTokenEnc = encryptSecret(d.whatsappVerifyToken);
    if (d.whatsappAppSecret) data.whatsappAppSecretEnc = encryptSecret(d.whatsappAppSecret);
    if (d.razorpayKeySecret) data.razorpayKeySecretEnc = encryptSecret(d.razorpayKeySecret);

    const updated = await db.settings.update({
      where: { id: 1 },
      data,
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'SETTINGS_UPDATED',
      entityType: 'Settings',
      entityId: '1',
      summary: 'Updated control center settings',
      ipAddress: getClientIp(req),
    });

    res.json({ settings: serializeSettings(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/test-smtp', async (req, res) => {
  try {
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      res.status(400).json({ error: 'Settings not initialized.' });
      return;
    }

    const recipient = req.body?.to || settings.ownerAlertEmail || req.authUser?.email;
    const result = await sendEmailMessage({
      to: recipient,
      subject: `Email Provider Test (${settings.emailProvider || 'SMTP'}) — AWS Control Center`,
      text: `Email delivery verified successfully from ${settings.businessName}.\nProvider: ${settings.emailProvider || 'SMTP'}`,
      settings,
      forceDryRun: false,
    });

    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Email connection failed' });
      return;
    }

    res.json({ ok: true, message: `Test email sent to ${recipient}` });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Email connection failed' });
  }
});

router.get('/audit-logs', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 30)));
    const all = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' } });
    const total = all.length;
    const items = all.slice((page - 1) * pageSize, page * pageSize).map((l: any) => ({
      ...l,
      createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    }));
    res.json({ items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.post('/demo/seed', async (req, res, next) => {
  try {
    const result = await seedDemoData(db);
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DEMO_SEEDED',
      summary: `Seeded demo dataset (${result.clients} clients, ${result.domains} domains, ${result.services} services)`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.post('/demo/clear', async (req, res, next) => {
  try {
    await clearDemoData(db);
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'DEMO_CLEARED',
      summary: 'Removed demo dataset records',
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/tasks', async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(255),
      description: z.string().trim().max(2000).optional().nullable(),
      dueDate: z.string().optional().nullable(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
      clientId: z.string().optional().nullable(),
      domainId: z.string().optional().nullable(),
      serviceId: z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid task payload' });
      return;
    }
    const created = await db.task.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        priority: parsed.data.priority,
        clientId: parsed.data.clientId || null,
        domainId: parsed.data.domainId || null,
        serviceId: parsed.data.serviceId || null,
      },
    });
    res.status(201).json({ task: created });
  } catch (err) {
    next(err);
  }
});

router.patch('/tasks/:id', async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
      title: z.string().trim().min(1).max(255).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid task update' });
      return;
    }
    const updated = await db.task.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ task: updated });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs', async (_req, res, next) => {
  try {
    const rows = await db.jobState.findMany({ orderBy: { jobName: 'asc' } });
    res.json({
      jobs: (rows as any[])
        .filter((j) => !String(j.jobName).startsWith('__'))
        .map((j) => ({
          jobName: j.jobName,
          lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
          lastSuccessAt: j.lastSuccessAt ? new Date(j.lastSuccessAt).toISOString() : null,
          lastStatus: j.lastStatus ?? null,
          lastSummary: j.lastSummary ?? null,
        })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/backup/download', async (req, res, next) => {
  try {
    const now = new Date();
    const payload = await buildSanitizedBackupPayload(db, now);
    const { jsonText, gzBuffer } = compressBackupPayload(payload);
    const ymd = now.toISOString().slice(0, 10);
    const format = String(req.query.format || 'json').toLowerCase();

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'BACKUP_DOWNLOADED',
      entityType: 'Settings',
      summary: `Downloaded sanitized ${format.toUpperCase()} database backup`,
      ipAddress: getClientIp(req),
    });

    if (format === 'gz') {
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="aws-control-center-backup-${ymd}.json.gz"`);
      res.send(gzBuffer);
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aws-control-center-backup-${ymd}.json"`);
    res.send(jsonText);
  } catch (err) {
    next(err);
  }
});

router.post('/backup/send-now', async (req, res, next) => {
  try {
    const summary = await runWeeklyBackupJob(db, new Date(), { force: true });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'BACKUP_EMAILED',
      entityType: 'Settings',
      summary,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

export default router;

