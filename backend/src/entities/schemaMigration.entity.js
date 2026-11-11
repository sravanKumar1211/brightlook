import { EntitySchema } from 'typeorm';

export const SchemaMigrationEntity = new EntitySchema({
  name: 'SchemaMigration',
  tableName: 'schema_migrations',
  columns: {
    name: { type: 'text', primary: true },
    appliedAt: { name: 'applied_at', type: 'timestamptz', createDate: true },
  },
});

