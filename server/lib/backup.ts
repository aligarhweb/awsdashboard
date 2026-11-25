import zlib from 'node:zlib';
import { PrismaClient } from '@prisma/client';

function redactSecretField(val: any): string | null {
  return val ? '[REDACTED]' : null;
}

export async function buildSanitizedBackupPayload(
  prisma: PrismaClient,
  now: Date = new Date()
) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const [
    settings,
    clients,
    providerAccounts,
    domains,
    services,
    serviceDomains,
    websites,
    uptimeChecks,
    incidents,
    catalogItems,
    estimates,
    estimateItems,
    invoices,
    invoiceItems,
    payments,
    creditNotes,
    expenses,
    reminderRules,
    messageTemplates,
    messageLogs,
    tasks,
  ] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }),
    prisma.client.findMany(),
    prisma.providerAccount.findMany(),
    prisma.domain.findMany(),
    prisma.service.findMany(),
    prisma.serviceDomain.findMany(),
    prisma.website.findMany(),
    prisma.uptimeCheck.findMany({ where: { checkedAt: { gte: thirtyDaysAgo } } }),
    prisma.incident.findMany(),
    prisma.catalogItem.findMany(),
    prisma.estimate.findMany(),
    prisma.estimateItem.findMany(),
    prisma.invoice.findMany(),
    prisma.invoiceItem.findMany(),
    prisma.payment.findMany(),
    prisma.creditNote.findMany(),
    prisma.expense.findMany(),
    prisma.reminderRule.findMany(),
    prisma.messageTemplate.findMany(),
    prisma.messageLog.findMany({ where: { createdAt: { gte: ninetyDaysAgo } } }),
    prisma.task.findMany(),
  ]);

  const safeSettings = settings
    ? {
        ...settings,
        smtpPassEncrypted: redactSecretField((settings as any).smtpPassEncrypted),
        emailApiKeyEncrypted: redactSecretField((settings as any).emailApiKeyEncrypted),
        whatsappAccessTokenEnc: redactSecretField((settings as any).whatsappAccessTokenEnc),
        whatsappVerifyTokenEnc: redactSecretField((settings as any).whatsappVerifyTokenEnc),
        whatsappAppSecretEnc: redactSecretField((settings as any).whatsappAppSecretEnc),
        razorpayKeySecretEnc: redactSecretField((settings as any).razorpayKeySecretEnc),
      }
    : null;

  const safeProviders = (providerAccounts as any[]).map((p) => ({
    ...p,
    apiCredentialsEncrypted: redactSecretField(p.apiCredentialsEncrypted),
  }));

  const data = {
    settings: safeSettings,
    clients,
    providerAccounts: safeProviders,
    domains,
    services,
    serviceDomains,
    websites,
    uptimeChecks,
    incidents,
    catalogItems,
    estimates,
    estimateItems,
    invoices,
    invoiceItems,
    payments,
    creditNotes,
    expenses,
    reminderRules,
    messageTemplates,
    messageLogs,
    tasks,
  };

  return {
    meta: {
      app: 'AWS Control Center',
      business: safeSettings?.businessName || 'Aligarh Web Solutions',
      version: '1.0',
      exportedAt: now.toISOString(),
      redactedSecrets: true,
      counts: {
        clients: clients.length,
        domains: domains.length,
        services: services.length,
        websites: websites.length,
        estimates: estimates.length,
        invoices: invoices.length,
        payments: payments.length,
        expenses: expenses.length,
      },
    },
    data,
  };
}

export function compressBackupPayload(payload: any): {
  jsonText: string;
  gzBuffer: Buffer;
} {
  const jsonText = JSON.stringify(payload, null, 2);
  const gzBuffer = zlib.gzipSync(Buffer.from(jsonText, 'utf8'));
  return { jsonText, gzBuffer };
}
