import 'reflect-metadata';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { config } from './environment.js';
import { createPgliteDriver, PARSERS } from './pgliteDriver.js';
import { ALL_ENTITIES } from '../entities/index.js';

// TypeORM DataSource and EntityManager accessors.
// IMPORTANT: inside withTx((tx) => ...), always pass the provided `tx` EntityManager, never getManager().
let dataSource;
let activeDriverName;

export async function initDb() {
  if (dataSource?.isInitialized) return dataSource;

  const isPg = Boolean(config.databaseUrl);
  activeDriverName = isPg ? 'postgres' : 'pglite';

  if (isPg) {
    for (const [oid, fn] of Object.entries(PARSERS)) {
      pg.types.setTypeParser(Number(oid), fn);
    }
  }

  dataSource = new DataSource({
    type: 'postgres',
    ...(isPg
      ? {
          url: config.databaseUrl,
          extra: { max: 10 },
        }
      : {
          driver: createPgliteDriver({ dataDir: config.pgliteDir }),
          database: 'postgres',
        }),
    entities: ALL_ENTITIES,
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  return dataSource;
}

export const getDataSource = () => {
  if (!dataSource?.isInitialized) throw new Error('Database not initialized');
  return dataSource;
};

export const getManager = () => getDataSource().manager;
export const getRepo = (entity, manager = getManager()) => manager.getRepository(entity);
export const withTx = (fn) => getDataSource().transaction(fn);

export const closeDb = async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
  dataSource = undefined;
  activeDriverName = undefined;
};

export const driverName = () => activeDriverName;
