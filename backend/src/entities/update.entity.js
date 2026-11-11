import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const ProjectUpdateEntity = new EntitySchema({
  name: 'ProjectUpdate',
  tableName: 'project_updates',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    createdBy: { name: 'created_by', type: 'uuid' },
    updateType: { name: 'update_type', type: 'text' },
    title: { type: 'text', nullable: true },
    description: { type: 'text', nullable: true },
    progressPercentage: { name: 'progress_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer },
    workCompleted: { name: 'work_completed', type: 'text', nullable: true },
    workRemaining: { name: 'work_remaining', type: 'text', nullable: true },
    materialName: { name: 'material_name', type: 'text', nullable: true },
    quantity: { type: 'numeric', precision: 12, scale: 3, nullable: true, transformer: numericTransformer },
    unit: { type: 'text', nullable: true },
    supplier: { type: 'text', nullable: true },
    deliveryStatus: { name: 'delivery_status', type: 'text', nullable: true },
    deliveryDate: { name: 'delivery_date', type: 'date', nullable: true },
    decisionRequestId: { name: 'decision_request_id', type: 'uuid', nullable: true },
    stageId: { name: 'stage_id', type: 'uuid', nullable: true },
    overallAfter: { name: 'overall_after', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer },
    updateDate: { name: 'update_date', type: 'timestamptz', createDate: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    createdByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'created_by' } },
    stage: { target: 'ProjectStage', type: 'many-to-one', joinColumn: { name: 'stage_id' }, onDelete: 'SET NULL' },
    decisionRequest: { target: 'DecisionRequest', type: 'many-to-one', joinColumn: { name: 'decision_request_id' }, createForeignKeyConstraints: false },
    updateFiles: { target: 'ProjectUpdateFile', type: 'one-to-many', inverseSide: 'update' },
  },
});

export const ProjectUpdateFileEntity = new EntitySchema({
  name: 'ProjectUpdateFile',
  tableName: 'project_update_files',
  columns: {
    updateId: { name: 'update_id', type: 'uuid', primary: true },
    fileId: { name: 'file_id', type: 'uuid', primary: true },
    kind: { type: 'text' },
  },
  relations: {
    update: { target: 'ProjectUpdate', type: 'many-to-one', joinColumn: { name: 'update_id' }, onDelete: 'CASCADE' },
    file: { target: 'File', type: 'many-to-one', joinColumn: { name: 'file_id' } },
  },
});

