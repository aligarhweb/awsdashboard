import { PrismaClient } from '@prisma/client';
import { getIndianFinancialYear } from '../../shared/billing';
import { formatINR } from '../../shared/currency';
import { formatDateDDMMMYYYY, getDaysLeftIST, getIstDateParts } from '../../shared/dates';
import { addBillingCycleDate, serializeInvoice } from '../lib/billingHelpers';
import { buildSanitizedBackupPayload, compressBackupPayload } from '../lib/backup';
import { generateRandomToken } from '../lib/crypto';
import { ensureDefaultSettings } from '../lib/demoSeed';
import { renderTemplateText, sendEmailMessage } from '../lib/messaging';
import { generateInvoicePdfBuffer } from '../lib/pdfGenerator';
import { lookupDomainRdap, RdapLookupResult } from '../lib/rdap';

function getIstYmd(date: Date, tz = 'Asia/Kolkata'): string {
  const p = getIstDateParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function nextInvoiceSequenceOn(
  prisma: PrismaClient,
  prefixWithDash: string
): Promise<string> {
  const rows = await prisma.invoice.findMany({
    where: {
      invoiceNumber: { contains: prefixWithDash },
    },
  });
  let maxSeq = 0;
  for (const r of rows as any[]) {
    const val = String(r.invoiceNumber || '');
    if (!val.startsWith(prefixWithDash)) continue;
    const tail = val.slice(prefixWithDash.length);
    const num = Number.parseInt(tail, 10);
    if (Number.isFinite(num) && num > maxSeq) {
      maxSeq = num;
    }
  }
  return `${prefixWithDash}${String(maxSeq + 1).padStart(4, '0')}`;
}

export async function verifySingleDomainRdap(
  prisma: PrismaClient,
  domain: any,
  now: Date = new Date(),
  options: {
    lookupFn?: (domainName: string) => Promise<RdapLookupResult>;
    settings?: any;
  } = {}
) {
  const settings = options.settings ?? (await prisma.settings.findUnique({ where: { id: 1 } }));
  const lookupFn = options.lookupFn || ((name: string) => lookupDomainRdap(name));
  const rdap = await lookupFn(domain.name);

  if (!rdap.supported) {
    const updated = await prisma.domain.update({
      where: { id: domain.id },
      data: {
        lastRdapVerifiedAt: now,
        rdapUnsupported: true,
        rdapMismatch: false,
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        providerAccount: { select: { id: true, name: true, providerKey: true } },
      },
    });
    return { domain: updated, rdap, mismatchDetected: false };
  }

  let mismatch = false;
  if (rdap.expiryDate) {
    const diffDays = Math.abs(getDaysLeftIST(rdap.expiryDate, new Date(domain.expiryDate)));
    mismatch = diffDays > 1;
  }

  const updated = await prisma.domain.update({
    where: { id: domain.id },
    data: {
      lastRdapVerifiedAt: now,
      rdapUnsupported: false,
      ...(rdap.expiryDate ? { rdapExpiryDate: rdap.expiryDate } : {}),
      rdapMismatch: mismatch,
    },
    include: {
      client: { select: { id: true, name: true, company: true } },
      providerAccount: { select: { id: true, name: true, providerKey: true } },
    },
  });

  if (mismatch && rdap.expiryDate && settings?.ownerAlertEmail) {
    const tz = settings.timezone || 'Asia/Kolkata';
    const rdapYmd = getIstYmd(rdap.expiryDate, tz);
    const key = `RDAP_MISMATCH:${domain.id}:${rdapYmd}:EMAIL`;
    const existing = await prisma.messageLog.findUnique({ where: { idempotencyKey: key } });
    if (!existing) {
      const subject = `[RDAP Mismatch] ${domain.name} registry expiry differs`;
      const body =
        `RDAP verification detected an expiry mismatch for ${domain.name}.\n\n` +
        `Tracked Expiry: ${formatDateDDMMMYYYY(domain.expiryDate, tz)}\n` +
        `Registry RDAP Expiry: ${formatDateDDMMMYYYY(rdap.expiryDate, tz)}\n\n` +
        `Please review this domain in AWS Control Center.`;

      const sendRes = await sendEmailMessage({
        to: settings.ownerAlertEmail,
        subject,
        text: body,
        settings,
      });

      await prisma.messageLog.create({
        data: {
          clientId: domain.clientId,
          channel: 'EMAIL',
          renderedSubject: subject,
          renderedContent: body,
          entityType: 'DOMAIN_RDAP',
          entityId: domain.id,
          idempotencyKey: key,
          sentAt: sendRes.ok ? now : null,
          status: sendRes.ok ? 'SENT' : 'FAILED',
          providerMessageId: sendRes.providerMessageId || null,
          error: sendRes.error || null,
          direction: 'OUTBOUND',
        },
      });
    }
  }

  return { domain: updated, rdap, mismatchDetected: mismatch };
}

export async function runRdapVerificationJob(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: {
    forceAll?: boolean;
    batchLimit?: number;
    lookupFn?: (domainName: string) => Promise<RdapLookupResult>;
  } = {}
): Promise<string> {
  await ensureDefaultSettings(prisma);
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const allDomains = await prisma.domain.findMany({
    orderBy: { expiryDate: 'asc' },
  });

  const oneDayMs = 24 * 60 * 60 * 1000;
  const due = (allDomains as any[]).filter((d) => {
    if (d.status === 'TRANSFERRED') return false;
    if (options.forceAll) return true;
    if (!d.lastRdapVerifiedAt) return true;
    return now.getTime() - new Date(d.lastRdapVerifiedAt).getTime() >= oneDayMs;
  });

  const limit = options.batchLimit ?? (options.forceAll ? due.length : 25);
  const targets = due.slice(0, Math.max(0, limit));
  if (targets.length === 0) {
    return `0 of ${allDomains.length} domains due for RDAP verification`;
  }

  let verified = 0;
  let mismatches = 0;
  let unsupported = 0;

  for (const d of targets) {
    const res = await verifySingleDomainRdap(prisma, d, now, {
      lookupFn: options.lookupFn,
      settings,
    });
    if (!res.rdap.supported) unsupported += 1;
    else {
      verified += 1;
      if (res.mismatchDetected) mismatches += 1;
    }
  }

  return `RDAP checked ${targets.length} domains (${verified} verified, ${mismatches} mismatches, ${unsupported} unsupported)`;
}

export async function runRecurringInvoicesJob(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: {
    generatePdfFn?: (inv: any, settings: any) => Promise<Buffer>;
  } = {}
): Promise<string> {
  await ensureDefaultSettings(prisma);
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone || 'Asia/Kolkata';
  const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const pdfGenerator = options.generatePdfFn || generateInvoicePdfBuffer;

  const recurringParents = await prisma.invoice.findMany({
    where: { recurring: true },
    include: {
      client: true,
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });

  const dueParents = (recurringParents as any[]).filter((inv) => {
    if (inv.status === 'CANCELLED') return false;
    if (!inv.recurringCycle || !inv.nextRecurringAt) return false;
    return new Date(inv.nextRecurringAt).getTime() <= now.getTime();
  });

  if (dueParents.length === 0) {
    return `0 recurring invoices due`;
  }

  let createdCount = 0;
  let autoSentCount = 0;

  for (const parent of dueParents) {
    const dueAt = new Date(parent.nextRecurringAt);
    const nextDueAt = addBillingCycleDate(dueAt, parent.recurringCycle);
    const issueDate = now;
    const dueDate = new Date(now.getTime() + 7 * 86_400_000);
    const fy = getIndianFinancialYear(issueDate);
    const prefix = (settings?.invoicePrefix || 'INV').trim() || 'INV';
    const invoiceNumber = await nextInvoiceSequenceOn(prisma, `${prefix}-${fy}-`);

    const child = await prisma.invoice.create({
      data: {
        invoiceNumber,
        financialYear: fy,
        clientId: parent.clientId,
        referenceNumber: parent.referenceNumber || parent.invoiceNumber,
        projectName: parent.projectName || null,
        placeOfSupply: parent.placeOfSupply || null,
        issueDate,
        dueDate,
        gstMode: parent.gstMode,
        subtotal: Number(parent.subtotal),
        discountTotal: Number(parent.discountTotal),
        cgstTotal: Number(parent.cgstTotal),
        sgstTotal: Number(parent.sgstTotal),
        igstTotal: Number(parent.igstTotal),
        taxTotal: Number(parent.taxTotal),
        roundOff: Number(parent.roundOff),
        adjustmentLabel: parent.adjustmentLabel || null,
        total: Number(parent.total),
        amountPaid: 0,
        status: 'DRAFT',
        notes: parent.notes || null,
        terms: parent.terms || settings?.defaultInvoiceTerms || null,
        publicToken: generateRandomToken(20),
        recurring: false,
        recurringCycle: null,
        nextRecurringAt: null,
        items: {
          create: (parent.items || []).map((it: any, idx: number) => ({
            itemName: it.itemName || null,
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: Number(it.qty),
            rate: Number(it.rate),
            discount: Number(it.discount),
            taxPercent: Number(it.taxPercent),
            lineTotal: Number(it.lineTotal),
            domainId: it.domainId || null,
            serviceId: it.serviceId || null,
            sortOrder: idx,
          })),
        },
      },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });

    await prisma.invoice.update({
      where: { id: parent.id },
      data: { nextRecurringAt: nextDueAt },
    });

    createdCount += 1;

    if (settings?.recurringAutoSend && child.client) {
      const emails = Array.isArray(child.client.emails)
        ? child.client.emails.map((e: any) => String(e || '').trim()).filter(Boolean)
        : [];
      if (emails.length > 0) {
        const tpl = await prisma.messageTemplate.findUnique({
          where: { slug: 'invoice-sent-en' },
        });
        const vars = {
          client_name: child.client.contactPerson || child.client.name,
          business_name: settings.businessName || 'Aligarh Web Solutions',
          invoice_no: child.invoiceNumber,
          expiry_date: formatDateDDMMMYYYY(child.dueDate, tz),
          amount: formatINR(Number(child.total), { decimals: 2 }),
          pay_link: `${baseUrl}/public/invoice/${child.publicToken}`,
        };
        const subject = renderTemplateText(
          tpl?.subject || `Invoice ${child.invoiceNumber} from ${vars.business_name}`,
          vars
        );
        const body = renderTemplateText(
          tpl?.body ||
            `Hello ${vars.client_name},\n\nPlease find attached Invoice ${vars.invoice_no} for ${vars.amount}.\nPay Online: ${vars.pay_link}\n\nRegards,\n${vars.business_name}`,
          vars
        );

        const pdfBuf = await pdfGenerator(serializeInvoice(child), settings);
        const sendRes = await sendEmailMessage({
          to: emails,
          subject,
          text: body,
          attachments: [
            {
              filename: `${child.invoiceNumber}.pdf`,
              content: pdfBuf,
              contentType: 'application/pdf',
            },
          ],
          settings,
        });

        await prisma.messageLog.create({
          data: {
            clientId: child.clientId,
            channel: 'EMAIL',
            templateId: tpl?.id || null,
            renderedSubject: subject,
            renderedContent: body,
            entityType: 'INVOICE_RECURRING',
            entityId: child.id,
            idempotencyKey: `RECURRING_SEND:${child.id}:EMAIL`,
            sentAt: sendRes.ok ? now : null,
            status: sendRes.ok ? 'SENT' : 'FAILED',
            providerMessageId: sendRes.providerMessageId || null,
            error: sendRes.error || null,
            direction: 'OUTBOUND',
          },
        });

        if (sendRes.ok) {
          await prisma.invoice.update({
            where: { id: child.id },
            data: { status: 'SENT' },
          });
          autoSentCount += 1;
        }
      }
    }
  }

  return `Generated ${createdCount} recurring invoice(s) (${autoSentCount} auto-sent)`;
}

export async function runWeeklyBackupJob(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: { force?: boolean } = {}
): Promise<string> {
  await ensureDefaultSettings(prisma);
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone || 'Asia/Kolkata';
  const weekKey = getIsoWeekKey(now);
  const idempotencyKey = `BACKUP:${weekKey}:EMAIL`;

  if (!options.force) {
    const existing = await prisma.messageLog.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return `Weekly backup already recorded for ${weekKey}`;
    }
  }

  const recipient = settings?.ownerAlertEmail?.trim() || null;
  if (!recipient) {
    return `Weekly backup skipped: ownerAlertEmail is not configured`;
  }

  const payload = await buildSanitizedBackupPayload(prisma, now);
  const { gzBuffer } = compressBackupPayload(payload);
  const ymd = getIstYmd(now, tz);
  const filename = `aws-control-center-backup-${ymd}.json.gz`;

  const subject = `[AWS Control Center] Weekly Database Backup — ${ymd}`;
  const body =
    `Attached is the weekly compressed JSON backup for ${payload.meta.business} (${ymd}).\n\n` +
    `Included records:\n` +
    `- Clients: ${payload.meta.counts.clients}\n` +
    `- Domains: ${payload.meta.counts.domains}\n` +
    `- Services: ${payload.meta.counts.services}\n` +
    `- Websites: ${payload.meta.counts.websites}\n` +
    `- Estimates: ${payload.meta.counts.estimates}\n` +
    `- Invoices: ${payload.meta.counts.invoices}\n` +
    `- Payments: ${payload.meta.counts.payments}\n` +
    `- Expenses: ${payload.meta.counts.expenses}\n\n` +
    `Note: Encrypted API keys, SMTP/WhatsApp secrets, passwords, and session tokens are automatically redacted.`;

  const sendRes = await sendEmailMessage({
    to: recipient,
    subject,
    text: body,
    attachments: [
      {
        filename,
        content: gzBuffer,
        contentType: 'application/gzip',
      },
    ],
    settings,
  });

  const logKey = options.force ? `${idempotencyKey}:${Date.now()}` : idempotencyKey;
  await prisma.messageLog.create({
    data: {
      channel: 'EMAIL',
      renderedSubject: subject,
      renderedContent: body,
      entityType: 'WEEKLY_BACKUP',
      idempotencyKey: logKey,
      sentAt: sendRes.ok ? now : null,
      status: sendRes.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendRes.providerMessageId || null,
      error: sendRes.error || null,
      direction: 'OUTBOUND',
    },
  });

  return sendRes.ok
    ? `Emailed weekly backup ${filename} (${Math.round(gzBuffer.length / 1024)} KB) to ${recipient}`
    : `Weekly backup email failed: ${sendRes.error}`;
}
