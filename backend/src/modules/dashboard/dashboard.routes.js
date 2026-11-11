import { Router } from 'express';
import { In } from 'typeorm';
import { getManager } from '../../config/database.js';
import {
  ProjectEntity,
  ApprovalRequestEntity,
  VendorBillEntity,
  UserEntity,
  CustomerPaymentEntity,
  DecisionRequestEntity,
  ProjectAssignmentEntity,
} from '../../entities/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { asyncHandler, send } from '../../utils/helpers.js';
import * as projectsRepo from '../projects/projects.repository.js';
import { shape } from '../projects/projects.service.js';

const router = Router();
router.use(authenticate);

router.get('/admin/dashboard', authorize('ADMIN'), asyncHandler(async (req, res) => {
  const exec = getManager();
  const [
    activeProjects,
    completedProjects,
    pendingApprovals,
    billsAwaitingReview,
    totalCustomers,
    totalProjectManagers,
    contractRow,
    receivedRow,
  ] = await Promise.all([
    exec.getRepository(ProjectEntity).countBy({
      status: In(['IN_PROGRESS', 'NOT_STARTED', 'PLANNED', 'ON_HOLD']),
    }),
    exec.getRepository(ProjectEntity).countBy({ status: 'COMPLETED' }),
    exec.getRepository(ApprovalRequestEntity).countBy({ status: 'PENDING' }),
    exec.getRepository(VendorBillEntity).countBy({
      status: In(['PENDING_ADMIN_REVIEW', 'RESUBMITTED']),
    }),
    exec.getRepository(UserEntity).countBy({ role: 'CUSTOMER', status: 'ACTIVE' }),
    exec.getRepository(UserEntity).countBy({ role: 'PROJECT_MANAGER', status: 'ACTIVE' }),
    exec.getRepository(ProjectEntity)
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.contract_amount), 0)', 'n')
      .where("p.status NOT IN ('CANCELLED', 'ARCHIVED')")
      .getRawOne(),
    exec.getRepository(CustomerPaymentEntity)
      .createQueryBuilder('cp')
      .innerJoin('cp.project', 'p')
      .select('COALESCE(SUM(cp.amount), 0)', 'n')
      .getRawOne(),
  ]);

  const totalContractValue = Number(contractRow?.n ?? 0);
  const paymentsReceived = Number(receivedRow?.n ?? 0);
  const outstandingReceivables = Math.max(0, Math.round((totalContractValue - paymentsReceived) * 100) / 100);

  send(res, 'Dashboard retrieved', {
    activeProjects,
    completedProjects,
    pendingApprovals,
    billsAwaitingReview,
    totalCustomers,
    totalProjectManagers,
    totalContractValue,
    paymentsReceived,
    outstandingReceivables,
  });
}));

router.get('/pm/dashboard', authorize('PROJECT_MANAGER'), asyncHandler(async (req, res) => {
  const exec = getManager();
  const [{ rows }, bills, recentBillsRaw] = await Promise.all([
    projectsRepo.list(exec, { user: req.user, page: 1, limit: 100 }),
    exec.getRepository(VendorBillEntity)
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)::int', 'n')
      .where(
        (sub) => {
          const sq = sub.subQuery()
            .select('1')
            .from(ProjectAssignmentEntity, 'x')
            .where("x.project_id = b.project_id AND x.user_id = :authUserId AND x.assignment_role = 'PROJECT_MANAGER' AND x.is_active = true")
            .getQuery();
          return `EXISTS ${sq}`;
        },
        { authUserId: req.user.id },
      )
      .groupBy('b.status')
      .getRawMany(),
    exec.getRepository(VendorBillEntity)
      .createQueryBuilder('b')
      .withDeleted()
      .innerJoin('b.project', 'p')
      .select([
        'b.id AS id',
        'b.invoice_number AS "invoiceNumber"',
        'b.vendor_name AS "vendorName"',
        'b.amount AS amount',
        'b.status AS status',
        'b.created_at AS "createdAt"',
        'p.name AS "projectName"',
      ])
      .where(
        (sub) => {
          const sq = sub.subQuery()
            .select('1')
            .from(ProjectAssignmentEntity, 'x')
            .where("x.project_id = b.project_id AND x.user_id = :authUserId AND x.assignment_role = 'PROJECT_MANAGER' AND x.is_active = true")
            .getQuery();
          return `EXISTS ${sq}`;
        },
        { authUserId: req.user.id },
      )
      .orderBy('b.created_at', 'DESC')
      .limit(6)
      .getRawMany(),
  ]);

  const recentBills = recentBillsRaw.map((b) => ({ ...b, amount: Number(b.amount) }));
  send(res, 'Dashboard retrieved', {
    projects: rows.map(shape),
    billCounts: Object.fromEntries(bills.map((b) => [b.status, b.n])),
    recentBills,
  });
}));

router.get('/customer/dashboard', authorize('CUSTOMER'), asyncHandler(async (req, res) => {
  const exec = getManager();
  const [{ rows }, pending] = await Promise.all([
    projectsRepo.list(exec, { user: req.user, page: 1, limit: 50 }),
    exec.getRepository(DecisionRequestEntity)
      .createQueryBuilder('d')
      .select([
        'd.id AS id',
        'd.title AS title',
        'd.project_id AS "projectId"',
        'd.deadline AS deadline',
      ])
      .where("d.status = 'PENDING_CUSTOMER'")
      .andWhere(
        (sub) => {
          const sq = sub.subQuery()
            .select('1')
            .from(ProjectAssignmentEntity, 'x')
            .where("x.project_id = d.project_id AND x.user_id = :authUserId AND x.assignment_role = 'CUSTOMER' AND x.is_active = true")
            .getQuery();
          return `EXISTS ${sq}`;
        },
        { authUserId: req.user.id },
      )
      .getRawMany(),
  ]);

  send(res, 'Dashboard retrieved', { projects: rows.map(shape), pendingDecisions: pending });
}));

export default router;
