import { PrismaClient } from '@prisma/client';
import { createPreviewPrismaClient } from './previewStore';
import { normalizeMysqlUrl } from './lib/dbUrl';
import { logInfo, logWarn } from './lib/logger';

let activeClient: PrismaClient = createPreviewPrismaClient() as PrismaClient;
let mode: 'mysql' | 'preview-local' = 'preview-local';
let initialized = false;

export function getDatabaseMode(): 'mysql' | 'preview-local' {
  return mode;
}

export async function initDatabase(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const rawDbUrl = process.env.DATABASE_URL?.trim();
  if (!rawDbUrl) {
    logInfo('DATABASE_URL not configured — running in local preview store mode (.preview-data/db.json)');
    activeClient = createPreviewPrismaClient() as PrismaClient;
    mode = 'preview-local';
    return;
  }

  const normalized = normalizeMysqlUrl(rawDbUrl);
  if (!normalized.ok || !normalized.url) {
    logWarn(`DATABASE_URL is invalid (${normalized.reason}); using local preview store`);
    activeClient = createPreviewPrismaClient() as PrismaClient;
    mode = 'preview-local';
    return;
  }

  const candidate = new PrismaClient({
    datasources: {
      db: { url: normalized.url },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  try {
    await candidate.$queryRaw`SELECT 1`;
    activeClient = candidate;
    mode = 'mysql';
    logInfo('Database connected in MySQL mode via Prisma');
  } catch (err: any) {
    await candidate.$disconnect().catch(() => {});
    const isProduction = process.env.NODE_ENV === 'production';
    const isCloudRunPreview = Boolean(process.env.K_SERVICE || process.env.AIS_APP_ID);

    if (!isProduction || isCloudRunPreview) {
      logWarn(
        'MySQL server unreachable in preview environment; using local preview store (.preview-data/db.json)',
        { detail: String(err?.message || '').split('\n').pop()?.slice(0, 180) }
      );
      activeClient = createPreviewPrismaClient() as PrismaClient;
      mode = 'preview-local';
      return;
    }

    // In real Hostinger production, keep the MySQL client so health/errors surface clearly
    activeClient = candidate;
    mode = 'mysql';
    logWarn('MySQL connection failed during startup in production', {
      detail: String(err?.message || '').split('\n').pop()?.slice(0, 180),
    });
  }
}

// Proxy delegates all property access to the initialized activeClient
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const val = (activeClient as any)[prop];
    return typeof val === 'function' ? val.bind(activeClient) : val;
  },
});
