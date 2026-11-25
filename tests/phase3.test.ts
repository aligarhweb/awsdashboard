import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  isWithinSendWindowIST,
  nextAllowedSendTimeIST,
  normalizeWhatsappNumber,
  plainTextToSafeEmailHtml,
  renderTemplateText,
} from '../server/lib/messaging';
import {
  dispatchDueMessages,
  evaluateAndQueueReminders,
  runOwnerDigestJob,
} from '../server/jobs/reminderEngine';

function createInMemoryMockPrisma(initial?: {
  settings?: any;
  clients?: any[];
  domains?: any[];
  services?: any[];
  invoices?: any[];
  estimates?: any[];
  rules?: any[];
  templates?: any[];
  logs?: any[];
}) {
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}_${seq++}`;

  const state = {
    settings: initial?.settings ? [{ ...initial.settings }] : ([] as any[]),
    client: (initial?.clients || []).map((c) => ({ ...c })),
    domain: (initial?.domains || []).map((d) => ({ ...d })),
    service: (initial?.services || []).map((s) => ({ ...s })),
    invoice: (initial?.invoices || []).map((i) => ({ ...i })),
    estimate: (initial?.estimates || []).map((e) => ({ ...e })),
    reminderRule: (initial?.rules || []).map((r) => ({ ...r })),
    messageTemplate: (initial?.templates || []).map((t) => ({ ...t })),
    messageLog: (initial?.logs || []).map((l) => ({ ...l })),
  };

  function matchWhere(row: any, where: any): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && 'in' in (cond as any)) {
        if (!(cond as any).in.includes(row[k])) return false;
      } else if (row[k] !== cond) {
        return false;
      }
    }
    return true;
  }

  return {
    _state: state,
    settings: {
      findUnique: async ({ where }: any) => state.settings.find((s) => s.id === where.id) || null,
      create: async ({ data }: any) => {
        const row = { id: data.id ?? 1, ...data };
        state.settings.push(row);
        return row;
      },
    },
    messageTemplate: {
      count: async () => state.messageTemplate.length,
      findUnique: async ({ where }: any) =>
        state.messageTemplate.find((t) => (where.id ? t.id === where.id : t.slug === where.slug)) ||
        null,
      findMany: async () => [...state.messageTemplate],
      create: async ({ data }: any) => {
        const row = { id: data.id || nextId('tpl'), createdAt: new Date(), ...data };
        state.messageTemplate.push(row);
        return row;
      },
    },
    reminderRule: {
      count: async () => state.reminderRule.length,
      findMany: async ({ where, include }: any = {}) =>
        state.reminderRule
          .filter((r) => matchWhere(r, where))
          .map((r) => ({
            ...r,
            ...(include?.template
              ? { template: state.messageTemplate.find((t) => t.id === r.templateId) || null }
              : {}),
          })),
      create: async ({ data }: any) => {
        const row = { id: data.id || nextId('rule'), createdAt: new Date(), ...data };
        state.reminderRule.push(row);
        return row;
      },
    },
    client: {
      findUnique: async ({ where }: any) => state.client.find((c) => c.id === where.id) || null,
    },
    domain: {
      findMany: async ({ include }: any = {}) =>
        state.domain.map((d) => ({
          ...d,
          ...(include?.client
            ? { client: state.client.find((c) => c.id === d.clientId) || null }
            : {}),
        })),
    },
    service: {
      findMany: async ({ include }: any = {}) =>
        state.service.map((s) => ({
          ...s,
          ...(include?.client
            ? { client: state.client.find((c) => c.id === s.clientId) || null }
            : {}),
        })),
    },
    invoice: {
      findMany: async ({ where, include }: any = {}) =>
        state.invoice
          .filter((inv) => matchWhere(inv, where))
          .map((inv) => ({
            ...inv,
            ...(include?.client
              ? { client: state.client.find((c) => c.id === inv.clientId) || null }
              : {}),
          })),
    },
    estimate: {
      findMany: async ({ where, include }: any = {}) =>
        state.estimate
          .filter((est) => matchWhere(est, where))
          .map((est) => ({
            ...est,
            ...(include?.client
              ? { client: state.client.find((c) => c.id === est.clientId) || null }
              : {}),
          })),
    },
    messageLog: {
      findUnique: async ({ where }: any) => {
        if (where.id) return state.messageLog.find((l) => l.id === where.id) || null;
        if (where.idempotencyKey) {
          return state.messageLog.find((l) => l.idempotencyKey === where.idempotencyKey) || null;
        }
        return null;
      },
      findMany: async ({ where, take }: any = {}) => {
        const filtered = state.messageLog.filter((l) => matchWhere(l, where));
        return typeof take === 'number' ? filtered.slice(0, take) : filtered;
      },
      create: async ({ data }: any) => {
        const row = {
          id: data.id || nextId('log'),
          retryCount: 0,
          createdAt: new Date(),
          ...data,
        };
        state.messageLog.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = state.messageLog.findIndex((l) => l.id === where.id);
        if (idx === -1) throw new Error(`Log ${where.id} not found`);
        state.messageLog[idx] = { ...state.messageLog[idx], ...data };
        return state.messageLog[idx];
      },
    },
  } as any;
}

describe('Phase 3 Messaging Utilities', () => {
  it('substitutes template variables and escapes HTML cleanly to prevent XSS', () => {
    const rendered = renderTemplateText(
      'Hello {{client_name}}, {{domain}} expires in {{days_left}} days ({{missing}}).',
      { client_name: 'Tariq <script>alert(1)</script>', domain: 'aligarhbrass.in', days_left: 7 }
    );
    expect(rendered).toBe(
      'Hello Tariq <script>alert(1)</script>, aligarhbrass.in expires in 7 days ().'
    );

    const safe = escapeHtml('<img src=x onerror="alert(1)">');
    expect(safe).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');

    const html = plainTextToSafeEmailHtml('Hi <script>evil()</script>\nLine 2', 'A & B <Web>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;<br/>Line 2');
    expect(html).toContain('A &amp; B &lt;Web&gt;');
  });

  it('normalizes Indian and international WhatsApp phone numbers', () => {
    expect(normalizeWhatsappNumber('9837011223')).toBe('919837011223');
    expect(normalizeWhatsappNumber('09837011223')).toBe('919837011223');
    expect(normalizeWhatsappNumber('+91 98370-11223')).toBe('919837011223');
    expect(normalizeWhatsappNumber('+1 415 555 2671')).toBe('14155552671');
    expect(normalizeWhatsappNumber('')).toBeNull();
  });

  it('evaluates IST quiet hours (20:00-09:00) and computes next 09:00 IST send slot', () => {
    // 2026-11-24T00:30:00.000Z == 2026-11-24 06:00:00 IST (inside overnight quiet hours)
    const sixAmIst = new Date('2026-11-24T00:30:00.000Z');
    expect(isWithinSendWindowIST(sixAmIst, '20:00', '09:00', 'Asia/Kolkata')).toBe(false);
    const nextNineAm = nextAllowedSendTimeIST(sixAmIst, '20:00', '09:00', 'Asia/Kolkata');
    expect(nextNineAm.toISOString()).toBe('2026-11-24T03:30:00.000Z'); // 09:00 IST

    // 2026-11-24T06:00:00.000Z == 2026-11-24 11:30:00 IST (outside quiet hours)
    const middayIst = new Date('2026-11-24T06:00:00.000Z');
    expect(isWithinSendWindowIST(middayIst, '20:00', '09:00', 'Asia/Kolkata')).toBe(true);
    expect(nextAllowedSendTimeIST(middayIst, '20:00', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      middayIst.toISOString()
    );

    // 2026-11-24T16:00:00.000Z == 2026-11-24 21:30:00 IST -> rolls over to next day 09:00 IST
    const nightIst = new Date('2026-11-24T16:00:00.000Z');
    expect(isWithinSendWindowIST(nightIst, '20:00', '09:00', 'Asia/Kolkata')).toBe(false);
    expect(nextAllowedSendTimeIST(nightIst, '20:00', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-25T03:30:00.000Z'
    );
  });
});

describe('Phase 3 Reminder Engine, Idempotency, Retries & Digest', () => {
  it('queues idempotent reminders, respects client toggles/whoPays/missing contact, and dispatches in dry-run', async () => {
    // Now = 2026-11-24 10:00 IST (04:30 UTC), within send window and after 06:00 IST eval hour
    const now = new Date('2026-11-24T04:30:00.000Z');
    const in3Days = new Date('2026-11-27T04:30:00.000Z');

    const mockDb = createInMemoryMockPrisma({
      settings: {
        id: 1,
        businessName: 'Aligarh Web Solutions',
        timezone: 'Asia/Kolkata',
        quietHoursStart: '20:00',
        quietHoursEnd: '09:00',
        reminderEvalHourIst: 6,
        dryRunMode: true,
        ownerAlertEmail: 'owner@aligarhwebsolutions.com',
      },
      clients: [
        {
          id: 'c_both',
          name: 'Active Both',
          contactPerson: 'Tariq',
          emails: ['tariq@example.in'],
          whatsappPhone: '+919837011223',
          preferredChannel: 'BOTH',
          remindersEnabled: true,
          status: 'ACTIVE',
        },
        {
          id: 'c_no_contact',
          name: 'Email Only Missing Email',
          emails: [],
          whatsappPhone: null,
          preferredChannel: 'EMAIL',
          remindersEnabled: true,
          status: 'ACTIVE',
        },
        {
          id: 'c_disabled',
          name: 'Opted Out',
          emails: ['optout@example.in'],
          whatsappPhone: '+919800000000',
          preferredChannel: 'BOTH',
          remindersEnabled: false,
          status: 'ACTIVE',
        },
      ],
      domains: [
        {
          id: 'd1',
          name: 'due3days.in',
          clientId: 'c_both',
          expiryDate: in3Days,
          sellingPrice: 1200,
          whoPays: 'CLIENT',
          status: 'EXPIRING_SOON',
        },
        {
          id: 'd_me',
          name: 'mypaid.in',
          clientId: 'c_both',
          expiryDate: in3Days,
          sellingPrice: 1200,
          whoPays: 'ME',
          status: 'ACTIVE',
        },
        {
          id: 'd_missing',
          name: 'nocontact.in',
          clientId: 'c_no_contact',
          expiryDate: in3Days,
          sellingPrice: 1200,
          whoPays: 'CLIENT',
          status: 'ACTIVE',
        },
        {
          id: 'd_optout',
          name: 'optout.in',
          clientId: 'c_disabled',
          expiryDate: in3Days,
          sellingPrice: 1200,
          whoPays: 'CLIENT',
          status: 'ACTIVE',
        },
      ],
    });

    const first = await evaluateAndQueueReminders(mockDb, now);
    // d1 queues EMAIL + WHATSAPP (2), d_missing queues SKIPPED EMAIL (1); d_me and d_optout ignored
    expect(first.queued).toBe(2);
    expect(first.skipped).toBe(1);
    expect(mockDb._state.messageLog.length).toBe(3);

    // Second evaluation at same timestamp must be idempotent (0 duplicates)
    const second = await evaluateAndQueueReminders(mockDb, now);
    expect(second.queued).toBe(0);
    expect(second.skipped).toBe(0);
    expect(mockDb._state.messageLog.length).toBe(3);

    // Dispatch in dryRunMode sends both QUEUED logs
    const disp = await dispatchDueMessages(mockDb, now);
    expect(disp.heldForQuietHours).toBe(false);
    expect(disp.sent).toBe(2);
    expect(disp.failed).toBe(0);
    expect(mockDb._state.messageLog.filter((l: any) => l.status === 'SENT').length).toBe(2);
    expect(mockDb._state.messageLog.filter((l: any) => l.status === 'SKIPPED').length).toBe(1);
  });

  it('holds dispatch during quiet hours and applies 15m exponential retry backoff on failure', async () => {
    const sixAmIst = new Date('2026-11-24T00:30:00.000Z');
    const middayIst = new Date('2026-11-24T06:00:00.000Z');

    const mockDb = createInMemoryMockPrisma({
      settings: {
        id: 1,
        businessName: 'Aligarh Web Solutions',
        timezone: 'Asia/Kolkata',
        quietHoursStart: '20:00',
        quietHoursEnd: '09:00',
        reminderEvalHourIst: 6,
        dryRunMode: false, // live mode with no SMTP creds -> triggers deterministic failure
        emailProvider: 'SMTP',
      },
      clients: [
        {
          id: 'c1',
          name: 'Test Client',
          emails: ['client@example.in'],
          preferredChannel: 'EMAIL',
          remindersEnabled: true,
          status: 'ACTIVE',
        },
      ],
      logs: [
        {
          id: 'log_1',
          clientId: 'c1',
          channel: 'EMAIL',
          renderedSubject: 'Test',
          renderedContent: 'Body',
          status: 'QUEUED',
          scheduledAt: sixAmIst,
          retryCount: 0,
        },
      ],
    });

    // Inside quiet hours -> held
    const quietRes = await dispatchDueMessages(mockDb, sixAmIst);
    expect(quietRes.heldForQuietHours).toBe(true);
    expect(mockDb._state.messageLog[0].status).toBe('QUEUED');

    // Outside quiet hours -> fails due to missing SMTP creds and sets retryCount=1, nextRetryAt=+15m
    const liveRes = await dispatchDueMessages(mockDb, middayIst);
    expect(liveRes.heldForQuietHours).toBe(false);
    expect(liveRes.failed).toBe(1);
    const updated = mockDb._state.messageLog[0];
    expect(updated.status).toBe('FAILED');
    expect(updated.retryCount).toBe(1);
    expect(updated.nextRetryAt.getTime()).toBe(middayIst.getTime() + 15 * 60_000);
  });

  it('runs daily owner digest idempotently and summarizes critical domains & overdue invoices', async () => {
    const now = new Date('2026-11-24T04:30:00.000Z'); // 10:00 IST
    const in2Days = new Date('2026-11-26T04:30:00.000Z');
    const overdueDate = new Date('2026-11-10T04:30:00.000Z');

    const mockDb = createInMemoryMockPrisma({
      settings: {
        id: 1,
        businessName: 'Aligarh Web Solutions',
        timezone: 'Asia/Kolkata',
        reminderEvalHourIst: 6,
        dryRunMode: true,
        ownerAlertEmail: 'owner@aligarhwebsolutions.com',
      },
      clients: [{ id: 'c1', name: 'Brass Exports' }],
      domains: [
        {
          id: 'd1',
          name: 'brass.in',
          clientId: 'c1',
          expiryDate: in2Days,
          status: 'EXPIRING_SOON',
        },
      ],
      invoices: [
        {
          id: 'inv1',
          invoiceNumber: 'INV-26-27-0001',
          clientId: 'c1',
          dueDate: overdueDate,
          total: 5000,
          amountPaid: 1000,
          status: 'OVERDUE',
        },
      ],
    });

    const msg1 = await runOwnerDigestJob(mockDb, now);
    expect(msg1).toContain('Sent daily digest to owner@aligarhwebsolutions.com');
    expect(msg1).toContain('1 domains');
    expect(msg1).toContain('1 overdue');
    expect(mockDb._state.messageLog.length).toBe(1);
    expect(mockDb._state.messageLog[0].renderedContent).toContain('brass.in');
    expect(mockDb._state.messageLog[0].renderedContent).toContain('INV-26-27-0001');

    // Second run same IST date is idempotent
    const msg2 = await runOwnerDigestJob(mockDb, now);
    expect(msg2).toContain('already recorded');
    expect(mockDb._state.messageLog.length).toBe(1);
  });
});
