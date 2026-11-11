import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Table } from 'typeorm';
import { initDb, getDataSource, closeDb } from './config/database.js';
import { SchemaMigrationEntity } from './entities/index.js';
import { logger } from './utils/logger.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function runMigrations({ direct = false } = {}) {
  await initDb({ direct });
  const ds = getDataSource();
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {
    await qr.createTable(
      new Table({
        name: 'schema_migrations',
        columns: [
          { name: 'name', type: 'text', isPrimary: true },
          { name: 'applied_at', type: 'timestamptz', default: 'now()', isNullable: false },
        ],
      }),
      true,
    );

    const migrationRepo = qr.manager.getRepository(SchemaMigrationEntity);
    const appliedRows = await migrationRepo.find({ select: { name: true } });
    const applied = new Set(appliedRows.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const ran = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await qr.startTransaction();
      try {
        await qr.query(sql);
        await qr.manager.insert(SchemaMigrationEntity, { name: file });
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      }
      logger.info('migration applied', { file });
      ran.push(file);
    }
    return ran;
  } finally {
    await qr.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations({ direct: true })
    .then((ran) => logger.info('migrations complete', { applied: ran.length }))
    .catch((err) => { logger.error('migration failed', { error: err.message }); process.exitCode = 1; })
    .finally(closeDb);
}
