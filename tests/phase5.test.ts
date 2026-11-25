import { describe, expect, it } from 'vitest';
import {
  computeUptimePercent,
  isPrivateOrReservedIp,
  probeWebsite,
  validatePublicMonitorUrl,
} from '../server/lib/uptimeMonitor';
import {
  checkSingleWebsite,
  runDataRetentionJob,
  runUptimeChecksJob,
} from '../server/jobs/uptimeJob';

function createUptimeMockDb(initial?: {
  settings?: any;
  websites?: any[];
  checks?: any[];
  incidents?: any[];
  sessions?: any[];
}) {
  let seq = 1;
  const state = {
    settings: initial?.settings || {
      id: 1,
      businessName: 'Aligarh Web Solutions',
      timezone: 'Asia/Kolkata',
      dryRunMode: true,
      ownerAlertEmail: 'owner@aligarhwebsolutions.com',
      ownerAlertWhatsapp: '+919837000001',
      smtpFromEmail: 'billing@aligarhwebsolutions.com',
      emailProvider: 'SMTP',
    },
    websites: (initial?.websites || []).map((w) => ({ ...w })),
    uptimeCheck: (initial?.checks || []).map((c) => ({ ...c })),
    incident: (initial?.incidents || []).map((i) => ({ ...i })),
    messageLog: [] as any[],
    messageTemplate: [] as any[],
    session: (initial?.sessions || []).map((s) => ({ ...s })),
  };

  return {
    _state: state,
    settings: {
      findUnique: async () => state.settings,
    },
    website: {
      findMany: async ({ where }: any = {}) =>
        state.websites.filter((w) => {
          if (where?.paused !== undefined && w.paused !== where.paused) return false;
          return true;
        }),
      update: async ({ where, data }: any) => {
        const idx = state.websites.findIndex((w) => w.id === where.id);
        if (idx === -1) throw new Error('Website not found');
        state.websites[idx] = { ...state.websites[idx], ...data };
        return state.websites[idx];
      },
    },
    uptimeCheck: {
      create: async ({ data }: any) => {
        const row = { id: `chk_${seq++}`, ...data };
        state.uptimeCheck.push(row);
        return row;
      },
      deleteMany: async ({ where }: any = {}) => {
        const lt = where?.checkedAt?.lt ? new Date(where.checkedAt.lt).getTime() : null;
        const before = state.uptimeCheck.length;
        state.uptimeCheck = state.uptimeCheck.filter((c) => {
          if (lt !== null) return new Date(c.checkedAt).getTime() >= lt;
          return false;
        });
        return { count: before - state.uptimeCheck.length };
      },
    },
    incident: {
      findMany: async ({ where }: any = {}) =>
        state.incident.filter((inc) => {
          if (where?.websiteId && inc.websiteId !== where.websiteId) return false;
          if (where?.endedAt === null && inc.endedAt !== null && inc.endedAt !== undefined) return false;
          return true;
        }),
      create: async ({ data }: any) => {
        const row = {
          id: `inc_${seq++}`,
          endedAt: null,
          durationSeconds: null,
          notifiedOwner: false,
          notifiedClient: false,
          ...data,
        };
        state.incident.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = state.incident.findIndex((i) => i.id === where.id);
        if (idx === -1) throw new Error('Incident not found');
        state.incident[idx] = { ...state.incident[idx], ...data };
        return state.incident[idx];
      },
    },
    messageTemplate: {
      findUnique: async ({ where }: any) =>
        state.messageTemplate.find((t) => t.slug === where?.slug) || null,
    },
    messageLog: {
      findUnique: async ({ where }: any) =>
        state.messageLog.find((l) => l.idempotencyKey === where?.idempotencyKey) || null,
      create: async ({ data }: any) => {
        const row = { id: `mlog_${seq++}`, createdAt: new Date(), ...data };
        state.messageLog.push(row);
        return row;
      },
    },
    session: {
      deleteMany: async ({ where }: any = {}) => {
        const lt = where?.expiresAt?.lt ? new Date(where.expiresAt.lt).getTime() : null;
        const before = state.session.length;
        state.session = state.session.filter((s) => {
          if (lt !== null) return new Date(s.expiresAt).getTime() >= lt;
          return false;
        });
        return { count: before - state.session.length };
      },
    },
  } as any;
}

describe('Phase 5 Website Uptime Monitoring, SSRF Guard, Incidents & Retention', () => {
  it('blocks private, loopback, metadata, internal DNS, and non-HTTP URLs (SSRF guard)', async () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('10.24.1.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.12')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);

    const blockedUrls = [
      'http://localhost:3000/api/health',
      'http://127.0.0.1:3000/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/internal',
      'http://192.168.0.10/',
      'http://[::1]:8080/',
      'ftp://files.example.com/archive',
      'https://admin:secret@example.com/',
      'https://mybox.internal/status',
    ];

    for (const u of blockedUrls) {
      await expect(validatePublicMonitorUrl(u)).rejects.toThrow();
    }

    // DNS rebinding / private DNS lookup block
    await expect(
      validatePublicMonitorUrl('https://evil-rebind.example.com/', {
        requireDnsResolution: true,
        lookupFn: async () => [{ address: '172.16.5.4', family: 4 }],
      })
    ).rejects.toThrow(/restricted IP/);

    // Valid public HTTPS site resolving to public IP succeeds
    const valid = await validatePublicMonitorUrl('https://aligarhwebsolutions.com', {
      requireDnsResolution: true,
      lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    expect(valid.protocol).toBe('https:');
    expect(valid.hostname).toBe('aligarhwebsolutions.com');
  });

  it('probes keyword presence and blocks HTTP redirects targeting private networks', async () => {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const mockSsl = async () => new Date('2027-06-01T00:00:00Z');

    const okRes = await probeWebsite(
      {
        url: 'https://client-site.example.com/',
        expectedStatusCode: 200,
        requiredKeyword: 'Aligarh Brass',
      },
      {
        lookupFn: publicLookup,
        sslInspector: mockSsl,
        fetchFn: (async () =>
          new Response('<html><body>Welcome to Aligarh Brass Exports</body></html>', {
            status: 200,
          })) as any,
      }
    );
    expect(okRes.up).toBe(true);
    expect(okRes.httpCode).toBe(200);
    expect(okRes.sslExpiry?.toISOString()).toBe('2027-06-01T00:00:00.000Z');

    const missingKw = await probeWebsite(
      {
        url: 'https://client-site.example.com/',
        expectedStatusCode: 200,
        requiredKeyword: 'Aligarh Brass',
      },
      {
        lookupFn: publicLookup,
        sslInspector: mockSsl,
        fetchFn: (async () =>
          new Response('<html><body>Maintenance Mode</body></html>', {
            status: 200,
          })) as any,
      }
    );
    expect(missingKw.up).toBe(false);
    expect(missingKw.error).toContain('Required keyword');

    // Redirect to loopback must fail closed
    const ssrfRedirect = await probeWebsite(
      {
        url: 'https://client-site.example.com/',
        expectedStatusCode: 200,
      },
      {
        lookupFn: publicLookup,
        sslInspector: mockSsl,
        fetchFn: (async () =>
          new Response('', {
            status: 302,
            headers: { location: 'http://127.0.0.1:3000/api/settings' },
          })) as any,
      }
    );
    expect(ssrfRedirect.up).toBe(false);
    expect(ssrfRedirect.error).toContain('not permitted');
  });

  it('opens an incident after consecutive failureThreshold, notifies owner/client, and resolves on recovery', async () => {
    const db = createUptimeMockDb({
      websites: [
        {
          id: 'web_1',
          url: 'https://aligarhbrass.example.com',
          label: 'Aligarh Brass Store',
          clientId: 'c_1',
          intervalMinutes: 5,
          expectedStatusCode: 200,
          failureThreshold: 2,
          consecutiveFailures: 0,
          isDown: false,
          paused: false,
          notifyClient: true,
          alertContacts: ['ops@aligarhwebsolutions.com'],
          lastCheckedAt: null,
          sslExpiry: null,
          client: {
            id: 'c_1',
            name: 'Aligarh Brass Exports',
            emails: ['info@aligarhbrass.example.com'],
            whatsappPhone: '+919837011223',
            preferredChannel: 'BOTH',
            remindersEnabled: true,
          },
        },
      ],
    });

    const t0 = new Date('2026-08-01T10:00:00Z');
    const t1 = new Date('2026-08-01T10:05:00Z');
    const t2 = new Date('2026-08-01T10:15:00Z');

    // Failure 1 of 2 -> should NOT open incident yet
    const r1 = await checkSingleWebsite(db, db._state.websites[0], t0, {
      probeFn: async () => ({
        up: false,
        httpCode: 502,
        responseMs: 320,
        error: 'Expected HTTP 200, received 502',
        sslExpiry: null,
      }),
    });
    expect(r1.up).toBe(false);
    expect(r1.incidentOpened).toBe(false);
    expect(db._state.websites[0].consecutiveFailures).toBe(1);
    expect(db._state.websites[0].isDown).toBe(false);
    expect(db._state.incident.length).toBe(0);

    // Failure 2 of 2 -> marks DOWN, opens Incident, logs owner + client notifications
    const r2 = await checkSingleWebsite(db, db._state.websites[0], t1, {
      probeFn: async () => ({
        up: false,
        httpCode: 502,
        responseMs: 410,
        error: 'Expected HTTP 200, received 502',
        sslExpiry: null,
      }),
    });
    expect(r2.incidentOpened).toBe(true);
    expect(db._state.websites[0].isDown).toBe(true);
    expect(db._state.incident.length).toBe(1);
    expect(db._state.incident[0].notifiedOwner).toBe(true);
    expect(db._state.incident[0].notifiedClient).toBe(true);
    expect(db._state.messageLog.some((l: any) => l.idempotencyKey?.startsWith('UPTIME_DOWN:'))).toBe(true);

    // Recovery after 10 minutes (600 seconds) -> resolves Incident & logs recovery notifications
    const r3 = await checkSingleWebsite(db, db._state.websites[0], t2, {
      probeFn: async () => ({
        up: true,
        httpCode: 200,
        responseMs: 145,
        error: null,
        sslExpiry: new Date('2026-08-08T10:00:00Z'), // 7 days from Aug 1 -> triggers 7d SSL warning once
      }),
    });
    expect(r3.up).toBe(true);
    expect(r3.incidentResolved).toBe(true);
    expect(db._state.websites[0].isDown).toBe(false);
    expect(db._state.websites[0].consecutiveFailures).toBe(0);
    expect(db._state.incident[0].durationSeconds).toBe(600);
    expect(db._state.messageLog.some((l: any) => l.idempotencyKey?.startsWith('UPTIME_RECOVERY:'))).toBe(true);
    expect(db._state.messageLog.some((l: any) => l.entityType === 'SSL' && l.offsetDays === 7)).toBe(true);

    // Running again same day does not duplicate SSL alert
    const msgCountBefore = db._state.messageLog.length;
    await checkSingleWebsite(db, db._state.websites[0], new Date('2026-08-01T10:20:00Z'), {
      probeFn: async () => ({
        up: true,
        httpCode: 200,
        responseMs: 120,
        error: null,
        sslExpiry: new Date('2026-08-08T10:00:00Z'),
      }),
    });
    expect(db._state.messageLog.length).toBe(msgCountBefore);

    // 3 checks (2 down, 1 up) => 33.33% uptime
    expect(computeUptimePercent(db._state.uptimeCheck)).toBe(50); // 4 checks: 2 down + 2 up => 50%
  });

  it('skips paused websites during scheduled runs and prunes uptime checks older than 90 days', async () => {
    const now = new Date('2026-10-01T06:00:00Z');
    const oldCheck = new Date(now.getTime() - 95 * 86_400_000);
    const recentCheck = new Date(now.getTime() - 10 * 86_400_000);

    const db = createUptimeMockDb({
      websites: [
        {
          id: 'w_active',
          url: 'https://active.example.com',
          clientId: 'c_1',
          intervalMinutes: 5,
          paused: false,
          lastCheckedAt: null,
        },
        {
          id: 'w_paused',
          url: 'https://paused.example.com',
          clientId: 'c_1',
          intervalMinutes: 5,
          paused: true,
          lastCheckedAt: null,
        },
      ],
      checks: [
        { id: 'c_old', websiteId: 'w_active', checkedAt: oldCheck, up: true },
        { id: 'c_recent', websiteId: 'w_active', checkedAt: recentCheck, up: true },
      ],
      sessions: [
        { id: 's_exp', expiresAt: new Date(now.getTime() - 1000) },
        { id: 's_valid', expiresAt: new Date(now.getTime() + 60_000) },
      ],
    });

    const checkSummary = await runUptimeChecksJob(db, now, {
      probeFn: async () => ({
        up: true,
        httpCode: 200,
        responseMs: 88,
        error: null,
        sslExpiry: null,
      }),
    });
    expect(checkSummary).toContain('Checked 1 websites (1 up, 0 down)');
    expect(db._state.websites.find((w: any) => w.id === 'w_paused').lastCheckedAt).toBeNull();

    const retentionSummary = await runDataRetentionJob(db, now);
    expect(retentionSummary).toContain('Pruned 1 uptime checks (>90d) and 1 expired sessions');
    expect(db._state.uptimeCheck.some((c: any) => c.id === 'c_old')).toBe(false);
    expect(db._state.uptimeCheck.some((c: any) => c.id === 'c_recent')).toBe(true);
    expect(db._state.session.map((s: any) => s.id)).toEqual(['s_valid']);
  });
});
