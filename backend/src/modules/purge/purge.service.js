import { In } from 'typeorm';
import { withTx } from '../../config/database.js';
import {
  ProjectEntity,
  ProjectUpdateEntity,
  ProjectUpdateFileEntity,
  ProjectEventEntity,
  ProjectStageDelayEntity,
  ProjectStageEntity,
  ProjectProgressHistoryEntity,
  ProjectAssignmentEntity,
  DecisionRequestEntity,
  DecisionOptionEntity,
  DecisionResponseEntity,
  DecisionFileEntity,
  DecisionHistoryEntity,
  ApprovalRequestEntity,
  ApprovalActionEntity,
  VendorBillEntity,
  VendorBillVersionEntity,
  VendorBillAttachmentEntity,
  VendorBillReviewEntity,
  CustomerPaymentEntity,
  NotificationEntity,
  FileEntity,
  UserEntity,
} from '../../entities/index.js';
import { AppError, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { storage } from '../../services/fileStorage.service.js';

// Permanent (hard) deletes. Admin-only; callers must send confirm:"DELETE".
// The audit trail is kept (audit_logs has no foreign keys) and records what was destroyed.

async function removeFiles(files) {
  for (const f of files) await storage.removeFile(f).catch(() => { });
}

export async function purgeProject(ctx, id) {
  let filesToRemove = [];
  await withTx(async (tx) => {
    const project = await tx.getRepository(ProjectEntity)
      .createQueryBuilder('p')
      .withDeleted()
      .where('p.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!project) throw notFound('Project');

    const updates = await tx.getRepository(ProjectUpdateEntity).countBy({ projectId: id });
    const decisions = await tx.getRepository(DecisionRequestEntity).countBy({ projectId: id });
    const bills = await tx.getRepository(VendorBillEntity).countBy({ projectId: id });
    const payments = await tx.getRepository(CustomerPaymentEntity).countBy({ projectId: id });
    const netRow = await tx.getRepository(CustomerPaymentEntity)
      .createQueryBuilder('cp')
      .select('COALESCE(SUM(cp.amount), 0)', 'n')
      .where('cp.project_id = :id', { id })
      .getRawOne();
    const netReceived = Number(netRow?.n ?? 0);
    const counts = { updates, decisions, bills, payments, netReceived };

    filesToRemove = await tx.getRepository(FileEntity).find({
      select: { id: true, relativePath: true, storedName: true, storageProvider: true, resourceType: true, mimeType: true },
      where: { projectId: id },
    });

    const updateRows = await tx.getRepository(ProjectUpdateEntity).find({ select: { id: true }, where: { projectId: id } });
    if (updateRows.length) {
      await tx.getRepository(ProjectUpdateFileEntity).delete({ updateId: In(updateRows.map((r) => r.id)) });
    }
    await tx.getRepository(ProjectUpdateEntity).delete({ projectId: id });
    await tx.getRepository(ProjectEventEntity).delete({ projectId: id });
    await tx.getRepository(ProjectStageDelayEntity).delete({ projectId: id });
    await tx.getRepository(ProjectStageEntity).delete({ projectId: id });

    const decisionRows = await tx.getRepository(DecisionRequestEntity).find({ select: { id: true }, where: { projectId: id } });
    if (decisionRows.length) {
      const decisionIds = decisionRows.map((r) => r.id);
      await tx.getRepository(DecisionFileEntity).delete({ decisionId: In(decisionIds) });
      await tx.getRepository(DecisionHistoryEntity).delete({ decisionId: In(decisionIds) });
      await tx.getRepository(DecisionResponseEntity).delete({ decisionId: In(decisionIds) });
      await tx.getRepository(DecisionOptionEntity).delete({ decisionId: In(decisionIds) });
    }
    await tx.getRepository(DecisionRequestEntity).delete({ projectId: id });

    const approvalRows = await tx.getRepository(ApprovalRequestEntity).find({ select: { id: true }, where: { projectId: id } });
    if (approvalRows.length) {
      await tx.getRepository(ApprovalActionEntity).delete({ approvalId: In(approvalRows.map((r) => r.id)) });
    }
    await tx.getRepository(ApprovalRequestEntity).delete({ projectId: id });

    const billRows = await tx.getRepository(VendorBillEntity).find({ select: { id: true }, where: { projectId: id } });
    if (billRows.length) {
      const billIds = billRows.map((r) => r.id);
      await tx.getRepository(VendorBillReviewEntity).delete({ billId: In(billIds) });
      await tx.getRepository(VendorBillAttachmentEntity).delete({ billId: In(billIds) });
      await tx.getRepository(VendorBillVersionEntity).delete({ billId: In(billIds) });
    }
    await tx.getRepository(VendorBillEntity).delete({ projectId: id });
    await tx.getRepository(CustomerPaymentEntity).delete({ projectId: id });
    await tx.getRepository(NotificationEntity).delete({ projectId: id });
    await tx.getRepository(ProjectProgressHistoryEntity).delete({ projectId: id });
    await tx.getRepository(ProjectAssignmentEntity).delete({ projectId: id });
    await tx.getRepository(ProjectEntity).delete(id);
    await tx.getRepository(FileEntity).delete({ projectId: id });

    await recordAudit(tx, ctx, {
      action: 'PROJECT_HARD_DELETED', module: 'PROJECTS', entityType: 'project', entityId: id, projectId: id,
      previous: { name: project.name, code: project.projectCode, status: project.status, contractAmount: project.contractAmount, ...counts },
      description: `Project ${project.name} permanently deleted`
    });
  });
  await removeFiles(filesToRemove);
}

export async function purgeBill(ctx, id) {
  let filesToRemove = [];
  await withTx(async (tx) => {
    const bill = await tx.getRepository(VendorBillEntity)
      .createQueryBuilder('b')
      .where('b.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!bill) throw notFound('Bill');

    const [versionFiles, attachFiles] = await Promise.all([
      tx.getRepository(VendorBillVersionEntity).find({ select: { fileId: true }, where: { billId: id } }),
      tx.getRepository(VendorBillAttachmentEntity).find({ select: { fileId: true }, where: { billId: id } }),
    ]);
    const fileIds = [...new Set([...versionFiles.map((v) => v.fileId), ...attachFiles.map((a) => a.fileId)])];
    filesToRemove = fileIds.length
      ? await tx.getRepository(FileEntity).find({
        select: { id: true, relativePath: true, storedName: true, storageProvider: true, resourceType: true, mimeType: true },
        where: { id: In(fileIds) },
      })
      : [];

    const approvalRows = await tx.getRepository(ApprovalRequestEntity).find({
      select: { id: true },
      where: { entityType: 'vendor_bill', entityId: id },
    });
    if (approvalRows.length) {
      await tx.getRepository(ApprovalActionEntity).delete({ approvalId: In(approvalRows.map((r) => r.id)) });
    }
    await tx.getRepository(ApprovalRequestEntity).delete({ entityType: 'vendor_bill', entityId: id });
    await tx.getRepository(VendorBillReviewEntity).delete({ billId: id });
    await tx.getRepository(VendorBillAttachmentEntity).delete({ billId: id });
    await tx.getRepository(VendorBillVersionEntity).delete({ billId: id });
    await tx.getRepository(VendorBillEntity).delete(id);
    if (fileIds.length) await tx.getRepository(FileEntity).delete({ id: In(fileIds) });
    await tx.getRepository(NotificationEntity).delete({ entityType: 'vendor_bill', entityId: id });

    await recordAudit(tx, ctx, {
      action: 'BILL_HARD_DELETED', module: 'BILLS', entityType: 'vendor_bill', entityId: id, projectId: bill.projectId,
      previous: { invoiceNumber: bill.invoiceNumber, vendor: bill.vendorName, amount: bill.amount, status: bill.status, versions: bill.currentVersion },
      description: `Bill ${bill.invoiceNumber} permanently deleted`
    });
  });
  await removeFiles(filesToRemove);
}

export async function purgeUpdate(ctx, id) {
  let filesToRemove = [];
  await withTx(async (tx) => {
    const u = await tx.getRepository(ProjectUpdateEntity)
      .createQueryBuilder('pu')
      .where('pu.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!u) throw notFound('Update');

    const updateFiles = await tx.getRepository(ProjectUpdateFileEntity)
      .createQueryBuilder('x')
      .innerJoinAndSelect('x.file', 'f')
      .where('x.update_id = :id', { id })
      .getMany();
    filesToRemove = updateFiles.map((x) => x.file);

    await tx.getRepository(ProjectUpdateFileEntity).delete({ updateId: id });
    await tx.getRepository(ProjectUpdateEntity).delete(id);
    if (filesToRemove.length) await tx.getRepository(FileEntity).delete({ id: In(filesToRemove.map((f) => f.id)) });
    await tx.getRepository(NotificationEntity).delete({ entityType: 'project_update', entityId: id });

    await recordAudit(tx, ctx, {
      action: 'UPDATE_HARD_DELETED', module: 'UPDATES', entityType: 'project_update', entityId: id, projectId: u.projectId,
      previous: { type: u.updateType, title: u.title, description: u.description, progress: u.progressPercentage },
      description: 'Project update permanently deleted (project progress value is unchanged)'
    });
  });
  await removeFiles(filesToRemove);
}

export async function purgeUser(ctx, id) {
  if (id === ctx.user.id) throw new AppError(409, 'You cannot delete your own account');
  try {
    await withTx(async (tx) => {
      const u = await tx.getRepository(UserEntity)
        .createQueryBuilder('u')
        .where('u.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();
      if (!u) throw notFound('User');
      await tx.getRepository(NotificationEntity).delete({ recipientId: id });
      await tx.getRepository(ProjectAssignmentEntity).delete({ userId: id });
      await tx.getRepository(UserEntity).delete(id); // refresh tokens cascade
      await recordAudit(tx, ctx, {
        action: 'USER_HARD_DELETED', module: 'USERS', entityType: 'user', entityId: id,
        previous: { username: u.username, fullName: u.fullName, role: u.role }, description: `User ${u.username} permanently deleted`
      });
    });
  } catch (err) {
    const pgErr = err?.code ? err : err?.driverError;
    if (pgErr?.code === '23503') {
      throw new AppError(409, 'This user has created records (projects, updates, bills, payments…) that must keep their author. Deactivate the account instead.');
    }
    throw err;
  }
}
