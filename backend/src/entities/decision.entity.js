import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const DecisionRequestEntity = new EntitySchema({
  name: 'DecisionRequest',
  tableName: 'decision_requests',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    title: { type: 'text' },
    description: { type: 'text', nullable: true },
    category: { type: 'text', nullable: true },
    details: { type: 'text', nullable: true },
    status: { type: 'text', default: 'PENDING_CUSTOMER' },
    requiresAdminApproval: { name: 'requires_admin_approval', type: 'boolean', default: false },
    requestedBy: { name: 'requested_by', type: 'uuid' },
    deadline: { type: 'timestamptz', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    requestedByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'requested_by' } },
    options: { target: 'DecisionOption', type: 'one-to-many', inverseSide: 'decision' },
    responses: { target: 'DecisionResponse', type: 'one-to-many', inverseSide: 'decision' },
    files: { target: 'DecisionFile', type: 'one-to-many', inverseSide: 'decision' },
    history: { target: 'DecisionHistory', type: 'one-to-many', inverseSide: 'decision' },
  },
});

export const DecisionOptionEntity = new EntitySchema({
  name: 'DecisionOption',
  tableName: 'decision_options',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    decisionId: { name: 'decision_id', type: 'uuid' },
    label: { type: 'text' },
    description: { type: 'text', nullable: true },
    priceNote: { name: 'price_note', type: 'text', nullable: true },
    additionalCharge: { name: 'additional_charge', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer },
    sortOrder: { name: 'sort_order', type: 'int', default: 0 },
  },
  relations: {
    decision: { target: 'DecisionRequest', type: 'many-to-one', joinColumn: { name: 'decision_id' }, onDelete: 'CASCADE' },
  },
});

export const DecisionResponseEntity = new EntitySchema({
  name: 'DecisionResponse',
  tableName: 'decision_responses',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    decisionId: { name: 'decision_id', type: 'uuid' },
    optionId: { name: 'option_id', type: 'uuid' },
    respondedBy: { name: 'responded_by', type: 'uuid' },
    comment: { type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    decision: { target: 'DecisionRequest', type: 'many-to-one', joinColumn: { name: 'decision_id' } },
    option: { target: 'DecisionOption', type: 'many-to-one', joinColumn: { name: 'option_id' } },
    respondedByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'responded_by' } },
    files: { target: 'DecisionFile', type: 'one-to-many', inverseSide: 'response' },
  },
});

export const DecisionFileEntity = new EntitySchema({
  name: 'DecisionFile',
  tableName: 'decision_files',
  columns: {
    decisionId: { name: 'decision_id', type: 'uuid', primary: true },
    fileId: { name: 'file_id', type: 'uuid', primary: true },
    responseId: { name: 'response_id', type: 'uuid', nullable: true },
  },
  relations: {
    decision: { target: 'DecisionRequest', type: 'many-to-one', joinColumn: { name: 'decision_id' }, onDelete: 'CASCADE' },
    response: { target: 'DecisionResponse', type: 'many-to-one', joinColumn: { name: 'response_id' } },
    file: { target: 'File', type: 'many-to-one', joinColumn: { name: 'file_id' } },
  },
});

export const DecisionHistoryEntity = new EntitySchema({
  name: 'DecisionHistory',
  tableName: 'decision_history',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    decisionId: { name: 'decision_id', type: 'uuid' },
    fromStatus: { name: 'from_status', type: 'text', nullable: true },
    toStatus: { name: 'to_status', type: 'text' },
    actorId: { name: 'actor_id', type: 'uuid', nullable: true },
    comment: { type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    decision: { target: 'DecisionRequest', type: 'many-to-one', joinColumn: { name: 'decision_id' } },
    actorUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'actor_id' } },
  },
});

