import { In } from 'typeorm';
import {
  ProjectEntity,
  ProjectAssignmentEntity,
  ProjectProgressHistoryEntity,
  CustomerPaymentEntity,
  VendorBillEntity,
  DecisionRequestEntity,
  ApprovalRequestEntity,
  FileEntity,
} from '../../entities/index.js';
import { offsetOf } from '../../utils/helpers.js';

const SORTS = {
  created_at: 'p.createdAt',
  name: 'p.name',
  overall_progress: 'p.overallProgress',
  status: 'p.status',
};

async function hydrateProjects(exec, projects) {
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);

  const coverIds = [...new Set(projects.map((p) => p.coverImageFileId).filter(Boolean))];
  const [paymentRows, decisionRows, approvalRows, assignmentRows, coverRows] = await Promise.all([
    exec.getRepository(CustomerPaymentEntity)
      .createQueryBuilder('cp')
      .select('cp.project_id', 'projectId')
      .addSelect('COALESCE(SUM(cp.amount), 0)', 'totalReceived')
      .where('cp.project_id IN (:...ids)', { ids })
      .groupBy('cp.project_id')
      .getRawMany(),
    exec.getRepository(DecisionRequestEntity)
      .createQueryBuilder('d')
      .select('d.project_id', 'projectId')
      .addSelect('COUNT(*)::int', 'n')
      .where('d.project_id IN (:...ids) AND d.status = :st', { ids, st: 'PENDING_CUSTOMER' })
      .groupBy('d.project_id')
      .getRawMany(),
    exec.getRepository(ApprovalRequestEntity)
      .createQueryBuilder('a')
      .select('a.project_id', 'projectId')
      .addSelect('COUNT(*)::int', 'n')
      .where('a.project_id IN (:...ids) AND a.status = :st', { ids, st: 'PENDING' })
      .groupBy('a.project_id')
      .getRawMany(),
    exec.getRepository(ProjectAssignmentEntity)
      .createQueryBuilder('pa')
      .innerJoin('pa.user', 'u')
      .select([
        'pa.project_id AS "projectId"',
        'pa.assignment_role AS "assignmentRole"',
        'u.id AS id',
        'u.full_name AS "fullName"',
      ])
      .where('pa.project_id IN (:...ids) AND pa.is_active = true', { ids })
      .orderBy('u.full_name', 'ASC')
      .getRawMany(),
    coverIds.length
      ? exec.getRepository(FileEntity).find({
        select: { id: true, externalUrl: true },
        where: { id: In(coverIds) },
      })
      : [],
  ]);

  const receivedMap = new Map(paymentRows.map((r) => [r.projectId, Number(r.totalReceived)]));
  const decisionMap = new Map(decisionRows.map((r) => [r.projectId, r.n]));
  const approvalMap = new Map(approvalRows.map((r) => [r.projectId, r.n]));
  const coverUrlMap = new Map(coverRows.map((c) => [c.id, c.externalUrl ?? null]));
  const pmsMap = new Map();
  const customersMap = new Map();

  for (const r of assignmentRows) {
    const target = r.assignmentRole === 'PROJECT_MANAGER' ? pmsMap : customersMap;
    if (!target.has(r.projectId)) target.set(r.projectId, []);
    target.get(r.projectId).push({ id: r.id, fullName: r.fullName });
  }

  return projects.map((p) => ({
    ...p,
    coverImageUrl: coverUrlMap.get(p.coverImageFileId) ?? null,
    totalReceived: receivedMap.get(p.id) ?? 0,
    pendingDecisions: decisionMap.get(p.id) ?? 0,
    pendingApprovals: approvalMap.get(p.id) ?? 0,
    projectManagers: pmsMap.get(p.id) ?? [],
    customers: customersMap.get(p.id) ?? [],
  }));
}

export async function list(exec, { user, q, status, pmId, customerId, page, limit, sort = 'created_at', order = 'desc' }) {
  const qb = exec.getRepository(ProjectEntity).createQueryBuilder('p');
  if (user.role !== 'ADMIN') {
    qb.andWhere(
      (sub) => {
        const sq = sub.subQuery()
          .select('1')
          .from(ProjectAssignmentEntity, 'x')
          .where('x.project_id = p.id AND x.user_id = :authUserId AND x.assignment_role = :authRole AND x.is_active = true')
          .getQuery();
        return `EXISTS ${sq}`;
      },
      { authUserId: user.id, authRole: user.role },
    );
  }
  if (q) {
    qb.andWhere('(p.name ILIKE :q OR p.project_code ILIKE :q OR p.location ILIKE :q)', { q: `%${q}%` });
  }
  if (status) qb.andWhere('p.status = :status', { status });
  if (pmId) {
    qb.andWhere(
      (sub) => {
        const sq = sub.subQuery()
          .select('1')
          .from(ProjectAssignmentEntity, 'x')
          .where("x.project_id = p.id AND x.user_id = :filterPmId AND x.assignment_role = 'PROJECT_MANAGER' AND x.is_active = true")
          .getQuery();
        return `EXISTS ${sq}`;
      },
      { filterPmId: pmId },
    );
  }
  if (customerId) {
    qb.andWhere(
      (sub) => {
        const sq = sub.subQuery()
          .select('1')
          .from(ProjectAssignmentEntity, 'x')
          .where("x.project_id = p.id AND x.user_id = :filterCustId AND x.assignment_role = 'CUSTOMER' AND x.is_active = true")
          .getQuery();
        return `EXISTS ${sq}`;
      },
      { filterCustId: customerId },
    );
  }

  const total = await qb.getCount();
  const rows = await qb
    .orderBy(SORTS[sort] ?? SORTS.created_at, order === 'asc' ? 'ASC' : 'DESC')
    .addOrderBy('p.id', 'ASC')
    .skip(offsetOf(page, limit))
    .take(limit)
    .getMany();

  return { rows: await hydrateProjects(exec, rows), total };
}

export async function getById(exec, id) {
  const project = await exec.getRepository(ProjectEntity).findOne({
    where: { id },
    withDeleted: true,
  });
  if (!project) return undefined;
  const [hydrated] = await hydrateProjects(exec, [project]);
  return hydrated;
}

export async function nextCode(exec) {
  const row = await exec.createQueryBuilder()
    .select("nextval('project_code_seq')", 'n')
    .from('pg_database', 'd')
    .where('d.datname = current_database()')
    .getRawOne();
  return `BLH-${new Date().getFullYear()}-${row.n}`;
}

export function insert(exec, p) {
  const repo = exec.getRepository(ProjectEntity);
  return repo.save(repo.create({
    projectCode: p.code,
    name: p.name,
    description: p.description ?? null,
    location: p.location,
    projectType: p.projectType,
    contractAmount: p.contractAmount ?? 0,
    startDate: p.startDate ?? null,
    expectedCompletionDate: p.expectedCompletionDate ?? null,
    overallProgress: p.overallProgress ?? 0,
    status: p.status ?? 'PLANNED',
    createdBy: p.createdBy,
    updatedBy: p.createdBy,
  }));
}

export async function update(exec, id, fields, updatedBy) {
  const patch = {};
  for (const k of [
    'name', 'description', 'location', 'projectType', 'contractAmount',
    'startDate', 'expectedCompletionDate', 'actualCompletionDate',
    'overallProgress', 'status', 'coverImageFileId',
  ]) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  if (!Object.keys(patch).length) return null;
  const repo = exec.getRepository(ProjectEntity);
  await repo.createQueryBuilder()
    .update()
    .set({ ...patch, updatedBy })
    .where('id = :id AND deleted_at IS NULL', { id })
    .execute();
  return repo.findOneBy({ id });
}

export const insertProgressHistory = (exec, projectId, previous, next, userId, note) =>
  exec.getRepository(ProjectProgressHistoryEntity).insert({
    projectId,
    previousProgress: previous,
    newProgress: next,
    changedBy: userId,
    note: note ?? null,
  });

export async function hasProtectedHistory(exec, id) {
  const [hasPay, hasBill] = await Promise.all([
    exec.getRepository(CustomerPaymentEntity).existsBy({ projectId: id }),
    exec.getRepository(VendorBillEntity).existsBy({ projectId: id }),
  ]);
  return hasPay || hasBill;
}

export const softDelete = (exec, id) =>
  exec.getRepository(ProjectEntity).softDelete(id);

export const progressHistory = (exec, id) =>
  exec.getRepository(ProjectProgressHistoryEntity)
    .createQueryBuilder('h')
    .leftJoin('h.changedByUser', 'u')
    .select([
      'h.id AS id',
      'h.project_id AS "projectId"',
      'h.previous_progress AS "previousProgress"',
      'h.new_progress AS "newProgress"',
      'h.changed_by AS "changedBy"',
      'h.note AS note',
      'h.created_at AS "createdAt"',
      'u.full_name AS "changedByName"',
    ])
    .where('h.project_id = :id', { id })
    .orderBy('h.created_at', 'DESC')
    .limit(50)
    .getRawMany();
