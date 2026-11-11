import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const ProjectEntity = new EntitySchema({
  name: 'Project',
  tableName: 'projects',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectCode: { name: 'project_code', type: 'text', unique: true },
    name: { type: 'text' },
    description: { type: 'text', nullable: true },
    location: { type: 'text' },
    projectType: { name: 'project_type', type: 'text' },
    contractAmount: { name: 'contract_amount', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer },
    startDate: { name: 'start_date', type: 'date', nullable: true },
    expectedCompletionDate: { name: 'expected_completion_date', type: 'date', nullable: true },
    actualCompletionDate: { name: 'actual_completion_date', type: 'date', nullable: true },
    coverImageFileId: { name: 'cover_image_file_id', type: 'uuid', nullable: true },
    overallProgress: { name: 'overall_progress', type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer },
    status: { type: 'text', default: 'PLANNED' },
    createdBy: { name: 'created_by', type: 'uuid', nullable: true },
    updatedBy: { name: 'updated_by', type: 'uuid', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
    deletedAt: { name: 'deleted_at', type: 'timestamptz', deleteDate: true, nullable: true },
  },
  relations: {
    coverImageFile: { target: 'File', type: 'many-to-one', joinColumn: { name: 'cover_image_file_id' } },
    assignments: { target: 'ProjectAssignment', type: 'one-to-many', inverseSide: 'project' },
    stages: { target: 'ProjectStage', type: 'one-to-many', inverseSide: 'project' },
  },
});

export const ProjectAssignmentEntity = new EntitySchema({
  name: 'ProjectAssignment',
  tableName: 'project_assignments',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    userId: { name: 'user_id', type: 'uuid' },
    assignmentRole: { name: 'assignment_role', type: 'text' },
    assignedAt: { name: 'assigned_at', type: 'timestamptz', createDate: true },
    assignedBy: { name: 'assigned_by', type: 'uuid', nullable: true },
    isActive: { name: 'is_active', type: 'boolean', default: true },
    unassignedAt: { name: 'unassigned_at', type: 'timestamptz', nullable: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    user: { target: 'User', type: 'many-to-one', joinColumn: { name: 'user_id' } },
  },
});

export const ProjectProgressHistoryEntity = new EntitySchema({
  name: 'ProjectProgressHistory',
  tableName: 'project_progress_history',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    previousProgress: { name: 'previous_progress', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer },
    newProgress: { name: 'new_progress', type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer },
    changedBy: { name: 'changed_by', type: 'uuid', nullable: true },
    note: { type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    changedByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'changed_by' } },
  },
});

