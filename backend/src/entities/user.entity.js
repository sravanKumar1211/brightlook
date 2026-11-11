import { EntitySchema } from 'typeorm';

export const UserEntity = new EntitySchema({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    username: { type: 'text' },
    fullName: { name: 'full_name', type: 'text' },
    email: { type: 'text', nullable: true },
    phone: { type: 'text', nullable: true },
    passwordHash: { name: 'password_hash', type: 'text', select: false },
    role: { type: 'text' },
    status: { type: 'text', default: 'ACTIVE' },
    failedAttempts: { name: 'failed_attempts', type: 'int', default: 0 },
    lockedUntil: { name: 'locked_until', type: 'timestamptz', nullable: true },
    lastLoginAt: { name: 'last_login_at', type: 'timestamptz', nullable: true },
    createdBy: { name: 'created_by', type: 'uuid', nullable: true },
    updatedBy: { name: 'updated_by', type: 'uuid', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  relations: {
    assignments: { target: 'ProjectAssignment', type: 'one-to-many', inverseSide: 'user' },
    refreshTokens: { target: 'RefreshToken', type: 'one-to-many', inverseSide: 'user' },
  },
});

export const RefreshTokenEntity = new EntitySchema({
  name: 'RefreshToken',
  tableName: 'refresh_tokens',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    userId: { name: 'user_id', type: 'uuid' },
    tokenHash: { name: 'token_hash', type: 'text', unique: true },
    expiresAt: { name: 'expires_at', type: 'timestamptz' },
    revokedAt: { name: 'revoked_at', type: 'timestamptz', nullable: true },
    replacedBy: { name: 'replaced_by', type: 'uuid', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    user: { target: 'User', type: 'many-to-one', joinColumn: { name: 'user_id' }, onDelete: 'CASCADE' },
  },
});

