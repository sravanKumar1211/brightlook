import { Router } from 'express';
import { csrfGuard } from '../middleware/auth.js';
import { driverName, pingDb } from '../config/database.js';
import { logger } from '../utils/logger.js';
import purgeRoutes from '../modules/purge/purge.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import usersRoutes from '../modules/users/users.routes.js';
import projectsRoutes from '../modules/projects/projects.routes.js';
import updatesRoutes from '../modules/updates/updates.routes.js';
import decisionsRoutes from '../modules/decisions/decisions.routes.js';
import approvalsRoutes from '../modules/approvals/approvals.routes.js';
import billsRoutes from '../modules/bills/bills.routes.js';
import paymentsRoutes from '../modules/payments/payments.routes.js';
import notificationsRoutes from '../modules/notifications/notifications.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import filesRoutes from '../modules/files/files.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';

export async function healthCheck(req, res) {
  if (req.query?.db !== '1' && req.query?.db !== 'true') {
    return res.json({ success: true, message: 'OK' });
  }
  try {
    await pingDb();
    return res.json({ success: true, message: 'OK', database: driverName(), connected: true });
  } catch (err) {
    logger.warn('health db check failed', { error: err?.message });
    return res.status(503).json({
      success: false,
      message: 'Database unavailable',
      database: driverName() || null,
      connected: false,
    });
  }
}

const router = Router();
router.use(csrfGuard);
router.get('/health', healthCheck);
router.use('/', purgeRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/projects', projectsRoutes);
router.use('/project-updates', updatesRoutes);
router.use('/decisions', decisionsRoutes);
router.use('/approvals', approvalsRoutes);
router.use('/bills', billsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/files', filesRoutes);
router.use('/', dashboardRoutes);
export default router;
