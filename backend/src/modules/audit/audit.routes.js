import { Router } from 'express';
import { z } from 'zod';
import { getRepo } from '../../config/database.js';
import { AuditLogEntity } from '../../entities/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, uuid, dateStr, opt, pageQuery } from '../../validators/common.js';
import { asyncHandler, send, pageMeta, offsetOf } from '../../utils/helpers.js';
import { notFound } from '../../utils/errors.js';

const listQuery = z.object({
  ...pageQuery, userId: opt(uuid), projectId: opt(uuid), action: opt(z.string().max(80)), module: opt(z.string().max(40)),
  entityType: opt(z.string().max(60)), entityId: opt(uuid), from: opt(dateStr), to: opt(dateStr),
});

const shapeAudit = ({ actorUser, project, ...a }) => ({
  ...a,
  actorName: actorUser?.fullName ?? null,
  projectName: project?.name ?? null,
});

const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const { page, limit, q, userId, projectId, action, module, entityType, entityId, from, to } = req.valid.query;
  const qb = getRepo(AuditLogEntity).createQueryBuilder('a');
  if (userId) qb.andWhere('a.actor_user_id = :userId', { userId });
  if (projectId) qb.andWhere('a.project_id = :projectId', { projectId });
  if (action) qb.andWhere('a.action_type = :action', { action });
  if (module) qb.andWhere('a.module = :module', { module });
  if (entityType) qb.andWhere('a.entity_type = :entityType', { entityType });
  if (entityId) qb.andWhere('a.entity_id = :entityId', { entityId });
  if (from) qb.andWhere('a.created_at >= CAST(:from AS date)', { from });
  if (to) qb.andWhere('a.created_at < (CAST(:to AS date) + 1)', { to });
  if (q) qb.andWhere('a.description ILIKE :q', { q: `%${q}%` });

  const total = await qb.getCount();
  const rows = await qb
    .withDeleted()
    .leftJoinAndSelect('a.actorUser', 'u')
    .leftJoinAndSelect('a.project', 'p')
    .orderBy('a.createdAt', 'DESC')
    .addOrderBy('a.id', 'ASC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();

  send(res, 'Audit logs retrieved', rows.map(shapeAudit), pageMeta(page, limit, total));
}));

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const row = await getRepo(AuditLogEntity)
    .createQueryBuilder('a')
    .withDeleted()
    .leftJoinAndSelect('a.actorUser', 'u')
    .leftJoinAndSelect('a.project', 'p')
    .where('a.id = :id', { id: req.valid.params.id })
    .getOne();
  if (!row) throw notFound('Audit log');
  send(res, 'Audit log retrieved', shapeAudit(row));
}));

export default router;
