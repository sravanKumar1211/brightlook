import { Router } from 'express';
import { z } from 'zod';
import { getRepo } from '../../config/database.js';
import { NotificationEntity } from '../../entities/index.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam, boolish, opt, pageQuery } from '../../validators/common.js';
import { asyncHandler, send, toCamel, pageMeta, offsetOf } from '../../utils/helpers.js';
import { notFound } from '../../utils/errors.js';

const router = Router();
router.use(authenticate);

router.get('/', validate({ query: z.object({ page: pageQuery.page, limit: pageQuery.limit, unread: opt(boolish) }) }),
  asyncHandler(async (req, res) => {
    const { page, limit, unread } = req.valid.query;
    const repo = getRepo(NotificationEntity);
    const qb = repo.createQueryBuilder('n').where('n.recipient_id = :userId', { userId: req.user.id });
    if (unread) qb.andWhere('n.is_read = false');

    const [total, unreadCount, rows] = await Promise.all([
      qb.getCount(),
      repo.countBy({ recipientId: req.user.id, isRead: false }),
      qb.orderBy('n.createdAt', 'DESC').limit(limit).offset(offsetOf(page, limit)).getMany(),
    ]);

    send(res, 'Notifications retrieved', rows, { ...pageMeta(page, limit, total), unreadCount });
  }));

// Declared before "/:id/read" so "read-all" is not captured as an id.
router.patch('/read-all', asyncHandler(async (req, res) => {
  await getRepo(NotificationEntity)
    .createQueryBuilder()
    .update()
    .set({ isRead: true })
    .where('recipient_id = :userId AND is_read = false', { userId: req.user.id })
    .execute();
  send(res, 'All notifications marked as read');
}));

router.patch('/:id/read', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const result = await getRepo(NotificationEntity)
    .createQueryBuilder()
    .update()
    .set({ isRead: true })
    .where('id = :id AND recipient_id = :userId', { id: req.valid.params.id, userId: req.user.id })
    .returning('*')
    .execute();
  if (!result.raw?.length) throw notFound('Notification');
  send(res, 'Notification marked as read', toCamel(result.raw[0]));
}));

export default router;
