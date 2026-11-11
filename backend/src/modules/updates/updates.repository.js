import { ProjectUpdateEntity, ProjectUpdateFileEntity } from '../../entities/index.js';
import { offsetOf } from '../../utils/helpers.js';

export function insert(exec, u) {
  const repo = exec.getRepository(ProjectUpdateEntity);
  return repo.save(repo.create({
    projectId: u.projectId,
    createdBy: u.createdBy,
    updateType: u.type,
    title: u.title ?? null,
    description: u.description ?? null,
    progressPercentage: u.progressPercentage ?? null,
    workCompleted: u.workCompleted ?? null,
    workRemaining: u.workRemaining ?? null,
    materialName: u.materialName ?? null,
    quantity: u.quantity ?? null,
    unit: u.unit ?? null,
    supplier: u.supplier ?? null,
    deliveryStatus: u.deliveryStatus ?? null,
    deliveryDate: u.deliveryDate ?? null,
    decisionRequestId: u.decisionRequestId ?? null,
    stageId: u.stageId ?? null,
    overallAfter: u.overallAfter ?? null,
  }));
}

export const linkFile = (exec, updateId, fileId, kind) =>
  exec.getRepository(ProjectUpdateFileEntity).insert({ updateId, fileId, kind });

async function hydrateUpdates(exec, updates) {
  if (!updates.length) return [];
  const ids = updates.map((u) => u.id);
  const fileRows = await exec.getRepository(ProjectUpdateFileEntity)
    .createQueryBuilder('x')
    .innerJoin('x.file', 'f')
    .select([
      'x.update_id AS "updateId"',
      'f.id AS id',
      'f.original_name AS name',
      'f.mime_type AS "mimeType"',
      'f.external_url AS url',
      'x.kind AS kind',
    ])
    .where('x.update_id IN (:...ids)', { ids })
    .getRawMany();

  const filesMap = new Map();
  for (const r of fileRows) {
    if (!filesMap.has(r.updateId)) filesMap.set(r.updateId, []);
    filesMap.get(r.updateId).push({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      kind: r.kind,
      url: r.url ?? null,
    });
  }

  return updates.map(({ createdByUser, stage, decisionRequest, ...pu }) => ({
    ...pu,
    createdByName: createdByUser?.fullName ?? null,
    stageName: stage?.name ?? null,
    files: filesMap.get(pu.id) ?? [],
    decision: decisionRequest
      ? { id: decisionRequest.id, title: decisionRequest.title, status: decisionRequest.status }
      : null,
  }));
}

export async function list(exec, projectId, { type, page, limit }) {
  const qb = exec.getRepository(ProjectUpdateEntity)
    .createQueryBuilder('pu')
    .where('pu.project_id = :projectId', { projectId });
  if (type) qb.andWhere('pu.update_type = :type', { type });

  const total = await qb.getCount();
  const rows = await qb
    .leftJoinAndSelect('pu.createdByUser', 'u')
    .leftJoinAndSelect('pu.stage', 's')
    .leftJoinAndSelect('pu.decisionRequest', 'd')
    .orderBy('pu.updateDate', 'DESC')
    .addOrderBy('pu.id', 'ASC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();

  return { rows: await hydrateUpdates(exec, rows), total };
}

export async function getById(exec, id) {
  const row = await exec.getRepository(ProjectUpdateEntity)
    .createQueryBuilder('pu')
    .leftJoinAndSelect('pu.createdByUser', 'u')
    .leftJoinAndSelect('pu.stage', 's')
    .leftJoinAndSelect('pu.decisionRequest', 'd')
    .where('pu.id = :id', { id })
    .getOne();
  if (!row) return undefined;
  const [hydrated] = await hydrateUpdates(exec, [row]);
  return hydrated;
}

export function updateText(exec, id, { title, description }) {
  const patch = { updatedAt: () => 'now()' };
  if (title !== undefined && title !== null) patch.title = title;
  if (description !== undefined && description !== null) patch.description = description;
  return exec.getRepository(ProjectUpdateEntity)
    .createQueryBuilder()
    .update()
    .set(patch)
    .where('id = :id', { id })
    .execute();
}
