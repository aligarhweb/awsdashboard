import { describe, expect, it } from 'vitest';
import {
  computeAutoExpiryStatus,
  formatDateDDMMMYYYY,
  getDaysLeftIST,
  getUrgencyInfo,
} from '../shared/dates';
import { formatINR } from '../shared/currency';
import { createPreviewPrismaClient } from '../server/previewStore';
import { acquireCronLock, releaseCronLock, runCronTick } from '../server/jobs/cronTick';
import { normalizeMysqlUrl } from '../server/lib/dbUrl';

describe('IST Date & Expiry Offset Logic', () => {
  it('formats dates as DD-MMM-YYYY in Asia/Kolkata', () => {
    const d = new Date('2026-11-24T19:00:00.000Z'); // 25-Nov-2026 00:30 IST
    expect(formatDateDDMMMYYYY(d)).toBe('25-Nov-2026');
  });

  it('computes calendar days left in IST accurately', () => {
    const now = new Date('2026-11-24T10:00:00.000Z'); // 24-Nov-2026 15:30 IST
    const target7 = new Date('2026-12-01T10:00:00.000Z'); // 01-Dec-2026 15:30 IST
    expect(getDaysLeftIST(target7, now)).toBe(7);

    const expiredYesterday = new Date('2026-11-23T10:00:00.000Z');
    expect(getDaysLeftIST(expiredYesterday, now)).toBe(-1);
  });

  it('assigns urgency colors and labels according to thresholds', () => {
    const now = new Date('2026-11-24T06:00:00.000Z');
    expect(getUrgencyInfo(new Date('2026-11-20T06:00:00.000Z'), now).level).toBe('red');
    expect(getUrgencyInfo(new Date('2026-11-24T06:00:00.000Z'), now)).toMatchObject({
      level: 'red',
      daysLeft: 0,
      label: 'Expires today',
    });
    expect(getUrgencyInfo(new Date('2026-12-01T06:00:00.000Z'), now).level).toBe('red'); // 7 days
    expect(getUrgencyInfo(new Date('2026-12-10T06:00:00.000Z'), now).level).toBe('orange'); // 16 days
    expect(getUrgencyInfo(new Date('2027-01-10T06:00:00.000Z'), now).level).toBe('yellow'); // 47 days
    expect(getUrgencyInfo(new Date('2027-03-10T06:00:00.000Z'), now).level).toBe('green'); // >60 days
  });

  it('preserves locked manual statuses during auto-status computation', () => {
    const past = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-11-24T00:00:00.000Z');
    expect(computeAutoExpiryStatus(past, 'ACTIVE', now)).toBe('EXPIRED');
    expect(computeAutoExpiryStatus(past, 'TRANSFERRED', now)).toBe('TRANSFERRED');
    expect(computeAutoExpiryStatus(past, 'CANCELLED', now)).toBe('CANCELLED');
  });
});

describe('Indian Currency Formatting', () => {
  it('formats amounts with Indian digit grouping', () => {
    expect(formatINR(124500)).toBe('₹1,24,500');
    expect(formatINR(1000000)).toBe('₹10,00,000');
    expect(formatINR(749.5, { decimals: 2 })).toBe('₹749.50');
  });
});

describe('Cron Tick Locking & Idempotency', () => {
  it('prevents concurrent overlapping runs via DB lock and respects intervals', async () => {
    const fakeDb = createPreviewPrismaClient();
    // Use isolated JobState in memory by clearing JobState first
    await fakeDb.jobState.deleteMany();

    const t0 = new Date('2026-11-24T06:00:00.000Z');
    const first = await runCronTick(fakeDb, { now: t0 });
    expect(first.locked).toBe(false);
    expect(first.executed.length).toBeGreaterThan(0);

    // 2 minutes later: uptime_checks (1m) should run, expiry_status_sync (15m) should skip
    const t2m = new Date('2026-11-24T06:02:00.000Z');
    const second = await runCronTick(fakeDb, { now: t2m });
    expect(second.locked).toBe(false);
    expect(second.executed.map((e) => e.jobName)).toContain('uptime_checks');
    expect(second.skipped).toContain('expiry_status_sync');

    // Simulate active lock held by another worker
    const lockOk = await acquireCronLock(fakeDb, 'worker-A', t2m);
    expect(lockOk).toBe(true);
    const blocked = await runCronTick(fakeDb, { now: new Date(t2m.getTime() + 10_000) });
    expect(blocked.locked).toBe(true);
    expect(blocked.executed).toHaveLength(0);

    await releaseCronLock(fakeDb, 'worker-A');
    await fakeDb.jobState.deleteMany();
  });
});

describe('MySQL Connection String Normalization', () => {
  it('URL-encodes passwords containing @, :, #, /, and ? without breaking port parsing', () => {
    const raw = 'mysql://u123_user:p@ss:w#o/r?d@srv100.hstgr.io:3306/u123_db';
    const res = normalizeMysqlUrl(raw);
    expect(res.ok).toBe(true);
    expect(res.url).toBe(
      'mysql://u123_user:p%40ss%3Aw%23o%2Fr%3Fd@srv100.hstgr.io:3306/u123_db?connection_limit=5'
    );
  });

  it('does not double-encode already-encoded passwords and preserves existing query params', () => {
    const raw = '"mysql://user:pass%40123@127.0.0.1:3306/mydb?sslaccept=strict"';
    const res = normalizeMysqlUrl(raw);
    expect(res.ok).toBe(true);
    expect(res.url).toBe('mysql://user:pass%40123@127.0.0.1:3306/mydb?sslaccept=strict&connection_limit=5');
  });

  it('rejects invalid non-numeric ports and placeholder URLs gracefully', () => {
    expect(normalizeMysqlUrl('mysql://user:pass@host:PORT/db').ok).toBe(false);
    expect(normalizeMysqlUrl('mysql://DB_USER:DB_PASSWORD@127.0.0.1:3306/DB_NAME').ok).toBe(false);
  });
});

describe('Zoho Books & Standard Client CSV Parsing', () => {
  it('parses Zoho Books Contacts CSV rows with Indian phones, landlines, states, and generic display names', async () => {
    const { parseClientCsv } = await import('../server/lib/clientCsv');
    const sample = [
      'Display Name,Company Name,Salutation,First Name,Last Name,Phone,Billing Address,Billing City,Billing State,Billing Code,EmailID,MobilePhone,Contact ID,Place Of Contact,Status',
      'Director,Institute of Ophthalmology,,Director,,0571-2900120,AMU Campus,Aligarh,Uttara Pradesh,202002,amuio2011@gmail.com,9634911152,1353803000000084021,UP,Active',
      'Dr. Mohiuddin Irfan,Irfan Tours,Dr.,Mohiuddin,Irfan,05713291636,Dodhpur,Aligarh,Uttar Pradesh,202001,mui_imhu@yahoo.com,\'+919837293339,1353803000000073001,UP,Active',
    ].join('\n');

    const rows = parseClientCsv(sample);
    expect(rows).toHaveLength(2);
    expect(rows[0].valid).toBe(true);
    expect(rows[0].data?.name).toBe('Institute of Ophthalmology');
    expect(rows[0].data?.contactPerson).toBe('Director');
    expect(rows[0].data?.whatsappPhone).toBe('+919634911152');
    expect(rows[0].data?.secondaryPhones).toContain('05712900120');
    expect(rows[0].data?.state).toBe('Uttar Pradesh');

    expect(rows[1].valid).toBe(true);
    expect(rows[1].data?.name).toBe('Dr. Mohiuddin Irfan');
    expect(rows[1].data?.whatsappPhone).toBe('+919837293339');
    expect(rows[1].data?.secondaryPhones).toContain('05713291636');
    expect(rows[1].data?.tags).toContain('zoho-books');
  });
});
