import { getManager, withTx } from '../../config/database.js';
import { CustomerPaymentEntity, ProjectEntity, ProjectAssignmentEntity } from '../../entities/index.js';
import { AppError, notFound } from '../../utils/errors.js';
import { pageMeta, paymentSummary, round2, offsetOf } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, projectUserIds } from '../../services/notification.service.js';
import { buildInvoiceDocx, splitGst } from '../../services/invoiceDocx.service.js';
import { saveUploadedFile } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';

const shapeRow = ({ recordedByUser, project, ...cp }) => ({
  ...cp,
  recordedByName: recordedByUser?.fullName ?? null,
  projectName: project?.name ?? null,
});

async function netReceived(exec, projectId) {
  const row = await exec.getRepository(CustomerPaymentEntity)
    .createQueryBuilder('cp')
    .select('COALESCE(SUM(cp.amount), 0)', 'n')
    .where('cp.project_id = :projectId', { projectId })
    .getRawOne();
  return Number(row?.n ?? 0);
}

export async function summaryFor(exec, projectId, contractAmount) {
  return paymentSummary(contractAmount, await netReceived(exec, projectId));
}

/** Records an advance/installment/milestone/final payment or a refund. Serialised per project via row lock. */
export async function recordPayment(ctx, projectId, body, receipt) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const project = await tx.getRepository(ProjectEntity)
      .createQueryBuilder('p')
      .withDeleted()
      .where('p.id = :projectId', { projectId })
      .setLock('pessimistic_write')
      .getOne();

    const received = await netReceived(tx, projectId);
    const isRefund = body.entryType === 'REFUND';
    if (isRefund && body.amount > received) throw new AppError(409, 'Refund exceeds the net amount received');
    if (!isRefund && round2(received + body.amount) > Number(project.contractAmount)) {
      throw new AppError(409, `Payment exceeds the outstanding amount (₹${round2(project.contractAmount - received)})`);
    }
    const file = receipt
      ? await saveUploadedFile(tx, receipt, {
        category: 'payments',
        uploadedBy: ctx.user.id,
        projectId,
        allowedPrefixes: ['image/', 'application/pdf'],
        invalidTypeMessage: 'Only PDF or image documents (JPEG, PNG, WebP) are allowed for receipts',
      })
      : null;
    let invoiceNumber = null;
    if (!isRefund) {
      // Numbered per project (project row is locked above, so concurrent payments cannot collide).
      const year = Number(body.paymentDate.slice(0, 4));
      const code = project.projectCode.split('-').pop();
      const seqRow = await tx.getRepository(CustomerPaymentEntity)
        .createQueryBuilder('cp')
        .select("COALESCE(MAX(split_part(cp.invoice_number, '/', 4)::int), 0) + 1", 'n')
        .where('cp.project_id = :projectId AND cp.invoice_number IS NOT NULL', { projectId })
        .getRawOne();
      invoiceNumber = `BLH/${year}/${code}/${String(seqRow.n).padStart(3, '0')}`;
    }
    const invoiceDescription = isRefund ? null : (body.invoiceDescription || `${project.name} - ${body.paymentType.toLowerCase()} payment`);
    const payRepo = tx.getRepository(CustomerPaymentEntity);
    const payment = await payRepo.save(payRepo.create({
      projectId,
      entryType: isRefund ? 'REFUND' : 'PAYMENT',
      paymentType: isRefund ? null : body.paymentType,
      amount: isRefund ? -body.amount : body.amount,
      paymentMethod: body.paymentMethod,
      paymentDate: body.paymentDate,
      referenceNumber: body.referenceNumber,
      receiptFileId: file?.id ?? null,
      notes: body.notes ?? null,
      recordedBy: ctx.user.id,
      invoiceNumber,
      invoiceDescription,
    }));
    await recordAudit(tx, ctx, { action: isRefund ? 'REFUND_RECORDED' : 'PAYMENT_RECORDED', module: 'PAYMENTS', entityType: 'customer_payment', entityId: payment.id, projectId, next: { amount: payment.amount, method: payment.paymentMethod, reference: payment.referenceNumber, paymentType: payment.paymentType, invoiceNumber }, description: `${isRefund ? 'Refund' : 'Payment'} of ₹${body.amount} recorded` });
    await notify(tx, { recipientIds: [...(await projectUserIds(tx, projectId, 'CUSTOMER')), ...(await projectUserIds(tx, projectId, 'PROJECT_MANAGER'))], projectId, type: 'PAYMENT_RECORDED', title: isRefund ? 'A refund was recorded' : 'A payment was recorded', message: `₹${body.amount} (${body.referenceNumber})`, entityType: 'customer_payment', entityId: payment.id });
    return { payment, summary: await summaryFor(tx, projectId, project.contractAmount) };
  });
}

export async function listForProject(user, projectId, { page, limit }) {
  const exec = getManager();
  const project = await requireProjectAccess(exec, user, projectId);
  const qb = exec.getRepository(CustomerPaymentEntity)
    .createQueryBuilder('cp')
    .where('cp.project_id = :projectId', { projectId });
  const total = await qb.getCount();
  const rows = await qb
    .withDeleted()
    .innerJoinAndSelect('cp.recordedByUser', 'u')
    .innerJoinAndSelect('cp.project', 'p')
    .orderBy('cp.paymentDate', 'DESC')
    .addOrderBy('cp.createdAt', 'DESC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();
  return {
    data: rows.map(shapeRow),
    meta: { ...pageMeta(page, limit, total), summary: await summaryFor(exec, projectId, project.contractAmount) },
  };
}

export async function listAll({ projectId, method, entryType, dateFrom, dateTo, q, page, limit }) {
  const qb = getManager().getRepository(CustomerPaymentEntity)
    .createQueryBuilder('cp')
    .withDeleted()
    .innerJoinAndSelect('cp.project', 'p')
    .innerJoinAndSelect('cp.recordedByUser', 'u');

  if (projectId) qb.andWhere('cp.project_id = :projectId', { projectId });
  if (method) qb.andWhere('cp.payment_method = :method', { method });
  if (entryType) qb.andWhere('cp.entry_type = :entryType', { entryType });
  if (dateFrom) qb.andWhere('cp.payment_date >= :dateFrom', { dateFrom });
  if (dateTo) qb.andWhere('cp.payment_date <= :dateTo', { dateTo });
  if (q) qb.andWhere('(cp.reference_number ILIKE :q OR p.name ILIKE :q)', { q: `%${q}%` });

  const total = await qb.getCount();
  const rows = await qb
    .orderBy('cp.paymentDate', 'DESC')
    .addOrderBy('cp.createdAt', 'DESC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();
  return { data: rows.map(shapeRow), meta: pageMeta(page, limit, total) };
}

export async function getPayment(user, id) {
  const exec = getManager();
  const row = await exec.getRepository(CustomerPaymentEntity)
    .createQueryBuilder('cp')
    .withDeleted()
    .innerJoinAndSelect('cp.recordedByUser', 'u')
    .innerJoinAndSelect('cp.project', 'p')
    .where('cp.id = :id', { id })
    .getOne();
  if (!row) throw notFound('Payment');
  await requireProjectAccess(exec, user, row.projectId);
  return shapeRow(row);
}

/** Builds the tax-invoice Word document for a customer payment (admin, or the assigned customer). */
export async function getInvoiceDocx(user, id) {
  const exec = getManager();
  const row = await exec.getRepository(CustomerPaymentEntity)
    .createQueryBuilder('cp')
    .withDeleted()
    .innerJoinAndSelect('cp.project', 'p')
    .where('cp.id = :id', { id })
    .getOne();
  if (!row || !row.invoiceNumber) throw notFound('Invoice');
  await requireProjectAccess(exec, user, row.projectId);
  const customers = await exec.getRepository(ProjectAssignmentEntity)
    .createQueryBuilder('pa')
    .innerJoin('pa.user', 'u')
    .select('u.full_name', 'fullName')
    .where("pa.project_id = :projectId AND pa.assignment_role = 'CUSTOMER' AND pa.is_active = true", { projectId: row.projectId })
    .orderBy('pa.assignedAt', 'ASC')
    .getRawMany();
  const buffer = await buildInvoiceDocx({
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.paymentDate,
    clientName: customers.map((c) => c.fullName).join(' & ') || '—',
    projectAddress: row.project?.location,
    description: row.invoiceDescription || row.project?.name,
    ...splitGst(row.amount),
  });
  return { buffer, invoiceNumber: row.invoiceNumber };
}
