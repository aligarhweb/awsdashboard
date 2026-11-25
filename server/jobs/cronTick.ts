import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { computeAutoExpiryStatus, getDaysLeftIST } from '../../shared/dates';
import { logError, logInfo } from '../lib/logger';
import { runOwnerDigestJob, runReminderJob } from './reminderEngine';
import { runDataRetentionJob, runUptimeChecksJob } from './uptimeJob';
import {
  runRdapVerificationJob,
  runRecurringInvoicesJob,
  runWeeklyBackupJob,
} from './phase6Jobs';

export interface CronJobSpec {
  name: string;
  intervalMinutes: number;
  phase: number;
  run: (prisma: PrismaClient, now: Date) => Promise<string>;
}

const LOCK_JOB_NAME = '__cron_tick_lock__';
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 minutes stale lock safeguard

export const CRON_JOBS: CronJobSpec[] = [
  {
    name: 'expiry_status_sync',
    intervalMinutes: 15,
    phase: 1,
    async run(prisma, now) {
      const domains = await prisma.domain.findMany();
      let domainsUpdated = 0;
      for (const d of domains) {
        const nextStatus = computeAutoExpiryStatus(d.expiryDate, d.status, now);
        if (nextStatus !== d.status) {
          await prisma.domain.update({
            where: { id: d.id },
            data: { status: nextStatus as any },
          });
          domainsUpdated += 1;
        }
      }

      const services = await prisma.service.findMany();
      let servicesUpdated = 0;
      for (const s of services) {
        const nextStatus = computeAutoExpiryStatus(s.renewalDate, s.status, now);
        if (nextStatus !== s.status) {
          await prisma.service.update({
            where: { id: s.id },
            data: { status: nextStatus as any },
          });
          servicesUpdated += 1;
        }
      }

      const invoices = await prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID'] } },
      });
      let invoicesUpdated = 0;
      for (const inv of invoices) {
        const balance = Number(inv.total ?? 0) - Number(inv.amountPaid ?? 0);
        if (balance > 0.01 && getDaysLeftIST(inv.dueDate, now) < 0) {
          await prisma.invoice.update({
            where: { id: inv.id },
            data: { status: 'OVERDUE' },
          });
          invoicesUpdated += 1;
        }
      }

      return `Synced ${domains.length} domains (${domainsUpdated} updated), ${services.length} services (${servicesUpdated} updated), ${invoicesUpdated} overdue invoices`;
    },
  },
  {
    name: 'reminder_dispatch',
    intervalMinutes: 5,
    phase: 3,
    async run(prisma, now) {
      return runReminderJob(prisma, now);
    },
  },
  {
    name: 'uptime_checks',
    intervalMinutes: 1,
    phase: 5,
    async run(prisma, now) {
      return runUptimeChecksJob(prisma, now);
    },
  },
  {
    name: 'rdap_verification',
    intervalMinutes: 1440,
    phase: 6,
    async run(prisma, now) {
      return runRdapVerificationJob(prisma, now);
    },
  },
  {
    name: 'recurring_invoices',
    intervalMinutes: 60,
    phase: 6,
    async run(prisma, now) {
      return runRecurringInvoicesJob(prisma, now);
    },
  },
  {
    name: 'owner_digest',
    intervalMinutes: 1440,
    phase: 3,
    async run(prisma, now) {
      return runOwnerDigestJob(prisma, now);
    },
  },
  {
    name: 'weekly_backup',
    intervalMinutes: 10080,
    phase: 6,
    async run(prisma, now) {
      return runWeeklyBackupJob(prisma, now);
    },
  },
  {
    name: 'data_retention',
    intervalMinutes: 1440,
    phase: 5,
    async run(prisma, now) {
      return runDataRetentionJob(prisma, now);
    },
  },
];

export interface CronTickResult {
  ranAt: string;
  locked: boolean;
  executed: Array<{ jobName: string; status: 'ok' | 'error'; summary: string }>;
  skipped: string[];
}

export async function acquireCronLock(
  prisma: PrismaClient,
  instanceId: string,
  now: Date
): Promise<boolean> {
  const existing = await prisma.jobState.findUnique({
    where: { jobName: LOCK_JOB_NAME },
  });

  if (existing?.lockedUntil && existing.lockedUntil.getTime() > now.getTime()) {
    return false;
  }

  const lockedUntil = new Date(now.getTime() + LOCK_TTL_MS);
  await prisma.jobState.upsert({
    where: { jobName: LOCK_JOB_NAME },
    create: {
      jobName: LOCK_JOB_NAME,
      lastRunAt: now,
      lastStatus: 'LOCKED',
      lockedUntil,
      lockedBy: instanceId,
    },
    update: {
      lastRunAt: now,
      lastStatus: 'LOCKED',
      lockedUntil,
      lockedBy: instanceId,
    },
  });

  // Re-read to reduce race risk when multiple callers hit simultaneously
  const verify = await prisma.jobState.findUnique({ where: { jobName: LOCK_JOB_NAME } });
  return verify?.lockedBy === instanceId;
}

export async function releaseCronLock(prisma: PrismaClient, instanceId: string): Promise<void> {
  const existing = await prisma.jobState.findUnique({ where: { jobName: LOCK_JOB_NAME } });
  if (existing?.lockedBy === instanceId) {
    await prisma.jobState.update({
      where: { jobName: LOCK_JOB_NAME },
      data: { lockedUntil: null, lockedBy: null, lastStatus: 'IDLE' },
    });
  }
}

export async function runCronTick(
  prisma: PrismaClient,
  options: { now?: Date; forceAll?: boolean } = {}
): Promise<CronTickResult> {
  const now = options.now ?? new Date();
  const instanceId = crypto.randomUUID();
  const acquired = await acquireCronLock(prisma, instanceId, now);

  if (!acquired) {
    return {
      ranAt: now.toISOString(),
      locked: true,
      executed: [],
      skipped: CRON_JOBS.map((j) => j.name),
    };
  }

  const executed: CronTickResult['executed'] = [];
  const skipped: string[] = [];

  try {
    for (const job of CRON_JOBS) {
      const state = await prisma.jobState.findUnique({ where: { jobName: job.name } });
      const elapsedMs = state?.lastRunAt ? now.getTime() - state.lastRunAt.getTime() : Infinity;
      const due = options.forceAll || elapsedMs >= job.intervalMinutes * 60_000;

      if (!due) {
        skipped.push(job.name);
        continue;
      }

      try {
        const summary = await job.run(prisma, now);
        await prisma.jobState.upsert({
          where: { jobName: job.name },
          create: {
            jobName: job.name,
            lastRunAt: now,
            lastSuccessAt: now,
            lastStatus: 'OK',
            lastSummary: summary,
          },
          update: {
            lastRunAt: now,
            lastSuccessAt: now,
            lastStatus: 'OK',
            lastSummary: summary,
          },
        });
        executed.push({ jobName: job.name, status: 'ok', summary });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logError(`Cron job ${job.name} failed`, err);
        await prisma.jobState.upsert({
          where: { jobName: job.name },
          create: {
            jobName: job.name,
            lastRunAt: now,
            lastStatus: 'ERROR',
            lastSummary: msg.slice(0, 500),
          },
          update: {
            lastRunAt: now,
            lastStatus: 'ERROR',
            lastSummary: msg.slice(0, 500),
          },
        });
        executed.push({ jobName: job.name, status: 'error', summary: msg });
      }
    }

    logInfo('Cron tick completed', { executedCount: executed.length, skippedCount: skipped.length });
    return {
      ranAt: now.toISOString(),
      locked: false,
      executed,
      skipped,
    };
  } finally {
    await releaseCronLock(prisma, instanceId).catch(() => {});
  }
}
