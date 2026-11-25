import { PrismaClient } from '@prisma/client';
import { formatINR } from '../../shared/currency';
import { formatDateDDMMMYYYY, getDaysLeftIST, getIstDateParts } from '../../shared/dates';
import { ensureDefaultRulesAndTemplates, ensureDefaultSettings } from '../lib/demoSeed';
import {
  isWithinSendWindowIST,
  nextAllowedSendTimeIST,
  renderTemplateText,
  sendEmailMessage,
  TemplateVariables,
  whatsappProvider,
} from '../lib/messaging';

function getAppBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function getIstYmd(date: Date, tz = 'Asia/Kolkata'): string {
  const p = getIstDateParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function allowedChannelsForClient(
  preferredChannel: string,
  ruleChannels: string[]
): Array<'EMAIL' | 'WHATSAPP'> {
  const pref = String(preferredChannel || 'BOTH').toUpperCase();
  const out: Array<'EMAIL' | 'WHATSAPP'> = [];
  for (const ch of ruleChannels) {
    const c = String(ch).toUpperCase();
    if (c === 'EMAIL' && (pref === 'EMAIL' || pref === 'BOTH')) out.push('EMAIL');
    if (c === 'WHATSAPP' && (pref === 'WHATSAPP' || pref === 'BOTH')) out.push('WHATSAPP');
  }
  return Array.from(new Set(out));
}

function pickTemplate(
  templates: any[],
  ruleTemplate: any | null,
  itemType: string,
  channel: 'EMAIL' | 'WHATSAPP',
  daysLeft: number
): any | null {
  if (ruleTemplate && ruleTemplate.channel === channel) {
    return ruleTemplate;
  }

  const bySlug = (slug: string) => templates.find((t) => t.slug === slug && t.channel === channel);

  if (itemType === 'DOMAIN') {
    if (channel === 'WHATSAPP') return bySlug('domain-renewal-hi') || bySlug('domain-renewal-en');
    return bySlug('domain-renewal-en');
  }
  if (itemType === 'SERVICE') {
    return bySlug('hosting-renewal-en') || templates.find((t) => t.channel === channel) || null;
  }
  if (itemType === 'INVOICE') {
    if (daysLeft < 0) return bySlug('overdue-notice-en') || bySlug('payment-reminder-en');
    return bySlug('payment-reminder-en');
  }
  if (itemType === 'ESTIMATE') {
    return bySlug('estimate-sent-en');
  }
  return templates.find((t) => t.channel === channel) || null;
}

export async function evaluateAndQueueReminders(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: { forceEval?: boolean } = {}
): Promise<{ evaluated: number; queued: number; skipped: number }> {
  await ensureDefaultSettings(prisma);
  await ensureDefaultRulesAndTemplates(prisma);

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone || 'Asia/Kolkata';
  const evalHour = Number(settings?.reminderEvalHourIst ?? 6);
  const istParts = getIstDateParts(now, tz);

  if (!options.forceEval && istParts.hour < evalHour) {
    return { evaluated: 0, queued: 0, skipped: 0 };
  }

  const rules = await prisma.reminderRule.findMany({
    where: { enabled: true },
    include: { template: true },
  });
  if (rules.length === 0) {
    return { evaluated: 0, queued: 0, skipped: 0 };
  }

  const templates = await prisma.messageTemplate.findMany();
  const baseUrl = getAppBaseUrl();
  const quietStart = settings?.quietHoursStart || '20:00';
  const quietEnd = settings?.quietHoursEnd || '09:00';
  const scheduledAt = nextAllowedSendTimeIST(now, quietStart, quietEnd, tz);
  const businessName = settings?.businessName || 'Aligarh Web Solutions';

  let evaluated = 0;
  let queued = 0;
  let skipped = 0;

  // Preload entities by type only if a rule uses that type
  const neededTypes = new Set(rules.map((r: any) => r.itemType));
  const domains = neededTypes.has('DOMAIN')
    ? await prisma.domain.findMany({ include: { client: true } })
    : [];
  const services = neededTypes.has('SERVICE')
    ? await prisma.service.findMany({ include: { client: true } })
    : [];
  const invoices = neededTypes.has('INVOICE')
    ? await prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'] } },
        include: { client: true },
      })
    : [];
  const estimates = neededTypes.has('ESTIMATE')
    ? await prisma.estimate.findMany({
        where: { status: { in: ['SENT', 'VIEWED'] } },
        include: { client: true },
      })
    : [];

  async function queueForTarget(params: {
    rule: any;
    itemType: string;
    entityId: string;
    targetDate: Date;
    daysLeft: number;
    client: any;
    vars: TemplateVariables;
  }) {
    const { rule, itemType, entityId, targetDate, daysLeft, client, vars } = params;
    const ruleChannels = Array.isArray(rule.channels) ? rule.channels : ['EMAIL'];
    const channels = allowedChannelsForClient(client.preferredChannel, ruleChannels);
    const targetYmd = getIstYmd(targetDate, tz);

    for (const channel of channels) {
      const idempotencyKey = `${itemType}:${entityId}:${targetYmd}:${daysLeft}:${channel}`;
      const existing = await prisma.messageLog.findUnique({ where: { idempotencyKey } });
      if (existing) continue;

      const tpl = pickTemplate(templates, rule.template || null, itemType, channel, daysLeft);
      const fallbackSubject =
        channel === 'EMAIL'
          ? `${businessName} Reminder: ${vars.domain || vars.invoice_no || itemType}`
          : null;
      const fallbackBody =
        `Hello ${client.name},\n\n` +
        `Reminder regarding ${vars.domain || vars.invoice_no || itemType} (date: ${vars.expiry_date}, amount: ${vars.amount}).\n` +
        (vars.pay_link ? `Link: ${vars.pay_link}\n\n` : '\n') +
        `Regards,\n${businessName}`;

      const renderedSubject =
        channel === 'EMAIL'
          ? renderTemplateText(tpl?.subject || fallbackSubject || '', vars)
          : null;
      const renderedContent = renderTemplateText(tpl?.body || fallbackBody, vars);

      const clientEmails = Array.isArray(client.emails) ? client.emails.filter(Boolean) : [];
      const hasContact =
        channel === 'EMAIL' ? clientEmails.length > 0 : Boolean(client.whatsappPhone);

      await prisma.messageLog.create({
        data: {
          clientId: client.id,
          channel,
          templateId: tpl?.id || null,
          renderedSubject,
          renderedContent,
          entityType: itemType,
          entityId,
          offsetDays: daysLeft,
          idempotencyKey,
          scheduledAt,
          status: hasContact ? 'QUEUED' : 'SKIPPED',
          error: hasContact
            ? null
            : channel === 'EMAIL'
              ? 'Client has no email address'
              : 'Client has no WhatsApp number',
          direction: 'OUTBOUND',
        },
      });

      if (hasContact) queued += 1;
      else skipped += 1;
    }
  }

  for (const rule of rules as any[]) {
    const offsets: number[] = Array.isArray(rule.offsets) ? rule.offsets.map(Number) : [];
    if (offsets.length === 0) continue;

    if (rule.itemType === 'DOMAIN') {
      for (const d of domains as any[]) {
        const c = d.client;
        if (!c || c.status !== 'ACTIVE' || !c.remindersEnabled) continue;
        if (d.whoPays === 'ME' || ['TRANSFERRED', 'REDEMPTION'].includes(d.status)) continue;
        evaluated += 1;
        const daysLeft = getDaysLeftIST(d.expiryDate, now, tz);
        if (!offsets.includes(daysLeft)) continue;

        await queueForTarget({
          rule,
          itemType: 'DOMAIN',
          entityId: d.id,
          targetDate: new Date(d.expiryDate),
          daysLeft,
          client: c,
          vars: {
            client_name: c.contactPerson || c.name,
            business_name: businessName,
            domain: d.name,
            service_name: d.name,
            expiry_date: formatDateDDMMMYYYY(d.expiryDate, tz),
            days_left: daysLeft,
            amount: formatINR(Number(d.sellingPrice || 0), { decimals: 0 }),
            pay_link: c.publicStatusToken ? `${baseUrl}/clients/${c.id}` : baseUrl,
          },
        });
      }
    } else if (rule.itemType === 'SERVICE') {
      for (const s of services as any[]) {
        const c = s.client;
        if (!c || c.status !== 'ACTIVE' || !c.remindersEnabled) continue;
        if (['CANCELLED', 'SUSPENDED'].includes(s.status)) continue;
        evaluated += 1;
        const daysLeft = getDaysLeftIST(s.renewalDate, now, tz);
        if (!offsets.includes(daysLeft)) continue;

        await queueForTarget({
          rule,
          itemType: 'SERVICE',
          entityId: s.id,
          targetDate: new Date(s.renewalDate),
          daysLeft,
          client: c,
          vars: {
            client_name: c.contactPerson || c.name,
            business_name: businessName,
            domain: s.planName,
            service_name: s.planName,
            expiry_date: formatDateDDMMMYYYY(s.renewalDate, tz),
            days_left: daysLeft,
            amount: formatINR(Number(s.sellingPrice || 0), { decimals: 0 }),
            pay_link: baseUrl,
          },
        });
      }
    } else if (rule.itemType === 'INVOICE') {
      for (const inv of invoices as any[]) {
        const c = inv.client;
        if (!c || c.status !== 'ACTIVE' || !c.remindersEnabled) continue;
        const balance = Number(inv.total ?? 0) - Number(inv.amountPaid ?? 0);
        if (balance <= 0.01) continue;
        evaluated += 1;
        const daysLeft = getDaysLeftIST(inv.dueDate, now, tz);
        if (!offsets.includes(daysLeft)) continue;

        await queueForTarget({
          rule,
          itemType: 'INVOICE',
          entityId: inv.id,
          targetDate: new Date(inv.dueDate),
          daysLeft,
          client: c,
          vars: {
            client_name: c.contactPerson || c.name,
            business_name: businessName,
            invoice_no: inv.invoiceNumber,
            domain: inv.invoiceNumber,
            expiry_date: formatDateDDMMMYYYY(inv.dueDate, tz),
            days_left: daysLeft,
            amount: formatINR(balance, { decimals: 2 }),
            pay_link: `${baseUrl}/public/invoice/${inv.publicToken}`,
          },
        });
      }
    } else if (rule.itemType === 'ESTIMATE') {
      for (const est of estimates as any[]) {
        const c = est.client;
        if (!c || c.status !== 'ACTIVE' || !c.remindersEnabled) continue;
        evaluated += 1;
        const daysLeft = getDaysLeftIST(est.validUntil, now, tz);
        if (!offsets.includes(daysLeft)) continue;

        await queueForTarget({
          rule,
          itemType: 'ESTIMATE',
          entityId: est.id,
          targetDate: new Date(est.validUntil),
          daysLeft,
          client: c,
          vars: {
            client_name: c.contactPerson || c.name,
            business_name: businessName,
            invoice_no: est.estimateNumber,
            estimate_no: est.estimateNumber,
            domain: est.estimateNumber,
            expiry_date: formatDateDDMMMYYYY(est.validUntil, tz),
            days_left: daysLeft,
            amount: formatINR(Number(est.total || 0), { decimals: 2 }),
            pay_link: `${baseUrl}/public/estimate/${est.publicToken}`,
          },
        });
      }
    }
  }

  return { evaluated, queued, skipped };
}

export async function dispatchMessageLogRow(
  prisma: PrismaClient,
  logRow: any,
  settings: any,
  now: Date = new Date()
): Promise<{ status: 'SENT' | 'FAILED'; error?: string }> {
  const client = logRow.clientId
    ? await prisma.client.findUnique({ where: { id: logRow.clientId } })
    : null;
  const template = logRow.templateId
    ? await prisma.messageTemplate.findUnique({ where: { id: logRow.templateId } })
    : null;

  let result;
  if (logRow.channel === 'EMAIL') {
    const to = Array.isArray(client?.emails) ? client.emails.filter(Boolean) : [];
    const fallbackTo =
      logRow.entityType === 'OWNER_DIGEST' && settings?.ownerAlertEmail
        ? [settings.ownerAlertEmail]
        : to;
    result = await sendEmailMessage({
      to: fallbackTo,
      subject: logRow.renderedSubject || `${settings?.businessName || 'Aligarh Web Solutions'} Notification`,
      text: logRow.renderedContent,
      settings,
    });
  } else {
    const toPhone = client?.whatsappPhone || '';
    const varNames: string[] = Array.isArray(template?.waVariableMapping)
      ? template.waVariableMapping.map((v: any) => String(v || '')).filter(Boolean)
      : [];

    let bodyParams: string[] | undefined;
    if (varNames.length > 0) {
      const tz = settings?.timezone || 'Asia/Kolkata';
      const baseUrl = getAppBaseUrl();
      const businessName = settings?.businessName || 'Aligarh Web Solutions';
      const varMap: Record<string, string> = {
        client_name: client?.contactPerson || client?.name || 'Client',
        business_name: businessName,
        domain: '',
        service_name: '',
        expiry_date: logRow.scheduledAt ? formatDateDDMMMYYYY(logRow.scheduledAt, tz) : '',
        days_left: logRow.offsetDays !== null && logRow.offsetDays !== undefined ? String(logRow.offsetDays) : '0',
        amount: '',
        invoice_no: '',
        estimate_no: '',
        pay_link: baseUrl,
      };
      if (logRow.entityType === 'DOMAIN' && logRow.entityId && typeof (prisma.domain as any)?.findUnique === 'function') {
        const d = await prisma.domain.findUnique({ where: { id: logRow.entityId } }).catch(() => null);
        if (d) {
          varMap.domain = d.name;
          varMap.service_name = d.name;
          varMap.expiry_date = formatDateDDMMMYYYY(d.expiryDate, tz);
          varMap.amount = formatINR(Number(d.sellingPrice || 0), { decimals: 0 });
        }
      } else if (logRow.entityType === 'SERVICE' && logRow.entityId && typeof (prisma.service as any)?.findUnique === 'function') {
        const s = await prisma.service.findUnique({ where: { id: logRow.entityId } }).catch(() => null);
        if (s) {
          varMap.domain = s.planName;
          varMap.service_name = s.planName;
          varMap.expiry_date = formatDateDDMMMYYYY(s.renewalDate, tz);
          varMap.amount = formatINR(Number(s.sellingPrice || 0), { decimals: 0 });
        }
      } else if (logRow.entityType === 'INVOICE' && logRow.entityId && typeof (prisma.invoice as any)?.findUnique === 'function') {
        const inv = await prisma.invoice.findUnique({ where: { id: logRow.entityId } }).catch(() => null);
        if (inv) {
          varMap.invoice_no = inv.invoiceNumber;
          varMap.domain = inv.invoiceNumber;
          varMap.expiry_date = formatDateDDMMMYYYY(inv.dueDate, tz);
          varMap.amount = formatINR(Math.max(0, Number(inv.total || 0) - Number(inv.amountPaid || 0)), { decimals: 2 });
          varMap.pay_link = `${baseUrl}/public/invoice/${inv.publicToken}`;
        }
      } else if (logRow.entityType === 'ESTIMATE' && logRow.entityId && typeof (prisma.estimate as any)?.findUnique === 'function') {
        const est = await prisma.estimate.findUnique({ where: { id: logRow.entityId } }).catch(() => null);
        if (est) {
          varMap.estimate_no = est.estimateNumber;
          varMap.invoice_no = est.estimateNumber;
          varMap.domain = est.estimateNumber;
          varMap.expiry_date = formatDateDDMMMYYYY(est.validUntil, tz);
          varMap.amount = formatINR(Number(est.total || 0), { decimals: 2 });
          varMap.pay_link = `${baseUrl}/public/estimate/${est.publicToken}`;
        }
      }
      bodyParams = varNames.map((k) => varMap[k] || '-');
    }

    result = await whatsappProvider.sendMessage({
      to: toPhone,
      templateName: template?.waTemplateName || null,
      languageCode: template?.waLanguageCode || template?.language || 'en',
      bodyParams,
      renderedText: logRow.renderedContent,
      settings,
    });
  }

  if (result.ok) {
    await prisma.messageLog.update({
      where: { id: logRow.id },
      data: {
        status: 'SENT',
        sentAt: now,
        providerMessageId: result.providerMessageId || null,
        error: null,
        nextRetryAt: null,
      },
    });
    return { status: 'SENT' };
  }

  const nextRetryCount = Number(logRow.retryCount || 0) + 1;
  const backoffMinutes = Math.pow(2, nextRetryCount - 1) * 15; // 15m, 30m, 60m
  const nextRetryAt =
    nextRetryCount < 3 ? new Date(now.getTime() + backoffMinutes * 60_000) : null;

  await prisma.messageLog.update({
    where: { id: logRow.id },
    data: {
      status: 'FAILED',
      retryCount: nextRetryCount,
      nextRetryAt,
      error: (result.error || 'Delivery failed').slice(0, 1000),
    },
  });
  return { status: 'FAILED', error: result.error };
}

export async function dispatchDueMessages(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: { ignoreQuietHours?: boolean } = {}
): Promise<{ sent: number; failed: number; heldForQuietHours: boolean }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone || 'Asia/Kolkata';
  const withinWindow = isWithinSendWindowIST(
    now,
    settings?.quietHoursStart || '20:00',
    settings?.quietHoursEnd || '09:00',
    tz
  );

  if (!options.ignoreQuietHours && !withinWindow) {
    return { sent: 0, failed: 0, heldForQuietHours: true };
  }

  const allDue = await prisma.messageLog.findMany({
    where: {
      status: { in: ['QUEUED', 'FAILED'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  const eligible = allDue.filter((row: any) => {
    if (row.status === 'QUEUED') {
      return !row.scheduledAt || new Date(row.scheduledAt).getTime() <= now.getTime();
    }
    if (row.status === 'FAILED') {
      return (
        Number(row.retryCount || 0) < 3 &&
        row.nextRetryAt &&
        new Date(row.nextRetryAt).getTime() <= now.getTime()
      );
    }
    return false;
  });

  let sent = 0;
  let failed = 0;
  for (const row of eligible.slice(0, 40)) {
    const res = await dispatchMessageLogRow(prisma, row, settings, now);
    if (res.status === 'SENT') sent += 1;
    else failed += 1;
  }

  return { sent, failed, heldForQuietHours: false };
}

export async function runReminderJob(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: { forceEval?: boolean; ignoreQuietHours?: boolean } = {}
): Promise<string> {
  const evalRes = await evaluateAndQueueReminders(prisma, now, { forceEval: options.forceEval });
  const dispRes = await dispatchDueMessages(prisma, now, {
    ignoreQuietHours: options.ignoreQuietHours,
  });

  if (dispRes.heldForQuietHours) {
    return `Evaluated ${evalRes.evaluated}, queued ${evalRes.queued}, skipped ${evalRes.skipped}; dispatch paused during quiet hours`;
  }
  return `Evaluated ${evalRes.evaluated}, queued ${evalRes.queued}, dispatched ${dispRes.sent} sent (${dispRes.failed} failed)`;
}

export async function runOwnerDigestJob(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: { force?: boolean } = {}
): Promise<string> {
  await ensureDefaultSettings(prisma);
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone || 'Asia/Kolkata';
  const istParts = getIstDateParts(now, tz);
  const evalHour = Number(settings?.reminderEvalHourIst ?? 6);

  if (!options.force && istParts.hour < evalHour) {
    return `Waiting for ${String(evalHour).padStart(2, '0')}:00 IST digest window`;
  }

  const todayYmd = getIstYmd(now, tz);
  const idempotencyKey = `DIGEST:${todayYmd}:EMAIL`;
  if (!options.force) {
    const existing = await prisma.messageLog.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return `Daily digest already recorded for ${todayYmd}`;
    }
  }

  const domains = await prisma.domain.findMany({ include: { client: true } });
  const services = await prisma.service.findMany({ include: { client: true } });
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    include: { client: true },
  });

  const criticalDomains = (domains as any[]).filter((d) => {
    if (['TRANSFERRED', 'REDEMPTION'].includes(d.status)) return false;
    return getDaysLeftIST(d.expiryDate, now, tz) <= 7;
  });
  const criticalServices = (services as any[]).filter((s) => {
    if (['CANCELLED', 'SUSPENDED'].includes(s.status)) return false;
    return getDaysLeftIST(s.renewalDate, now, tz) <= 7;
  });
  const overdueInvoices = (invoices as any[]).filter((inv) => {
    const bal = Number(inv.total ?? 0) - Number(inv.amountPaid ?? 0);
    return bal > 0.01 && getDaysLeftIST(inv.dueDate, now, tz) < 0;
  });

  const lines: string[] = [
    `Daily Summary — ${formatDateDDMMMYYYY(now, tz)} (${settings?.businessName || 'Aligarh Web Solutions'})`,
    '',
    `Critical Domains (expiring <= 7 days or expired): ${criticalDomains.length}`,
    ...criticalDomains.slice(0, 15).map(
      (d) =>
        `  - ${d.name} (${d.client?.name || 'Unknown'}) · ${formatDateDDMMMYYYY(d.expiryDate, tz)} (${getDaysLeftIST(d.expiryDate, now, tz)}d)`
    ),
    '',
    `Critical Services (renewing <= 7 days or expired): ${criticalServices.length}`,
    ...criticalServices.slice(0, 15).map(
      (s) =>
        `  - ${s.planName} (${s.client?.name || 'Unknown'}) · ${formatDateDDMMMYYYY(s.renewalDate, tz)} (${getDaysLeftIST(s.renewalDate, now, tz)}d)`
    ),
    '',
    `Overdue Invoices: ${overdueInvoices.length}`,
    ...overdueInvoices.slice(0, 15).map(
      (inv) =>
        `  - ${inv.invoiceNumber} (${inv.client?.name || 'Unknown'}) · Balance ${formatINR(Number(inv.total) - Number(inv.amountPaid || 0), { decimals: 2 })}`
    ),
  ];

  const digestBody = lines.join('\n');
  const recipient = settings?.ownerAlertEmail?.trim() || null;

  if (!recipient) {
    if (!options.force) {
      await prisma.messageLog.create({
        data: {
          channel: 'EMAIL',
          renderedSubject: `Daily Digest — ${formatDateDDMMMYYYY(now, tz)}`,
          renderedContent: digestBody,
          entityType: 'OWNER_DIGEST',
          idempotencyKey,
          status: 'SKIPPED',
          error: 'Owner alert email is not configured in Settings',
          direction: 'OUTBOUND',
        },
      });
    }
    return `Digest skipped: ownerAlertEmail not configured (${criticalDomains.length} domains, ${overdueInvoices.length} overdue invoices)`;
  }

  const sendRes = await sendEmailMessage({
    to: recipient,
    subject: `[AWS Control Center] Daily Digest — ${criticalDomains.length + criticalServices.length} critical renewals, ${overdueInvoices.length} overdue`,
    text: digestBody,
    settings,
  });

  const logKey = options.force ? `${idempotencyKey}:${Date.now()}` : idempotencyKey;
  await prisma.messageLog.create({
    data: {
      channel: 'EMAIL',
      renderedSubject: `Daily Digest — ${formatDateDDMMMYYYY(now, tz)}`,
      renderedContent: digestBody,
      entityType: 'OWNER_DIGEST',
      idempotencyKey: logKey,
      sentAt: sendRes.ok ? now : null,
      status: sendRes.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendRes.providerMessageId || null,
      error: sendRes.error || null,
      direction: 'OUTBOUND',
    },
  });

  return sendRes.ok
    ? `Sent daily digest to ${recipient} (${criticalDomains.length} domains, ${criticalServices.length} services, ${overdueInvoices.length} overdue)`
    : `Digest delivery failed: ${sendRes.error}`;
}
