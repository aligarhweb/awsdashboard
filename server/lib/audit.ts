import { db } from '../db';
import { logError } from './logger';

interface AuditInput {
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary.slice(0, 500),
        metadata: (input.metadata ?? undefined) as any,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    logError('Failed to write audit log', err, { action: input.action });
  }
}
