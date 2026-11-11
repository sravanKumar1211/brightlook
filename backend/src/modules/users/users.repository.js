import { UserEntity, ProjectAssignmentEntity, AuditLogEntity } from '../../entities/index.js';
import { offsetOf } from '../../utils/helpers.js';

const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

const pickPublic = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

export async function insert(exec, u) {
  const repo = exec.getRepository(UserEntity);
  const saved = await repo.save(repo.create({
    username: u.username,
    fullName: u.fullName,
    email: u.email ?? null,
    phone: u.phone ?? null,
    passwordHash: u.passwordHash,
    role: u.role,
    status: u.status ?? 'ACTIVE',
    createdBy: u.createdBy,
  }));
  return pickPublic(saved);
}

export const findById = (exec, id) =>
  exec.getRepository(UserEntity).findOne({ select: USER_SELECT, where: { id } });

export async function list(exec, { q, role, status, page, limit }) {
  const qb = exec.getRepository(UserEntity).createQueryBuilder('u');
  if (q) qb.andWhere('(u.full_name ILIKE :q OR u.username ILIKE :q OR u.email ILIKE :q)', { q: `%${q}%` });
  if (role) qb.andWhere('u.role = :role', { role });
  if (status) qb.andWhere('u.status = :status', { status });

  const total = await qb.getCount();
  const rows = await qb
    .select(['u.id', 'u.username', 'u.fullName', 'u.email', 'u.phone', 'u.role', 'u.status', 'u.lastLoginAt', 'u.createdAt', 'u.updatedAt'])
    .orderBy('u.createdAt', 'DESC')
    .skip(offsetOf(page, limit))
    .take(limit)
    .getMany();

  if (!rows.length) return { rows: [], total };

  const countRows = await exec.getRepository(ProjectAssignmentEntity)
    .createQueryBuilder('pa')
    .innerJoin('pa.project', 'p')
    .select('pa.user_id', 'userId')
    .addSelect('COUNT(*)::int', 'n')
    .where('pa.user_id IN (:...ids) AND pa.is_active = true', { ids: rows.map((r) => r.id) })
    .groupBy('pa.user_id')
    .getRawMany();
  const countMap = new Map(countRows.map((c) => [c.userId, c.n]));

  return {
    rows: rows.map((u) => ({ ...u, projectCount: countMap.get(u.id) ?? 0 })),
    total,
  };
}

export async function update(exec, id, fields, updatedBy) {
  const patch = {};
  for (const k of ['fullName', 'email', 'phone', 'role', 'status', 'passwordHash']) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  if (!Object.keys(patch).length) return findById(exec, id);
  await exec.getRepository(UserEntity).update(id, { ...patch, updatedBy });
  return findById(exec, id);
}

export const userAssignments = (exec, userId) =>
  exec.getRepository(ProjectAssignmentEntity)
    .createQueryBuilder('pa')
    .innerJoin('pa.project', 'p')
    .select([
      'pa.id AS id',
      'pa.project_id AS "projectId"',
      'pa.assignment_role AS "assignmentRole"',
      'p.name AS "projectName"',
      'p.project_code AS "projectCode"',
    ])
    .where('pa.user_id = :userId AND pa.is_active = true', { userId })
    .orderBy('pa.assigned_at', 'DESC')
    .getRawMany();

export const recentActivity = (exec, userId) =>
  exec.getRepository(AuditLogEntity).find({
    select: { id: true, actionType: true, module: true, description: true, createdAt: true },
    where: { actorUserId: userId },
    order: { createdAt: 'DESC' },
    take: 25,
  });
