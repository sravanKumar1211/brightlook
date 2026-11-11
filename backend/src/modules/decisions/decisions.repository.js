import {
  DecisionRequestEntity,
  DecisionOptionEntity,
  DecisionResponseEntity,
  DecisionFileEntity,
  DecisionHistoryEntity,
} from '../../entities/index.js';
import { offsetOf } from '../../utils/helpers.js';

export function insert(exec, d) {
  const repo = exec.getRepository(DecisionRequestEntity);
  return repo.save(repo.create({
    projectId: d.projectId,
    title: d.title,
    description: d.description ?? null,
    category: d.category ?? null,
    details: d.details ?? null,
    status: 'PENDING_CUSTOMER',
    requiresAdminApproval: !!d.requiresAdminApproval,
    requestedBy: d.requestedBy,
    deadline: d.deadline ?? null,
  }));
}

export const insertOption = (exec, decisionId, o, i) =>
  exec.getRepository(DecisionOptionEntity).insert({
    decisionId,
    label: o.label,
    description: o.description ?? null,
    priceNote: o.priceNote ?? null,
    additionalCharge: o.additionalCharge ?? null,
    sortOrder: i,
  });

export const linkFile = (exec, decisionId, fileId, responseId = null) =>
  exec.getRepository(DecisionFileEntity).insert({ decisionId, fileId, responseId });

export const addHistory = (exec, decisionId, fromStatus, toStatus, actorId, comment) =>
  exec.getRepository(DecisionHistoryEntity).insert({
    decisionId,
    fromStatus,
    toStatus,
    actorId,
    comment: comment ?? null,
  });

export const setStatus = (exec, id, status) =>
  exec.getRepository(DecisionRequestEntity)
    .createQueryBuilder()
    .update()
    .set({ status, updatedAt: () => 'now()' })
    .where('id = :id', { id })
    .execute();

export function getRaw(exec, id, lock = false) {
  const qb = exec.getRepository(DecisionRequestEntity)
    .createQueryBuilder('d')
    .where('d.id = :id', { id });
  if (lock) qb.setLock('pessimistic_write');
  return qb.getOne();
}

export function insertResponse(exec, decisionId, optionId, respondedBy, comment) {
  const repo = exec.getRepository(DecisionResponseEntity);
  return repo.save(repo.create({
    decisionId,
    optionId,
    respondedBy,
    comment: comment ?? null,
  }));
}

export async function expireOverdue(exec, projectId = null) {
  const qb = exec.getRepository(DecisionRequestEntity)
    .createQueryBuilder()
    .update()
    .set({ status: 'EXPIRED', updatedAt: () => 'now()' })
    .where("status = 'PENDING_CUSTOMER' AND deadline IS NOT NULL AND deadline < now()");
  if (projectId) qb.andWhere('project_id = :projectId', { projectId });
  const res = await qb.returning(['id']).execute();
  const expiredIds = (res.raw ?? []).map((r) => r.id).filter(Boolean);
  if (expiredIds.length) {
    await exec.getRepository(DecisionHistoryEntity).insert(
      expiredIds.map((decisionId) => ({
        decisionId,
        fromStatus: 'PENDING_CUSTOMER',
        toStatus: 'EXPIRED',
        actorId: null,
        comment: 'Deadline passed',
      })),
    );
  }
}

export async function listForProject(exec, projectId, { status, page, limit }) {
  const qb = exec.getRepository(DecisionRequestEntity)
    .createQueryBuilder('d')
    .where('d.project_id = :projectId', { projectId });
  if (status) qb.andWhere('d.status = :status', { status });

  const total = await qb.getCount();
  const decisions = await qb
    .innerJoinAndSelect('d.requestedByUser', 'u')
    .addSelect("CASE WHEN d.status = 'PENDING_CUSTOMER' THEN 1 ELSE 0 END", 'is_pending')
    .orderBy('is_pending', 'DESC')
    .addOrderBy('d.createdAt', 'DESC')
    .limit(limit)
    .offset(offsetOf(page, limit))
    .getMany();

  if (!decisions.length) return { rows: [], total };

  const ids = decisions.map((d) => d.id);
  const [optionRows, fileRows, responseRows] = await Promise.all([
    exec.getRepository(DecisionOptionEntity)
      .createQueryBuilder('o')
      .where('o.decision_id IN (:...ids)', { ids })
      .orderBy('o.sortOrder', 'ASC')
      .getMany(),
    exec.getRepository(DecisionFileEntity)
      .createQueryBuilder('df')
      .innerJoin('df.file', 'f')
      .select([
        'df.decision_id AS "decisionId"',
        'f.id AS id',
        'f.original_name AS name',
        'f.mime_type AS "mimeType"',
        'f.external_url AS url',
      ])
      .where('df.decision_id IN (:...ids) AND df.response_id IS NULL', { ids })
      .getRawMany(),
    exec.getRepository(DecisionResponseEntity)
      .createQueryBuilder('r')
      .innerJoin('r.option', 'o')
      .innerJoin('r.respondedByUser', 'ru')
      .select([
        'r.decision_id AS "decisionId"',
        'r.option_id AS "optionId"',
        'o.label AS "optionLabel"',
        'r.comment AS comment',
        'r.created_at AS "respondedAt"',
        'ru.full_name AS "respondedBy"',
      ])
      .where('r.decision_id IN (:...ids)', { ids })
      .orderBy('r.created_at', 'DESC')
      .getRawMany(),
  ]);

  const optionsMap = new Map();
  for (const o of optionRows) {
    if (!optionsMap.has(o.decisionId)) optionsMap.set(o.decisionId, []);
    optionsMap.get(o.decisionId).push({
      id: o.id,
      label: o.label,
      description: o.description,
      priceNote: o.priceNote,
      additionalCharge: o.additionalCharge,
    });
  }

  const filesMap = new Map();
  for (const f of fileRows) {
    if (!filesMap.has(f.decisionId)) filesMap.set(f.decisionId, []);
    filesMap.get(f.decisionId).push({ id: f.id, name: f.name, mimeType: f.mimeType, url: f.url ?? null });
  }

  const latestResponseMap = new Map();
  for (const r of responseRows) {
    if (!latestResponseMap.has(r.decisionId)) {
      latestResponseMap.set(r.decisionId, {
        optionId: r.optionId,
        optionLabel: r.optionLabel,
        comment: r.comment,
        respondedAt: r.respondedAt,
        respondedBy: r.respondedBy,
      });
    }
  }

  const rows = decisions.map(({ requestedByUser, ...d }) => ({
    ...d,
    requestedByName: requestedByUser?.fullName ?? null,
    options: optionsMap.get(d.id) ?? [],
    files: filesMap.get(d.id) ?? [],
    latestResponse: latestResponseMap.get(d.id) ?? null,
  }));

  return { rows, total };
}

export async function getDetail(exec, id) {
  const decision = await exec.getRepository(DecisionRequestEntity)
    .createQueryBuilder('d')
    .withDeleted()
    .innerJoinAndSelect('d.requestedByUser', 'u')
    .innerJoinAndSelect('d.project', 'p')
    .where('d.id = :id', { id })
    .getOne();
  if (!decision) return null;

  const { requestedByUser, project, ...d } = decision;

  const [options, responsesRaw, files, historyRaw] = await Promise.all([
    exec.getRepository(DecisionOptionEntity).find({
      where: { decisionId: id },
      order: { sortOrder: 'ASC' },
    }),
    exec.getRepository(DecisionResponseEntity)
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.option', 'o')
      .innerJoinAndSelect('r.respondedByUser', 'u')
      .where('r.decision_id = :id', { id })
      .orderBy('r.createdAt', 'ASC')
      .getMany(),
    exec.getRepository(DecisionFileEntity)
      .createQueryBuilder('df')
      .innerJoin('df.file', 'f')
      .select([
        'f.id AS id',
        'f.original_name AS name',
        'f.mime_type AS "mimeType"',
        'f.external_url AS url',
      ])
      .where('df.decision_id = :id AND df.response_id IS NULL', { id })
      .getRawMany(),
    exec.getRepository(DecisionHistoryEntity)
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.actorUser', 'u')
      .where('h.decision_id = :id', { id })
      .orderBy('h.createdAt', 'ASC')
      .getMany(),
  ]);

  const respFilesMap = new Map();
  if (responsesRaw.length) {
    const respIds = responsesRaw.map((r) => r.id);
    const respFiles = await exec.getRepository(DecisionFileEntity)
      .createQueryBuilder('df')
      .innerJoin('df.file', 'f')
      .select([
        'df.response_id AS "responseId"',
        'f.id AS id',
        'f.original_name AS name',
        'f.mime_type AS "mimeType"',
        'f.external_url AS url',
      ])
      .where('df.response_id IN (:...respIds)', { respIds })
      .getRawMany();
    for (const f of respFiles) {
      if (!respFilesMap.has(f.responseId)) respFilesMap.set(f.responseId, []);
      respFilesMap.get(f.responseId).push({ id: f.id, name: f.name, mimeType: f.mimeType, url: f.url ?? null });
    }
  }

  const responses = responsesRaw.map(({ option, respondedByUser, ...r }) => ({
    ...r,
    optionLabel: option?.label ?? null,
    respondedByName: respondedByUser?.fullName ?? null,
    files: respFilesMap.get(r.id) ?? [],
  }));

  const history = historyRaw.map(({ actorUser, ...h }) => ({
    ...h,
    actorName: actorUser?.fullName ?? null,
  }));

  return {
    ...d,
    requestedByName: requestedByUser?.fullName ?? null,
    projectName: project?.name ?? null,
    options,
    responses,
    files,
    history,
  };
}
