import { getManager, withTx } from '../../config/database.js';
import {
  ProjectEntity,
  ProjectStageEntity,
  ProjectStageDelayEntity,
  ProjectEventEntity,
} from '../../entities/index.js';
import { AppError, notFound } from '../../utils/errors.js';
import { toCamel, round2 } from '../../utils/helpers.js';
import { recordAudit } from '../../services/auditLog.service.js';
import { notify, projectUserIds } from '../../services/notification.service.js';
import { requireProjectAccess } from '../../services/projectAccess.js';
import * as projectsRepo from '../projects/projects.repository.js';

export const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/**
 * Stage i starts (previous stage end + 1 day) + startOffsetDays: 0 = right after, negative = overlaps the previous
 * stage, positive = a gap. The first stage always starts on the project start date. `floor` is the earliest allowed start.
 */
export function schedule(startDate, items, floor = startDate) {
  let cursor = startDate;
  return items.map((it, i) => {
    const startOffsetDays = i === 0 ? 0 : Number(it.startOffsetDays ?? 0);
    const plannedStart = addDays(cursor, startOffsetDays);
    if (plannedStart < floor) throw new AppError(400, `Stage "${it.name ?? i + 1}" would start before the project start date`);
    const plannedEnd = addDays(plannedStart, it.durationDays - 1);
    cursor = addDays(plannedEnd, 1);
    return { ...it, startOffsetDays, plannedStart, plannedEnd };
  });
}

/** Overall progress = Σ stage weight × stage completion. Weights total 100%, so the result is 0–100. */
export const overallFrom = (stages) =>
  round2(stages.reduce((sum, s) => sum + (Number(s.weightPercent) * Number(s.completionPercent)) / 100, 0));

/** On time vs delayed for one stage, relative to its (current) deadline and its baseline. */
export function stageTiming(s, today) {
  if (s.status === 'COMPLETED' && s.actualEnd) {
    const late = diffDays(s.plannedEnd, s.actualEnd);
    if (late > 0) return { state: 'COMPLETED_LATE', days: late };
    return late < 0 ? { state: 'COMPLETED_EARLY', days: -late } : { state: 'COMPLETED_ON_TIME', days: 0 };
  }
  if (today > s.plannedEnd) return { state: 'OVERDUE', days: diffDays(s.plannedEnd, today) };
  if (s.baselineEnd && s.plannedEnd > s.baselineEnd) return { state: 'EXTENDED', days: diffDays(s.baselineEnd, s.plannedEnd) };
  return { state: 'ON_TRACK', days: 0 };
}

export const listRaw = (exec, projectId) =>
  exec.getRepository(ProjectStageEntity).find({
    where: { projectId },
    order: { sortOrder: 'ASC', createdAt: 'ASC' },
  });

export function validatePlan(items) {
  const total = round2(items.reduce((a, s) => a + Number(s.weightPercent), 0));
  if (items.length && Math.abs(total - 100) > 0.01) throw new AppError(400, `Stage percentages must add up to 100% (currently ${total}%)`);
}

const summarise = (rows) => rows.map((s) => ({ name: s.name, weight: Number(s.weightPercent), days: s.durationDays, offset: s.startOffsetDays, start: s.plannedStart, end: s.plannedEnd }));
const maxOf = (rows, key) => rows.reduce((m, s) => (s[key] && s[key] > m ? s[key] : m), '');

/** Stages + computed timing + delay log + schedule summary: the one shape every stage endpoint returns. */
export async function describeStages(exec, projectId) {
  const rows = await listRaw(exec, projectId);
  const today = localToday();
  const timings = rows.map((r) => stageTiming(r, today));
  const delays = await exec.getRepository(ProjectStageDelayEntity)
    .createQueryBuilder('d')
    .leftJoin('d.createdByUser', 'u')
    .select([
      'd.id AS id',
      'd.project_id AS "projectId"',
      'd.stage_id AS "stageId"',
      'd.stage_name AS "stageName"',
      'd.cause_stage_id AS "causeStageId"',
      'd.cause_stage_name AS "causeStageName"',
      'd.kind AS kind',
      'd.days AS days',
      'd.previous_end AS "previousEnd"',
      'd.new_end AS "newEnd"',
      'd.reason AS reason',
      'd.created_by AS "createdBy"',
      'd.created_at AS "createdAt"',
      'u.full_name AS "createdByName"',
    ])
    .where('d.project_id = :projectId', { projectId })
    .orderBy('d.created_at', 'DESC')
    .addOrderBy('d.id', 'ASC')
    .getRawMany();
  const plannedCompletion = maxOf(rows, 'plannedEnd');
  const baselineCompletion = maxOf(rows.map((r) => ({ ...r, baselineEnd: r.baselineEnd ?? r.plannedEnd })), 'baselineEnd');
  const slipDays = rows.length ? Math.max(0, diffDays(baselineCompletion, plannedCompletion)) : 0;
  const overdueStages = timings.filter((t) => t.state === 'OVERDUE').length;
  return {
    stages: rows.map((r, i) => ({ ...toCamel(r), timing: timings[i] })),
    delays: toCamel(delays),
    overallProgress: overallFrom(rows),
    schedule: {
      state: slipDays > 0 || overdueStages > 0 ? 'DELAYED' : 'ON_SCHEDULE',
      slipDays, overdueStages, completedLate: timings.filter((t) => t.state === 'COMPLETED_LATE').length,
      baselineCompletion: baselineCompletion || null, plannedCompletion: plannedCompletion || null,
    },
  };
}

async function setProjectProgress(tx, ctx, project, overall, note) {
  const patch = {};
  if (Number(project.overallProgress) !== overall) patch.overallProgress = overall;
  if (['PLANNED', 'NOT_STARTED'].includes(project.status) && overall > 0) patch.status = 'IN_PROGRESS';
  if (Object.keys(patch).length) await projectsRepo.update(tx, project.id, patch, ctx.user.id);
  if (patch.overallProgress !== undefined) await projectsRepo.insertProgressHistory(tx, project.id, project.overallProgress, overall, ctx.user.id, note);
}

/** Project completion = the latest stage end (stages may overlap, so it is not necessarily the last one). */
async function syncCompletionDate(tx, projectId) {
  const row = await tx.getRepository(ProjectStageEntity)
    .createQueryBuilder('s')
    .select('MAX(s.planned_end)', 'maxEnd')
    .where('s.project_id = :projectId', { projectId })
    .getRawOne();
  if (row?.maxEnd) {
    await tx.getRepository(ProjectEntity).update(projectId, { expectedCompletionDate: row.maxEnd });
  }
}

export async function listStages(user, projectId) {
  const mgr = getManager();
  await requireProjectAccess(mgr, user, projectId);
  return describeStages(mgr, projectId);
}

const insertStage = (tx, projectId, s, order) =>
  tx.getRepository(ProjectStageEntity).insert({
    projectId,
    name: s.name,
    weightPercent: s.weightPercent,
    durationDays: s.durationDays,
    sortOrder: order,
    plannedStart: s.plannedStart,
    plannedEnd: s.plannedEnd,
    startOffsetDays: s.startOffsetDays,
    baselineStart: s.plannedStart,
    baselineEnd: s.plannedEnd,
  });

/** Used during project creation (inside its transaction). */
export async function createInitialStages(tx, ctx, project, items) {
  validatePlan(items);
  if (!project.startDate) throw new AppError(400, 'Set a project start date to schedule the construction stages');
  const planned = schedule(project.startDate, items);
  let i = 0;
  for (const s of planned) await insertStage(tx, project.id, s, i++);
  await tx.getRepository(ProjectEntity).update(project.id, { overallProgress: 0 });
  await syncCompletionDate(tx, project.id);
  await recordAudit(tx, ctx, { action: 'STAGES_PLAN_CREATED', module: 'PROJECTS', entityType: 'project', entityId: project.id, projectId: project.id,
    next: { stages: planned.map((s) => ({ name: s.name, weight: s.weightPercent, days: s.durationDays, offset: s.startOffsetDays, start: s.plannedStart, end: s.plannedEnd })) }, description: `Construction plan created with ${planned.length} stages` });
}

const lockActiveProject = (tx, projectId) =>
  tx.getRepository(ProjectEntity)
    .createQueryBuilder('p')
    .setLock('pessimistic_write')
    .where('p.id = :projectId', { projectId })
    .getOne();

/** Replace the whole plan (add / remove / reorder / edit stages). Existing stages keep their progress; the baseline is reset. */
export async function replaceStages(ctx, projectId, items) {
  validatePlan(items);
  return withTx(async (tx) => {
    const project = await lockActiveProject(tx, projectId);
    if (!project) throw notFound('Project');
    if (items.length && !project.startDate) throw new AppError(400, 'Set a project start date first');
    const before = await listRaw(tx, projectId);
    const known = new Set(before.map((s) => s.id));
    if (items.some((s) => s.id && !known.has(s.id))) throw new AppError(400, 'Unknown stage in plan');

    const planned = items.length ? schedule(project.startDate, items) : [];
    const keep = new Set(planned.filter((s) => s.id).map((s) => s.id));
    const removed = before.filter((s) => !keep.has(s.id)).map((s) => s.id);
    const stageRepo = tx.getRepository(ProjectStageEntity);
    if (removed.length) await stageRepo.delete(removed);
    let i = 0;
    for (const s of planned) {
      if (s.id) {
        await stageRepo.update(s.id, {
          name: s.name,
          weightPercent: s.weightPercent,
          durationDays: s.durationDays,
          sortOrder: i++,
          plannedStart: s.plannedStart,
          plannedEnd: s.plannedEnd,
          startOffsetDays: s.startOffsetDays,
          baselineStart: s.plannedStart,
          baselineEnd: s.plannedEnd,
        });
      } else {
        await insertStage(tx, projectId, s, i++);
      }
    }
    const after = await listRaw(tx, projectId);
    await syncCompletionDate(tx, projectId);
    if (after.length) await setProjectProgress(tx, ctx, project, overallFrom(after), 'Construction plan changed');
    await recordAudit(tx, ctx, { action: 'STAGES_PLAN_UPDATED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId,
      previous: { stages: summarise(before) }, next: { stages: summarise(after) }, description: 'Construction plan updated' });
    return describeStages(tx, projectId);
  });
}

/**
 * Change one stage's dates. Pushing a deadline later is a delay and needs a reason (it is logged, together with every
 * later stage it pushes back). Later stages shift to stay in sequence, so the whole timeline and completion date move.
 */
export async function rescheduleStage(ctx, projectId, stageId, { plannedStart, plannedEnd, durationDays, reason }) {
  return withTx(async (tx) => {
    const project = await lockActiveProject(tx, projectId);
    if (!project) throw notFound('Project');
    const stages = await listRaw(tx, projectId);
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx < 0) throw notFound('Stage');
    const target = stages[idx];

    const start = plannedStart ?? target.plannedStart;
    let offset = target.startOffsetDays;
    if (idx > 0) {
      if (start < project.startDate) throw new AppError(400, 'A stage cannot start before the project start date');
      offset = diffDays(addDays(stages[idx - 1].plannedEnd, 1), start); // negative = overlaps the previous stage
    }
    let duration = durationDays ?? target.durationDays;
    if (plannedEnd) {
      duration = diffDays(start, plannedEnd) + 1;
      if (duration < 1) throw new AppError(400, 'End date cannot be before the start date');
    }

    const floor = idx === 0 ? start : project.startDate;
    const tail = schedule(start, [{ id: target.id, name: target.name, durationDays: duration, startOffsetDays: 0 },
      ...stages.slice(idx + 1).map((s) => ({ id: s.id, name: s.name, durationDays: s.durationDays, startOffsetDays: s.startOffsetDays }))], floor);
    const delayDays = diffDays(target.plannedEnd, tail[0].plannedEnd);
    if (delayDays > 0 && !reason?.trim()) throw new AppError(400, 'Give a reason for the delay: the deadline is being pushed later');

    const before = summarise(stages);
    const stageRepo = tx.getRepository(ProjectStageEntity);
    for (const t of tail) {
      await stageRepo.update(t.id, { plannedStart: t.plannedStart, plannedEnd: t.plannedEnd, durationDays: t.durationDays });
    }
    if (idx > 0) await stageRepo.update(target.id, { startOffsetDays: offset });
    const after = await listRaw(tx, projectId);
    if (idx === 0 && plannedStart) await tx.getRepository(ProjectEntity).update(projectId, { startDate: plannedStart });
    await syncCompletionDate(tx, projectId);

    if (delayDays > 0) {
      const delayRepo = tx.getRepository(ProjectStageDelayEntity);
      const insertDelay = (row, kind, days, prevEnd, newEnd) =>
        delayRepo.insert({
          projectId,
          stageId: row.id,
          stageName: row.name,
          causeStageId: kind === 'SHIFTED' ? target.id : null,
          causeStageName: kind === 'SHIFTED' ? target.name : null,
          kind,
          days,
          previousEnd: prevEnd,
          newEnd,
          reason: reason.trim(),
          createdBy: ctx.user.id,
        });
      await insertDelay(target, 'EXTENDED', delayDays, target.plannedEnd, after[idx].plannedEnd);
      for (let i = idx + 1; i < after.length; i += 1) {
        const d = diffDays(stages[i].plannedEnd, after[i].plannedEnd);
        if (d > 0) await insertDelay(after[i], 'SHIFTED', d, stages[i].plannedEnd, after[i].plannedEnd);
      }
    }
    const completion = maxOf(after, 'plannedEnd');
    const shifted = after.filter((st, i) => i > idx && st.plannedStart !== stages[i].plannedStart).length;
    await recordAudit(tx, ctx, { action: 'STAGE_SCHEDULE_CHANGED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId,
      previous: { stages: before }, next: { stages: summarise(after), reason, delayDays }, description: `Stage "${target.name}" rescheduled${delayDays > 0 ? ` (delayed ${delayDays} day${delayDays > 1 ? 's' : ''})` : ''}${shifted ? `; ${shifted} later stage(s) shifted` : ''}` });
    const recipients = [...(await projectUserIds(tx, projectId, 'PROJECT_MANAGER')), ...(await projectUserIds(tx, projectId, 'CUSTOMER'))];
    await notify(tx, { recipientIds: recipients, projectId, type: 'TIMELINE_CHANGED', title: `Timeline updated for ${project.name}`,
      message: `${target.name} now ends ${after[idx].plannedEnd}. Expected completion: ${completion}.${reason ? ` Reason: ${reason}` : ''}`, entityType: 'project', entityId: projectId });
    return { ...(await describeStages(tx, projectId)), shiftedStages: shifted, expectedCompletionDate: completion };
  });
}

/** Tick a stage off (or re-open it). Updates stage progress, overall progress and the on-time/late status. */
export async function setStageCompleted(ctx, projectId, stageId, { completed, completedOn }) {
  return withTx(async (tx) => {
    const project = await lockActiveProject(tx, projectId);
    if (!project) throw notFound('Project');
    const stages = await listRaw(tx, projectId);
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw notFound('Stage');
    const today = localToday();
    const on = completedOn ?? today;
    if (completed && on > today) throw new AppError(400, 'Completion date cannot be in the future');

    const stageRepo = tx.getRepository(ProjectStageEntity);
    if (completed) {
      const fallbackStart = stage.plannedStart <= on ? stage.plannedStart : on;
      await stageRepo.update(stageId, {
        completionPercent: 100,
        status: 'COMPLETED',
        actualEnd: on,
        actualStart: stage.actualStart ?? fallbackStart,
      });
      stage.completionPercent = 100;
    } else {
      await stageRepo.update(stageId, {
        completionPercent: 0,
        status: 'NOT_STARTED',
        actualEnd: null,
        actualStart: null,
      });
      stage.completionPercent = 0;
    }
    const overall = overallFrom(stages);
    await setProjectProgress(tx, ctx, project, overall, completed ? `Stage completed: ${stage.name}` : `Stage re-opened: ${stage.name}`);
    const late = completed ? diffDays(stage.plannedEnd, on) : 0;
    await recordAudit(tx, ctx, { action: completed ? 'STAGE_COMPLETED' : 'STAGE_REOPENED', module: 'PROJECTS', entityType: 'project', entityId: projectId, projectId,
      previous: { stage: stage.name, status: stage.status, completion: Number(stage.completionPercent === 100 && !completed ? 100 : 0) }, next: { stage: stage.name, completedOn: completed ? on : null, plannedEnd: stage.plannedEnd, daysLate: late, overallProgress: overall },
      description: completed ? `Stage "${stage.name}" completed${late > 0 ? ` ${late} day(s) late` : late < 0 ? ` ${-late} day(s) early` : ' on time'}` : `Stage "${stage.name}" re-opened` });
    if (completed) {
      const recipients = [...(await projectUserIds(tx, projectId, 'PROJECT_MANAGER')), ...(await projectUserIds(tx, projectId, 'CUSTOMER'))];
      await notify(tx, { recipientIds: recipients, projectId, type: 'STAGE_COMPLETED', title: `${stage.name} completed`,
        message: `${project.name} is now ${overall}% complete${late > 0 ? ` (this stage finished ${late} day(s) late)` : late < 0 ? ` (${-late} day(s) ahead of plan)` : ' (on time)'}.`, entityType: 'project', entityId: projectId });
    }
    return describeStages(tx, projectId);
  });
}

/** Re-flow every stage when the project start date changes. */
export async function reflowFromStart(tx, projectId, startDate) {
  const rows = await listRaw(tx, projectId);
  if (!rows.length) return;
  const stageRepo = tx.getRepository(ProjectStageEntity);
  for (const t of schedule(startDate, rows.map((r) => ({ id: r.id, name: r.name, durationDays: r.durationDays, startOffsetDays: r.startOffsetDays })))) {
    await stageRepo.update(t.id, {
      plannedStart: t.plannedStart,
      plannedEnd: t.plannedEnd,
      baselineStart: t.plannedStart,
      baselineEnd: t.plannedEnd,
    });
  }
  await syncCompletionDate(tx, projectId);
}

/** PM progress update against a stage: stores the stage's completion and returns the new overall progress. */
export async function applyStageProgress(tx, projectId, stageId, completion) {
  const stages = await listRaw(tx, projectId);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) throw new AppError(400, 'Selected stage does not belong to this project');
  const status = completion >= 100 ? 'COMPLETED' : completion > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
  const today = localToday();
  await tx.getRepository(ProjectStageEntity).update(stageId, {
    completionPercent: completion,
    status,
    actualStart: status !== 'NOT_STARTED' ? (stage.actualStart ?? today) : stage.actualStart,
    actualEnd: status === 'COMPLETED' ? today : null,
  });
  stage.completionPercent = completion;
  return { overall: overallFrom(stages), stage };
}

// ── Calendar events (deadlines, meetings, deliveries…) ──────────────────────────────────────────
export async function listEvents(user, projectId) {
  const mgr = getManager();
  await requireProjectAccess(mgr, user, projectId);
  const rows = await mgr.getRepository(ProjectEventEntity).find({
    where: { projectId },
    order: { startDate: 'ASC', createdAt: 'ASC' },
  });
  return toCamel(rows);
}

export async function createEvent(ctx, projectId, body) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const repo = tx.getRepository(ProjectEventEntity);
    const saved = await repo.save(repo.create({
      projectId,
      title: body.title,
      eventType: body.eventType,
      startDate: body.startDate,
      endDate: body.endDate ?? null,
      notes: body.notes ?? null,
      createdBy: ctx.user.id,
    }));
    await recordAudit(tx, ctx, { action: 'EVENT_CREATED', module: 'PROJECTS', entityType: 'project_event', entityId: saved.id, projectId, next: body, description: `Calendar item added: ${body.title}` });
    return toCamel(saved);
  });
}

export async function updateEvent(ctx, projectId, eventId, body) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const repo = tx.getRepository(ProjectEventEntity);
    const before = await repo.createQueryBuilder('e')
      .setLock('pessimistic_write')
      .where('e.id = :eventId AND e.project_id = :projectId', { eventId, projectId })
      .getOne();
    if (!before) throw notFound('Event');
    const next = {
      title: body.title ?? before.title,
      eventType: body.eventType ?? before.eventType,
      startDate: body.startDate ?? before.startDate,
      endDate: body.endDate === undefined ? before.endDate : body.endDate,
      notes: body.notes === undefined ? before.notes : body.notes,
    };
    if (next.endDate && next.endDate < next.startDate) throw new AppError(400, 'End date cannot be before the start date');
    await repo.update(eventId, next);
    const saved = await repo.findOneBy({ id: eventId });
    await recordAudit(tx, ctx, { action: 'EVENT_UPDATED', module: 'PROJECTS', entityType: 'project_event', entityId: eventId, projectId,
      previous: { title: before.title, startDate: before.startDate, endDate: before.endDate }, next: { title: next.title, startDate: next.startDate, endDate: next.endDate }, description: `Calendar item changed: ${next.title}` });
    return toCamel(saved);
  });
}

export async function deleteEvent(ctx, projectId, eventId) {
  return withTx(async (tx) => {
    await requireProjectAccess(tx, ctx.user, projectId, { roles: ['ADMIN'] });
    const repo = tx.getRepository(ProjectEventEntity);
    const row = await repo.findOneBy({ id: eventId, projectId });
    if (!row) throw notFound('Event');
    await repo.delete(row.id);
    await recordAudit(tx, ctx, { action: 'EVENT_DELETED', module: 'PROJECTS', entityType: 'project_event', entityId: eventId, projectId, previous: { title: row.title, startDate: row.startDate }, description: `Calendar item removed: ${row.title}` });
  });
}
