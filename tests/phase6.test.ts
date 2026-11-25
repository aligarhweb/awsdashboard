import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  extractDomainTld,
  lookupDomainRdap,
  parseRdapBootstrapServices,
  parseRdapPayload,
} from '../server/lib/rdap';
import {
  buildSanitizedBackupPayload,
  compressBackupPayload,
} from '../server/lib/backup';
import {
  runRdapVerificationJob,
  runRecurringInvoicesJob,
  runWeeklyBackupJob,
} from '../server/jobs/phase6Jobs';

function createPhase6MockDb(initial?: {
  settings?: any;
  clients?: any[];
  providers?: any[];
  domains?: any[];
  invoices?: any[];
  invoiceItems?: any[];
  services?: any[];
  websites?: any[];
}) {
  let seq = 1;
  const state = {
    settings: initial?.settings || {
      id: 1,
      businessName: 'Aligarh Web Solutions',
      businessState: 'Uttar Pradesh',
      timezone: 'Asia/Kolkata',
      dryRunMode: true,
      ownerAlertEmail: 'owner@aligarhwebsolutions.com',
      smtpFromEmail: 'billing@aligarhwebsolutions.com',
      emailProvider: 'SMTP',
      smtpPassEncrypted: 'enc_smtp_secret_123',
      emailApiKeyEncrypted: 'enc_email_api_key',
      whatsappAccessTokenEnc: 'enc_wa_token',
      whatsappVerifyTokenEnc: 'enc_wa_verify',
      whatsappAppSecretEnc: 'enc_wa_secret',
      razorpayKeySecretEnc: 'enc_rzp_secret',
      invoicePrefix: 'AWS',
      defaultInvoiceTerms: 'Pay within 7 days.',
      recurringAutoSend: false,
    },
    clients: (initial?.clients || []).map((c) => ({ ...c })),
    providerAccounts: (initial?.providers || []).map((p) => ({ ...p })),
    domains: (initial?.domains || []).map((d) => ({ ...d })),
    services: (initial?.services || []).map((s) => ({ ...s })),
    serviceDomains: [] as any[],
    websites: (initial?.websites || []).map((w) => ({ ...w })),
    uptimeChecks: [] as any[],
    incidents: [] as any[],
    catalogItems: [] as any[],
    estimates: [] as any[],
    estimateItems: [] as any[],
    invoices: (initial?.invoices || []).map((inv) => ({ ...inv })),
    invoiceItems: (initial?.invoiceItems || []).map((it) => ({ ...it })),
    payments: [] as any[],
    creditNotes: [] as any[],
    expenses: [] as any[],
    reminderRules: [] as any[],
    messageTemplates: [] as any[],
    messageLogs: [] as any[],
    tasks: [] as any[],
  };

  return {
    _state: state,
    settings: {
      findUnique: async () => state.settings,
      create: async ({ data }: any) => {
        state.settings = { id: 1, ...data };
        return state.settings;
      },
    },
    client: {
      findMany: async () => state.clients,
    },
    providerAccount: {
      findMany: async () => state.providerAccounts,
    },
    domain: {
      findMany: async () => state.domains,
      update: async ({ where, data }: any) => {
        const idx = state.domains.findIndex((d) => d.id === where.id);
        if (idx === -1) throw new Error('Domain not found');
        state.domains[idx] = { ...state.domains[idx], ...data };
        return state.domains[idx];
      },
    },
    service: {
      findMany: async () => state.services,
    },
    serviceDomain: {
      findMany: async () => state.serviceDomains,
    },
    website: {
      findMany: async () => state.websites,
    },
    uptimeCheck: {
      findMany: async () => state.uptimeChecks,
    },
    incident: {
      findMany: async () => state.incidents,
    },
    catalogItem: {
      findMany: async () => state.catalogItems,
    },
    estimate: {
      findMany: async () => state.estimates,
    },
    estimateItem: {
      findMany: async () => state.estimateItems,
    },
    invoice: {
      findMany: async ({ where }: any = {}) =>
        state.invoices
          .filter((inv) => {
            if (where?.recurring !== undefined && inv.recurring !== where.recurring) return false;
            if (where?.invoiceNumber?.contains && !String(inv.invoiceNumber).includes(where.invoiceNumber.contains)) {
              return false;
            }
            return true;
          })
          .map((inv) => ({
            ...inv,
            client: state.clients.find((c) => c.id === inv.clientId) || null,
            items: state.invoiceItems
              .filter((it) => it.invoiceId === inv.id)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
          })),
      create: async ({ data }: any) => {
        const { items, ...invFields } = data;
        const inv = {
          id: `inv_${seq++}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...invFields,
        };
        state.invoices.push(inv);
        const createdItems = (items?.create || []).map((it: any) => {
          const row = { id: `inv_it_${seq++}`, invoiceId: inv.id, ...it };
          state.invoiceItems.push(row);
          return row;
        });
        return {
          ...inv,
          client: state.clients.find((c) => c.id === inv.clientId) || null,
          items: createdItems,
        };
      },
      update: async ({ where, data }: any) => {
        const idx = state.invoices.findIndex((i) => i.id === where.id);
        if (idx === -1) throw new Error('Invoice not found');
        state.invoices[idx] = { ...state.invoices[idx], ...data };
        return state.invoices[idx];
      },
    },
    invoiceItem: {
      findMany: async () => state.invoiceItems,
    },
    payment: {
      findMany: async () => state.payments,
    },
    creditNote: {
      findMany: async () => state.creditNotes,
    },
    expense: {
      findMany: async () => state.expenses,
    },
    reminderRule: {
      findMany: async () => state.reminderRules,
    },
    messageTemplate: {
      findMany: async () => state.messageTemplates,
      findUnique: async ({ where }: any) =>
        state.messageTemplates.find((t) => t.slug === where?.slug) || null,
    },
    messageLog: {
      findMany: async () => state.messageLogs,
      findUnique: async ({ where }: any) =>
        state.messageLogs.find((m) => m.idempotencyKey === where?.idempotencyKey) || null,
      create: async ({ data }: any) => {
        const row = { id: `mlog_${seq++}`, createdAt: new Date(), ...data };
        state.messageLogs.push(row);
        return row;
      },
    },
    task: {
      findMany: async () => state.tasks,
    },
  } as any;
}

describe('Phase 6 RDAP Verification, Recurring Invoices & Sanitized Backups', () => {
  it('parses IANA RDAP bootstrap/payloads, blocks unsafe URLs/redirects, and alerts once on >1d expiry mismatch', async () => {
    expect(extractDomainTld('AligarhBrass.IN.')).toBe('in');
    expect(extractDomainTld('localhost.local')).toBeNull();
    expect(extractDomainTld('bad domain')).toBeNull();

    const tldMap = parseRdapBootstrapServices([
      [['com', 'net'], ['http://insecure.example/', 'https://rdap.verisign.com/com/v1/']],
      [['in'], ['https://rdap.registry.in/rdap']],
    ]);
    expect(tldMap.get('com')).toBe('https://rdap.verisign.com/com/v1/');
    expect(tldMap.get('in')).toBe('https://rdap.registry.in/rdap/');

    const parsed = parseRdapPayload({
      events: [
        { eventAction: 'registration', eventDate: '2024-04-01T00:00:00Z' },
        { eventAction: 'expiration', eventDate: '2027-04-01T00:00:00Z' },
      ],
      nameservers: [{ ldhName: 'NS1.HOSTINGER.COM' }, { ldhName: 'ns2.hostinger.com' }],
    });
    expect(parsed.expiryDate?.toISOString()).toBe('2027-04-01T00:00:00.000Z');
    expect(parsed.nameservers).toEqual(['ns1.hostinger.com', 'ns2.hostinger.com']);

    // Unsupported ccTLD response (404 from RDAP server) -> marks supported: false cleanly
    const unsupported = await lookupDomainRdap('example.pk', {
      rdapBaseUrlOverride: 'https://rdap.registry.example/',
      skipSsrfCheck: true,
      fetchFn: (async () => new Response('Not found', { status: 404 })) as any,
    });
    expect(unsupported.supported).toBe(false);

    // SSRF guard blocks RDAP redirect to private/loopback IP
    const ssrfBlocked = await lookupDomainRdap('example.com', {
      rdapBaseUrlOverride: 'https://127.0.0.1:8080/rdap/',
      fetchFn: (async () => new Response('{}', { status: 200 })) as any,
    });
    expect(ssrfBlocked.expiryDate).toBeNull();
    expect(ssrfBlocked.error).toMatch(/not permitted|restricted/i);

    const db = createPhase6MockDb({
      domains: [
        {
          id: 'dom_mismatch',
          name: 'aligarhbrass.com',
          clientId: 'c_1',
          expiryDate: new Date('2027-04-01T00:00:00Z'),
          status: 'ACTIVE',
          lastRdapVerifiedAt: null,
          rdapMismatch: false,
          rdapUnsupported: false,
        },
        {
          id: 'dom_niche',
          name: 'client-niche.pk',
          clientId: 'c_1',
          expiryDate: new Date('2027-05-01T00:00:00Z'),
          status: 'ACTIVE',
          lastRdapVerifiedAt: null,
          rdapMismatch: false,
          rdapUnsupported: false,
        },
      ],
    });

    const now = new Date('2026-08-10T09:00:00Z');
    const summary1 = await runRdapVerificationJob(db, now, {
      lookupFn: async (name) => {
        if (name === 'aligarhbrass.com') {
          return {
            supported: true,
            expiryDate: new Date('2027-04-15T00:00:00Z'), // 14 days different -> mismatch!
            nameservers: ['ns1.dns-parking.com'],
            rdapUrl: 'https://rdap.verisign.com/com/v1/domain/aligarhbrass.com',
          };
        }
        return {
          supported: false,
          expiryDate: null,
          nameservers: [],
          rdapUrl: null,
          error: 'No RDAP server published for .pk',
        };
      },
    });

    expect(summary1).toContain('RDAP checked 2 domains (1 verified, 1 mismatches, 1 unsupported)');
    expect(db._state.domains[0].rdapMismatch).toBe(true);
    expect(db._state.domains[0].rdapExpiryDate.toISOString()).toBe('2027-04-15T00:00:00.000Z');
    expect(db._state.domains[1].rdapUnsupported).toBe(true);
    expect(db._state.domains[1].rdapMismatch).toBe(false);
    expect(db._state.messageLogs.filter((m: any) => m.entityType === 'DOMAIN_RDAP').length).toBe(1);

    // Forced re-check with same mismatch date must not duplicate owner email alert
    await runRdapVerificationJob(db, new Date('2026-08-11T09:00:00Z'), {
      forceAll: true,
      lookupFn: async (name) => {
        if (name === 'aligarhbrass.com') {
          return {
            supported: true,
            expiryDate: new Date('2027-04-15T00:00:00Z'),
            nameservers: [],
            rdapUrl: 'https://rdap.verisign.com/com/v1/domain/aligarhbrass.com',
          };
        }
        return {
          supported: false,
          expiryDate: null,
          nameservers: [],
          rdapUrl: null,
          error: 'No RDAP server published for .pk',
        };
      },
    });
    expect(db._state.messageLogs.filter((m: any) => m.entityType === 'DOMAIN_RDAP').length).toBe(1);
  });

  it('generates sequential FY recurring child invoices, advances parent schedule, and respects recurringAutoSend', async () => {
    const now = new Date('2026-09-01T08:00:00Z'); // FY 2026-27
    const dueParentAt = new Date('2026-09-01T00:00:00Z');

    const baseClient = {
      id: 'c_1',
      name: 'Zafar Locks Pvt Ltd',
      contactPerson: 'Zafar Khan',
      emails: ['accounts@zafarlocks.example.com'],
      whatsappPhone: '+919837000111',
      preferredChannel: 'BOTH',
    };

    const parentTemplate = {
      id: 'inv_parent',
      invoiceNumber: 'AWS-26-27-0004',
      financialYear: '26-27',
      clientId: 'c_1',
      referenceNumber: 'AMC-2026',
      projectName: 'Corporate Website AMC',
      placeOfSupply: 'Uttar Pradesh',
      issueDate: new Date('2026-08-01T00:00:00Z'),
      dueDate: new Date('2026-08-08T00:00:00Z'),
      gstMode: 'INTRA',
      subtotal: 5000,
      discountTotal: 0,
      cgstTotal: 450,
      sgstTotal: 450,
      igstTotal: 0,
      taxTotal: 900,
      roundOff: 0,
      adjustmentLabel: null,
      total: 5900,
      amountPaid: 5900,
      status: 'PAID',
      notes: 'Monthly retainer',
      terms: 'Pay within 7 days',
      publicToken: 'parent-token-1',
      recurring: true,
      recurringCycle: 'MONTHLY',
      nextRecurringAt: dueParentAt,
    };

    const parentItems = [
      {
        id: 'item_1',
        invoiceId: 'inv_parent',
        itemName: 'Website Maintenance',
        description: 'Monthly WordPress & VPS care',
        hsnSac: '998314',
        qty: 1,
        rate: 5000,
        discount: 0,
        taxPercent: 18,
        lineTotal: 5900,
        domainId: null,
        serviceId: null,
        sortOrder: 0,
      },
    ];

    // Mode 1: recurringAutoSend = false -> child stays DRAFT
    const dbDraft = createPhase6MockDb({
      clients: [baseClient],
      invoices: [parentTemplate],
      invoiceItems: parentItems,
    });
    const res1 = await runRecurringInvoicesJob(dbDraft, now, {
      generatePdfFn: async () => Buffer.from('%PDF-1.4-mock'),
    });
    expect(res1).toBe('Generated 1 recurring invoice(s) (0 auto-sent)');
    expect(dbDraft._state.invoices.length).toBe(2);
    const child1 = dbDraft._state.invoices[1];
    expect(child1.invoiceNumber).toBe('AWS-26-27-0005');
    expect(child1.status).toBe('DRAFT');
    expect(child1.recurring).toBe(false);
    expect(Number(child1.total)).toBe(5900);
    expect(dbDraft._state.invoiceItems.filter((it: any) => it.invoiceId === child1.id).length).toBe(1);
    expect(new Date(dbDraft._state.invoices[0].nextRecurringAt).toISOString().slice(0, 10)).toBe('2026-10-01');

    // Re-running same day produces 0 because nextRecurringAt moved to Oct 1
    const resAgain = await runRecurringInvoicesJob(dbDraft, now, {
      generatePdfFn: async () => Buffer.from('%PDF-1.4-mock'),
    });
    expect(resAgain).toBe('0 recurring invoices due');

    // Mode 2: recurringAutoSend = true -> emails PDF and marks child SENT
    const dbAuto = createPhase6MockDb({
      settings: {
        id: 1,
        businessName: 'Aligarh Web Solutions',
        timezone: 'Asia/Kolkata',
        dryRunMode: true,
        ownerAlertEmail: 'owner@aligarhwebsolutions.com',
        smtpFromEmail: 'billing@aligarhwebsolutions.com',
        emailProvider: 'SMTP',
        invoicePrefix: 'AWS',
        recurringAutoSend: true,
      },
      clients: [baseClient],
      invoices: [parentTemplate],
      invoiceItems: parentItems,
    });
    const res2 = await runRecurringInvoicesJob(dbAuto, now, {
      generatePdfFn: async () => Buffer.from('%PDF-1.4-mock'),
    });
    expect(res2).toBe('Generated 1 recurring invoice(s) (1 auto-sent)');
    const child2 = dbAuto._state.invoices[1];
    expect(child2.status).toBe('SENT');
    expect(dbAuto._state.messageLogs.some((m: any) => m.idempotencyKey === `RECURRING_SEND:${child2.id}:EMAIL`)).toBe(
      true
    );
  });

  it('builds sanitized compressed backups without user/session secrets and sends weekly email idempotently', async () => {
    const db = createPhase6MockDb({
      clients: [{ id: 'c_1', name: 'Sample Client' }],
      providers: [
        {
          id: 'prov_1',
          name: 'Hostinger',
          providerKey: 'hostinger',
          apiCredentialsEncrypted: 'super-secret-api-token',
        },
      ],
      domains: [{ id: 'd_1', name: 'example.in', clientId: 'c_1' }],
    });

    const now = new Date('2026-09-07T02:00:00Z');
    const payload = await buildSanitizedBackupPayload(db, now);
    expect(payload.meta.redactedSecrets).toBe(true);
    expect(payload.meta.counts.clients).toBe(1);
    expect(payload.meta.counts.domains).toBe(1);
    expect((payload.data as any).users).toBeUndefined();
    expect((payload.data as any).sessions).toBeUndefined();
    expect(payload.data.settings?.smtpPassEncrypted).toBe('[REDACTED]');
    expect(payload.data.settings?.razorpayKeySecretEnc).toBe('[REDACTED]');
    expect(payload.data.providerAccounts[0].apiCredentialsEncrypted).toBe('[REDACTED]');

    const { gzBuffer } = compressBackupPayload(payload);
    const roundTrip = JSON.parse(zlib.gunzipSync(gzBuffer).toString('utf8'));
    expect(roundTrip.meta.app).toBe('AWS Control Center');
    expect(roundTrip.data.providerAccounts[0].apiCredentialsEncrypted).toBe('[REDACTED]');

    // Weekly backup cron job emails once per ISO week
    const sent1 = await runWeeklyBackupJob(db, now);
    expect(sent1).toContain('Emailed weekly backup aws-control-center-backup-');
    expect(db._state.messageLogs.filter((m: any) => m.entityType === 'WEEKLY_BACKUP').length).toBe(1);

    const sent2 = await runWeeklyBackupJob(db, new Date('2026-09-09T10:00:00Z'));
    expect(sent2).toContain('Weekly backup already recorded for 2026-W37');
    expect(db._state.messageLogs.filter((m: any) => m.entityType === 'WEEKLY_BACKUP').length).toBe(1);
  });
});
