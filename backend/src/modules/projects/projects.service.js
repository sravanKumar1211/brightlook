import { getManager, withTx } from '../../config/database.js';
import { ProjectStageEntity } from '../../entities/index.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, pageMeta, paymentSummary } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { saveUploadedFile } from '../../services/fileStorage.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as repo from './projects.repository.js';
import * as assignments from './assignments.service.js';
import { createInitialStages, reflowFromStart } from '../stages/stages.service.js';

export function shape(row) {
  const { totalReceived, ...rest } = toCamel(row);
  return { ...rest, payment: paymentSummary(rest.contractAmount, totalReceived) };
}

export async function listProjects(user, query) {
  const { rows, total } = await repo.list(getManager(), { user, ...query });
  return { data: rows.map(shape), meta: pageMeta(query.page, query.limit, total) };
}

export async function getProject(user, id) {
  const mgr = getManager();
  await requireProjectAccess(mgr, user, id);
  const row = await repo.getById(mgr, id);
  return { ...shape(row), progressHistory: toCamel(await repo.progressHistory(mgr, id)) };
}

async function applyCover(tx, ctx, projectId, coverFile) {
  if (!coverFile) return undefined;
  const file = await saveUploadedFile(tx, coverFile, {
    category: 'projects',
    uploadedBy: ctx.user.id,
    projectId,
    allowedPrefixes: ['image/'],
    invalidTypeMessage: 'Cover must be an image (JPEG, PNG or WebP)',
  });
  return file.id;
}

export async function createProject(ctx, body, coverFile) {
  return withTx(async (tx) => {
    const { projectManagerIds = [], customerIds = [], stages, ...fields } = body;
    const project = await repo.insert(tx, { ...fields, code: await repo.nextCode(tx), createdBy: ctx.user.id });
    const coverId = await applyCover(tx, ctx, project.id, coverFile);
    if (coverId) await repo.update(tx, project.id, { coverImageFileId: coverId }, ctx.user.id);
    await repo.insertProgressHistory(tx, project.id, null, project.overallProgress, ctx.user.id, 'Initial progress');
    await assignments.syncAssignments(tx, ctx, project.id, 'PROJECT_MANAGER', projectManagerIds);
    await assignments.syncAssignments(tx, ctx, project.id, 'CUSTOMER', customerIds);
    if (stages?.length) await createInitialStages(tx, ctx, project, stages);
    await recordAudit(tx, ctx, { action: 'PROJECT_CREATED', module: 'PROJECTS', entityType: 'project', entityId: project.id, projectId: project.id, next: { name: project.name, code: project.projectCode, contractAmount: project.contractAmount, status: project.status }, description: `Project ${project.name} created` });
    return shape(await repo.getById(tx, project.id));
  });
}

export async function updateProject(ctx, id, body, coverFile) {
  return withTx(async (tx) => {
    const before = await repo.getById(tx, id);
    if (!before || before.deletedAt) throw notFound('Project');
    const { projectManagerIds, customerIds, stages: ignored, ...fields } = body;
    const stageCount = await tx.getRepository(ProjectStageEntity).countBy({ projectId: id });
    if (stageCount > 0) { delete fields.overallProgress; delete fields.expectedCompletionDate; } // both are driven by the stage plan
    const coverId = await applyCover(tx, ctx, id, coverFile);
    if (coverId) fields.coverImageFileId = coverId;
    if (fields.status === 'COMPLETED' && !before.actualCompletionDate) fields.actualCompletionDate = new Date().toISOString().slice(0, 10);
    await repo.update(tx, id, fields, ctx.user.id);
    if (stageCount > 0 && fields.startDate && fields.startDate !== before.startDate) await reflowFromStart(tx, id, fields.startDate);
    if (fields.overallProgress !== undefined && fields.overallProgress !== before.overallProgress) {
      await repo.insertProgressHistory(tx, id, before.overallProgress, fields.overallProgress, ctx.user.id, 'Updated by admin');
    }
    if (projectManagerIds) await assignments.syncAssignments(tx, ctx, id, 'PROJECT_MANAGER', projectManagerIds);
    if (customerIds) await assignments.syncAssignments(tx, ctx, id, 'CUSTOMER', customerIds);
    const after = await repo.getById(tx, id);
    const pick = (p) => ({ name: p.name, location: p.location, projectType: p.projectType, contractAmount: p.contractAmount, status: p.status, overallProgress: p.overallProgress, startDate: p.startDate, expectedCompletionDate: p.expectedCompletionDate });
    await recordAudit(tx, ctx, {
      action: fields.status && fields.status !== before.status ? 'PROJECT_STATUS_CHANGED' : 'PROJECT_UPDATED',
      module: 'PROJECTS', entityType: 'project', entityId: id, projectId: id, previous: pick(before), next: pick(after),
      description: `Project ${after.name} updated`,
    });
    return shape(after);
  });
}

export async function deleteProject(ctx, id) {
  return withTx(async (tx) => {
    const project = await repo.getById(tx, id);
    if (!project || project.deletedAt) throw notFound('Project');
    if (await repo.hasProtectedHistory(tx, id)) {
      throw new AppError(409, 'This project has payments or bills and cannot be deleted. Archive it instead.');
    }
    await repo.softDelete(tx, id);
    await recordAudit(tx, ctx, { action: 'PROJECT_DELETED', module: 'PROJECTS', entityType: 'project', entityId: id, projectId: id, previous: { name: project.name, status: project.status }, description: `Project ${project.name} soft-deleted` });
  });
}

export async function addAssignment(ctx, projectId, { userId, assignmentRole }) {
  return withTx(async (tx) => {
    const project = await repo.getById(tx, projectId);
    if (!project || project.deletedAt) throw notFound('Project');
    await assignments.assignUser(tx, ctx, projectId, userId, assignmentRole);
    return toCamel(await assignments.listAssignments(tx, projectId));
  });
}

export const removeAssignment = (ctx, projectId, assignmentId) =>
  withTx((tx) => assignments.unassignUser(tx, ctx, projectId, assignmentId));

export async function getAssignments(user, projectId) {
  const mgr = getManager();
  await requireProjectAccess(mgr, user, projectId);
  return toCamel(await assignments.listAssignments(mgr, projectId));
}
