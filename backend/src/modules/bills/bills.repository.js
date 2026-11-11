import {
  VendorBillEntity,
  VendorBillVersionEntity,
  VendorBillAttachmentEntity,
  VendorBillReviewEntity,
  ProjectAssignmentEntity,
} from '../../entities/index.js';
import { offsetOf } from '../../utils/helpers.js';

export function insert(exec, b) {
  const repo = exec.getRepository(VendorBillEntity);
  return repo.save(repo.create({
    projectId: b.projectId,
    submittedBy: b.submittedBy,
    vendorName: b.vendorName,
    invoiceNumber: b.invoiceNumber,
    amount: b.amount,
    taxAmount: b.taxAmount ?? null,
    billDate: b.billDate,
    dueDate: b.dueDate ?? null,
    description: b.description ?? null,
    category: b.category,
    status: 'PENDING_ADMIN_REVIEW',
  }));
}

export function getRaw(exec, id, lock = false) {
  const qb = exec.getRepository(VendorBillEntity)
    .createQueryBuilder('b')
    .where('b.id = :id', { id });
  if (lock) qb.setLock('pessimistic_write');
  return qb.getOne();
}

export const insertVersion = (exec, billId, versionNo, fileId, amount, note, submittedBy) =>
  exec.getRepository(VendorBillVersionEntity).insert({
    billId,
    versionNo,
    fileId,
    amount,
    note: note ?? null,
    submittedBy,
  });

export const insertAttachment = (exec, billId, versionNo, fileId) =>
  exec.getRepository(VendorBillAttachmentEntity).insert({ billId, versionNo, fileId });

export const insertReview = (exec, billId, versionNo, actorId, action, comment, previousStatus, newStatus) =>
  exec.getRepository(VendorBillReviewEntity).insert({
    billId,
    versionNo,
    actorId,
    action,
    comment: comment ?? null,
    previousStatus,
    newStatus,
  });

export function setStatus(exec, id, status, extra = {}) {
  return exec.getRepository(VendorBillEntity)
    .createQueryBuilder()
    .update()
    .set({ status, ...extra, updatedAt: () => 'now()' })
    .where('id = :id', { id })
    .execute();
}

export async function updateFields(exec, id, f) {
  const patch = {};
  for (const k of ['vendorName', 'invoiceNumber', 'amount', 'taxAmount', 'billDate', 'dueDate', 'description', 'category']) {
    if (f[k] !== undefined) patch[k] = f[k];
  }
  if (!Object.keys(patch).length) return;
  await exec.getRepository(VendorBillEntity)
    .createQueryBuilder()
    .update()
    .set({ ...patch, updatedAt: () => 'now()' })
    .where('id = :id', { id })
    .execute();
}

async function hydrateBills(exec, bills) {
  if (!bills.length) return [];
  const ids = bills.map((b) => b.id);

  const [versionFiles, clarifications] = await Promise.all([
    exec.getRepository(VendorBillVersionEntity)
      .createQueryBuilder('v')
      .innerJoin('v.file', 'f')
      .select([
        'v.bill_id AS "billId"',
        'v.version_no AS "versionNo"',
        'f.id AS "fileId"',
        'f.original_name AS "fileName"',
      ])
      .where('v.bill_id IN (:...ids)', { ids })
      .getRawMany(),
    exec.getRepository(VendorBillReviewEntity)
      .createQueryBuilder('r')
      .select(['r.bill_id AS "billId"', 'r.comment AS comment'])
      .where('r.bill_id IN (:...ids) AND r.action = :act', { ids, act: 'REQUEST_CLARIFICATION' })
      .orderBy('r.createdAt', 'DESC')
      .getRawMany(),
  ]);

  const fileMap = new Map();
  for (const vf of versionFiles) {
    fileMap.set(`${vf.billId}:${vf.versionNo}`, { id: vf.fileId, name: vf.fileName });
  }
  const clarifMap = new Map();
  for (const c of clarifications) {
    if (!clarifMap.has(c.billId)) clarifMap.set(c.billId, c.comment);
  }

  return bills.map(({ project, submittedByUser, ...b }) => {
    const curFile = fileMap.get(`${b.id}:${b.currentVersion}`);
    return {
      ...b,
      projectName: project?.name ?? null,
      projectCode: project?.projectCode ?? null,
      submittedByName: submittedByUser?.fullName ?? null,
      currentFileId: curFile?.id ?? null,
      currentFileName: curFile?.name ?? null,
      lastClarification: clarifMap.get(b.id) ?? null,
    };
  });
}

export async function list(exec, { user, projectId, pmId, vendor, status, dateFrom, dateTo, minAmount, maxAmount, q, page, limit }) {
  const qb = exec.getRepository(VendorBillEntity).createQueryBuilder('b');
  if (user.role !== 'ADMIN') {
    qb.andWhere(
      (sub) => {
        const sq = sub.subQuery()
          .select('1')
          .from(ProjectAssignmentEntity, 'x')
          .where("x.project_id = b.project_id AND x.user_id = :authUserId AND x.assignment_role = 'PROJECT_MANAGER' AND x.is_active = true")
          .getQuery();
        return `EXISTS ${sq}`;
      },
      { authUserId: user.id },
    );
  }
  if (projectId) qb.andWhere('b.project_id = :projectId', { projectId });
  if (pmId) qb.andWhere('b.submitted_by = :pmId', { pmId });
  if (vendor) qb.andWhere('b.vendor_name ILIKE :vendor', { vendor: `%${vendor}%` });
  if (status) qb.andWhere('b.status = :status', { status });
  if (dateFrom) qb.andWhere('b.bill_date >= :dateFrom', { dateFrom });
  if (dateTo) qb.andWhere('b.bill_date <= :dateTo', { dateTo });
  if (minAmount !== undefined) qb.andWhere('b.amount >= :minAmount', { minAmount });
  if (maxAmount !== undefined) qb.andWhere('b.amount <= :maxAmount', { maxAmount });
  if (q) qb.andWhere('(b.invoice_number ILIKE :q OR b.vendor_name ILIKE :q)', { q: `%${q}%` });

  const total = await qb.getCount();
  const rows = await qb
    .withDeleted()
    .innerJoinAndSelect('b.project', 'p')
    .innerJoinAndSelect('b.submittedByUser', 'u')
    .addSelect("CASE WHEN b.status = 'PENDING_ADMIN_REVIEW' THEN 1 ELSE 0 END", 'is_pending')
    .orderBy('is_pending', 'DESC')
    .addOrderBy('b.createdAt', 'DESC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();

  return { rows: await hydrateBills(exec, rows), total };
}

export async function getDetail(exec, id) {
  const bill = await exec.getRepository(VendorBillEntity)
    .createQueryBuilder('b')
    .withDeleted()
    .innerJoinAndSelect('b.project', 'p')
    .innerJoinAndSelect('b.submittedByUser', 'u')
    .where('b.id = :id', { id })
    .getOne();
  if (!bill) return undefined;
  const [hydrated] = await hydrateBills(exec, [bill]);
  return hydrated;
}

export async function history(exec, id) {
  const [versionRows, attachmentRows, reviewRows] = await Promise.all([
    exec.getRepository(VendorBillVersionEntity)
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.file', 'f')
      .innerJoinAndSelect('v.submittedByUser', 'u')
      .where('v.bill_id = :id', { id })
      .orderBy('v.versionNo', 'ASC')
      .getMany(),
    exec.getRepository(VendorBillAttachmentEntity)
      .createQueryBuilder('a')
      .innerJoin('a.file', 'f2')
      .select([
        'a.version_no AS "versionNo"',
        'f2.id AS id',
        'f2.original_name AS name',
      ])
      .where('a.bill_id = :id', { id })
      .getRawMany(),
    exec.getRepository(VendorBillReviewEntity)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.actorUser', 'u')
      .where('r.bill_id = :id', { id })
      .orderBy('r.createdAt', 'ASC')
      .getMany(),
  ]);

  const attMap = new Map();
  for (const a of attachmentRows) {
    if (!attMap.has(a.versionNo)) attMap.set(a.versionNo, []);
    attMap.get(a.versionNo).push({ id: a.id, name: a.name });
  }

  const versions = versionRows.map((v) => ({
    versionNo: v.versionNo,
    amount: v.amount,
    note: v.note,
    createdAt: v.createdAt,
    fileId: v.fileId,
    fileName: v.file?.originalName ?? null,
    submittedByName: v.submittedByUser?.fullName ?? null,
    attachments: attMap.get(v.versionNo) ?? [],
  }));

  const reviews = reviewRows.map(({ actorUser, ...r }) => ({
    ...r,
    actorName: actorUser?.fullName ?? null,
  }));

  return { versions, reviews };
}
