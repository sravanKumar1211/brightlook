import { logger } from '../utils/logger.js';
import { AuditLogEntity } from '../entities/index.js';

/**
 * Append an audit event. Pass the transaction EntityManager as `exec` so the audit row
 * commits (or rolls back) together with the business change.
 */
export async function recordAudit(exec, ctx, entry) {
  const actor = entry.actor ?? ctx?.user ?? null;
  await exec.getRepository(AuditLogEntity).insert({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    actionType: entry.action,
    module: entry.module,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    projectId: entry.projectId ?? null,
    previousData: entry.previous ? logger.redact(entry.previous) : null,
    newData: entry.next ? logger.redact(entry.next) : null,
    description: entry.description ?? null,
    ipAddress: ctx?.ip ?? null,
    userAgent: ctx?.ua ?? null,
    requestId: ctx?.requestId ?? null,
  });
}
