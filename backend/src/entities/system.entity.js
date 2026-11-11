import { EntitySchema } from 'typeorm';

export const NotificationEntity = new EntitySchema({
  name: 'Notification',
  tableName: 'notifications',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    recipientId: { name: 'recipient_id', type: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid', nullable: true },
    notificationType: { name: 'notification_type', type: 'text' },
    title: { type: 'text' },
    message: { type: 'text', nullable: true },
    entityType: { name: 'entity_type', type: 'text', nullable: true },
    entityId: { name: 'entity_id', type: 'uuid', nullable: true },
    isRead: { name: 'is_read', type: 'boolean', default: false },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    recipient: { target: 'User', type: 'many-to-one', joinColumn: { name: 'recipient_id' } },
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
  },
});

export const AuditLogEntity = new EntitySchema({
  name: 'AuditLog',
  tableName: 'audit_logs',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    actorUserId: { name: 'actor_user_id', type: 'uuid', nullable: true },
    actorRole: { name: 'actor_role', type: 'text', nullable: true },
    actionType: { name: 'action_type', type: 'text' },
    module: { type: 'text' },
    entityType: { name: 'entity_type', type: 'text', nullable: true },
    entityId: { name: 'entity_id', type: 'uuid', nullable: true },
    projectId: { name: 'project_id', type: 'uuid', nullable: true },
    previousData: { name: 'previous_data', type: 'jsonb', nullable: true },
    newData: { name: 'new_data', type: 'jsonb', nullable: true },
    description: { type: 'text', nullable: true },
    ipAddress: { name: 'ip_address', type: 'text', nullable: true },
    userAgent: { name: 'user_agent', type: 'text', nullable: true },
    requestId: { name: 'request_id', type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    actorUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'actor_user_id' }, createForeignKeyConstraints: false },
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' }, createForeignKeyConstraints: false },
  },
});

