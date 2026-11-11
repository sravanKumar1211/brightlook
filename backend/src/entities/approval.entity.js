import { EntitySchema } from 'typeorm';

export const ApprovalRequestEntity = new EntitySchema({
  name: 'ApprovalRequest',
  tableName: 'approval_requests',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    requesterId: { name: 'requester_id', type: 'uuid' },
    approvalType: { name: 'approval_type', type: 'text' },
    entityType: { name: 'entity_type', type: 'text' },
    entityId: { name: 'entity_id', type: 'uuid' },
    title: { type: 'text' },
    summary: { type: 'text', nullable: true },
    status: { type: 'text', default: 'PENDING' },
    currentAssigneeId: { name: 'current_assignee_id', type: 'uuid', nullable: true },
    requestedAt: { name: 'requested_at', type: 'timestamptz', createDate: true },
    resolvedAt: { name: 'resolved_at', type: 'timestamptz', nullable: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    requester: { target: 'User', type: 'many-to-one', joinColumn: { name: 'requester_id' } },
    currentAssignee: { target: 'User', type: 'many-to-one', joinColumn: { name: 'current_assignee_id' } },
    actions: { target: 'ApprovalAction', type: 'one-to-many', inverseSide: 'approval' },
  },
});

export const ApprovalActionEntity = new EntitySchema({
  name: 'ApprovalAction',
  tableName: 'approval_actions',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    approvalId: { name: 'approval_id', type: 'uuid' },
    actorId: { name: 'actor_id', type: 'uuid', nullable: true },
    action: { type: 'text' },
    comment: { type: 'text', nullable: true },
    previousStatus: { name: 'previous_status', type: 'text', nullable: true },
    newStatus: { name: 'new_status', type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    approval: { target: 'ApprovalRequest', type: 'many-to-one', joinColumn: { name: 'approval_id' } },
    actorUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'actor_id' } },
  },
});

