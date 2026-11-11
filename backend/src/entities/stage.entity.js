import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const ProjectStageEntity = new EntitySchema({
  name: 'ProjectStage',
  tableName: 'project_stages',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    name: { type: 'text' },
    weightPercent: { name: 'weight_percent', type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer },
    durationDays: { name: 'duration_days', type: 'int' },
    sortOrder: { name: 'sort_order', type: 'int' },
    plannedStart: { name: 'planned_start', type: 'date', nullable: true },
    plannedEnd: { name: 'planned_end', type: 'date', nullable: true },
    completionPercent: { name: 'completion_percent', type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer },
    status: { type: 'text', default: 'NOT_STARTED' },
    actualStart: { name: 'actual_start', type: 'date', nullable: true },
    actualEnd: { name: 'actual_end', type: 'date', nullable: true },
    startOffsetDays: { name: 'start_offset_days', type: 'int', default: 0 },
    baselineStart: { name: 'baseline_start', type: 'date', nullable: true },
    baselineEnd: { name: 'baseline_end', type: 'date', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
  },
});

export const ProjectEventEntity = new EntitySchema({
  name: 'ProjectEvent',
  tableName: 'project_events',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    title: { type: 'text' },
    eventType: { name: 'event_type', type: 'text', default: 'DEADLINE' },
    startDate: { name: 'start_date', type: 'date' },
    endDate: { name: 'end_date', type: 'date', nullable: true },
    notes: { type: 'text', nullable: true },
    createdBy: { name: 'created_by', type: 'uuid', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    createdByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'created_by' } },
  },
});

export const ProjectStageDelayEntity = new EntitySchema({
  name: 'ProjectStageDelay',
  tableName: 'project_stage_delays',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    stageId: { name: 'stage_id', type: 'uuid', nullable: true },
    stageName: { name: 'stage_name', type: 'text' },
    causeStageId: { name: 'cause_stage_id', type: 'uuid', nullable: true },
    causeStageName: { name: 'cause_stage_name', type: 'text', nullable: true },
    kind: { type: 'text' },
    days: { type: 'int' },
    previousEnd: { name: 'previous_end', type: 'date' },
    newEnd: { name: 'new_end', type: 'date' },
    reason: { type: 'text' },
    createdBy: { name: 'created_by', type: 'uuid', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    stage: { target: 'ProjectStage', type: 'many-to-one', joinColumn: { name: 'stage_id' }, onDelete: 'SET NULL' },
    causeStage: { target: 'ProjectStage', type: 'many-to-one', joinColumn: { name: 'cause_stage_id' }, onDelete: 'SET NULL' },
    createdByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'created_by' } },
  },
});

