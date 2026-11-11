import { UserEntity, ProjectAssignmentEntity } from '../../entities/index.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';

const ROLE_FOR = { PROJECT_MANAGER: 'PROJECT_MANAGER', CUSTOMER: 'CUSTOMER' };

/** Assign a user to a project. Role of the user must match the assignment role. Idempotent. */
export async function assignUser(tx, ctx, projectId, userId, assignmentRole) {
  if (!ROLE_FOR[assignmentRole]) throw badRequest('Invalid assignment role');
  const user = await tx.getRepository(UserEntity).findOne({
    select: { id: true, role: true, status: true, fullName: true },
    where: { id: userId },
  });
  if (!user) throw notFound('User');
  if (user.role !== assignmentRole) throw badRequest(`${user.fullName} is not a ${assignmentRole.replace('_', ' ').toLowerCase()}`);
  if (user.status !== 'ACTIVE') throw badRequest(`${user.fullName} is inactive`);

  const paRepo = tx.getRepository(ProjectAssignmentEntity);
  const exists = await paRepo.existsBy({ projectId, userId, assignmentRole, isActive: true });
  if (exists) return false;

  await paRepo.insert({ projectId, userId, assignmentRole, assignedBy: ctx.user.id });
  await recordAudit(tx, ctx, {
    action: 'PROJECT_USER_ASSIGNED',
    module: 'PROJECTS',
    entityType: 'project',
    entityId: projectId,
    projectId,
    next: { userId, assignmentRole },
    description: `${user.fullName} assigned as ${assignmentRole}`,
  });
  await notify(tx, {
    recipientIds: [userId],
    projectId,
    type: 'PROJECT_ASSIGNED',
    title: 'You were assigned to a project',
    entityType: 'project',
    entityId: projectId,
  });
  return true;
}

export async function unassignUser(tx, ctx, projectId, assignmentId) {
  const paRepo = tx.getRepository(ProjectAssignmentEntity);
  const row = await paRepo.findOne({ where: { id: assignmentId, projectId, isActive: true } });
  if (!row) throw notFound('Assignment');
  await paRepo.update(row.id, { isActive: false, unassignedAt: () => 'now()' });
  await recordAudit(tx, ctx, {
    action: 'PROJECT_USER_UNASSIGNED',
    module: 'PROJECTS',
    entityType: 'project',
    entityId: projectId,
    projectId,
    previous: { userId: row.userId, assignmentRole: row.assignmentRole },
    description: 'Project access removed',
  });
}

/** Make the active set of users for a role exactly `userIds`. */
export async function syncAssignments(tx, ctx, projectId, assignmentRole, userIds) {
  const rows = await tx.getRepository(ProjectAssignmentEntity).find({
    select: { id: true, userId: true },
    where: { projectId, assignmentRole, isActive: true },
  });
  const wanted = new Set(userIds);
  for (const r of rows) if (!wanted.has(r.userId)) await unassignUser(tx, ctx, projectId, r.id);
  for (const id of wanted) await assignUser(tx, ctx, projectId, id, assignmentRole);
}

export const listAssignments = (exec, projectId) =>
  exec.getRepository(ProjectAssignmentEntity)
    .createQueryBuilder('pa')
    .innerJoin('pa.user', 'u')
    .select([
      'pa.id AS id',
      'pa.user_id AS "userId"',
      'pa.assignment_role AS "assignmentRole"',
      'pa.assigned_at AS "assignedAt"',
      'u.full_name AS "fullName"',
      'u.username AS username',
      'u.email AS email',
    ])
    .where('pa.project_id = :projectId AND pa.is_active = true', { projectId })
    .orderBy('pa.assignment_role', 'ASC')
    .addOrderBy('u.full_name', 'ASC')
    .getRawMany();
