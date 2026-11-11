import { NotificationEntity, ProjectAssignmentEntity, UserEntity } from '../entities/index.js';

// In-app notifications. Email/WhatsApp can later subscribe here without touching callers.

export async function notify(exec, { recipientIds, projectId = null, type, title, message = null, entityType = null, entityId = null, excludeUserId = null }) {
  const ids = [...new Set(recipientIds)].filter((id) => id && id !== excludeUserId);
  if (!ids.length) return;
  await exec.getRepository(NotificationEntity).insert(
    ids.map((recipientId) => ({
      recipientId,
      projectId,
      notificationType: type,
      title,
      message,
      entityType,
      entityId,
    })),
  );
}

export async function adminIds(exec) {
  const rows = await exec.getRepository(UserEntity).find({
    select: { id: true },
    where: { role: 'ADMIN', status: 'ACTIVE' },
  });
  return rows.map((r) => r.id);
}

export async function projectUserIds(exec, projectId, assignmentRole) {
  const rows = await exec.getRepository(ProjectAssignmentEntity).find({
    select: { userId: true },
    where: { projectId, assignmentRole, isActive: true },
  });
  return rows.map((r) => r.userId);
}
