import { ApprovalRequestEntity, ApprovalActionEntity } from '../../entities/index.js';
import { offsetOf } from '../../utils/helpers.js';

export function create(exec, a) {
  const repo = exec.getRepository(ApprovalRequestEntity);
  return repo.save(repo.create({
    projectId: a.projectId,
    requesterId: a.requesterId,
    approvalType: a.type,
    entityType: a.entityType,
    entityId: a.entityId,
    title: a.title,
    summary: a.summary ?? null,
  }));
}

export const findOpenByEntity = (exec, entityType, entityId) =>
  exec.getRepository(ApprovalRequestEntity)
    .createQueryBuilder('a')
    .where('a.entity_type = :entityType AND a.entity_id = :entityId', { entityType, entityId })
    .orderBy('a.requestedAt', 'DESC')
    .setLock('pessimistic_write')
    .limit(1)
    .getOne();

/** Move the approval linked to an entity to a new status and log the action. No-op if none exists. */
export async function transitionForEntity(exec, { entityType, entityId, status, actorId, action, comment }) {
  const a = await findOpenByEntity(exec, entityType, entityId);
  if (!a) return null;
  const resolved = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(status);
  await exec.getRepository(ApprovalRequestEntity)
    .createQueryBuilder()
    .update()
    .set({
      status,
      resolvedAt: resolved ? () => 'now()' : null,
    })
    .where('id = :id', { id: a.id })
    .execute();
  await exec.getRepository(ApprovalActionEntity).insert({
    approvalId: a.id,
    actorId,
    action,
    comment: comment ?? null,
    previousStatus: a.status,
    newStatus: status,
  });
  return a;
}

export async function list(exec, { status, type, projectId, page, limit }) {
  const qb = exec.getRepository(ApprovalRequestEntity).createQueryBuilder('a');
  if (status) qb.andWhere('a.status = :status', { status });
  if (type) qb.andWhere('a.approval_type = :type', { type });
  if (projectId) qb.andWhere('a.project_id = :projectId', { projectId });

  const total = await qb.getCount();
  const rowsRaw = await qb
    .withDeleted()
    .innerJoinAndSelect('a.project', 'p')
    .innerJoinAndSelect('a.requester', 'u')
    .addSelect("CASE WHEN a.status = 'PENDING' THEN 1 ELSE 0 END", 'is_pending')
    .orderBy('is_pending', 'DESC')
    .addOrderBy('a.requestedAt', 'DESC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();

  const rows = rowsRaw.map(({ project, requester, ...a }) => ({
    ...a,
    projectName: project?.name ?? null,
    requesterName: requester?.fullName ?? null,
  }));
  return { rows, total };
}

export async function getDetail(exec, id) {
  const row = await exec.getRepository(ApprovalRequestEntity)
    .createQueryBuilder('a')
    .withDeleted()
    .innerJoinAndSelect('a.project', 'p')
    .innerJoinAndSelect('a.requester', 'u')
    .where('a.id = :id', { id })
    .getOne();
  if (!row) return null;

  const actionsRaw = await exec.getRepository(ApprovalActionEntity)
    .createQueryBuilder('x')
    .leftJoinAndSelect('x.actorUser', 'u')
    .where('x.approval_id = :id', { id })
    .orderBy('x.createdAt', 'ASC')
    .getMany();

  const { project, requester, ...a } = row;
  const actions = actionsRaw.map(({ actorUser, ...x }) => ({
    ...x,
    actorName: actorUser?.fullName ?? null,
  }));

  return {
    ...a,
    projectName: project?.name ?? null,
    requesterName: requester?.fullName ?? null,
    actions,
  };
}
