import 'reflect-metadata';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { config } from './environment.js';
import { createPgliteDriver, PARSERS } from './pgliteDriver.js';
import { ALL_ENTITIES } from '../entities/index.js';
import { logger } from '../utils/logger.js';

// TypeORM DataSource and EntityManager accessors.
// IMPORTANT: inside withTx((tx) => ...), always pass the provided `tx` EntityManager, never getManager().
let dataSource;
let activeDriverName;

const TRANSIENT_PG_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', '57P01', '57P02', '57P03']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientInitError(err) {
  const code = err?.code || err?.driverError?.code;
  if (code && TRANSIENT_PG_CODES.has(code)) return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('terminated unexpectedly') || msg.includes('econnreset');
}

export async function initDb({ direct = false } = {}) {
  if (dataSource?.isInitialized) return dataSource;

  const targetUrl = direct ? (config.directDatabaseUrl || config.databaseUrl) : config.databaseUrl;
  const isPg = Boolean(targetUrl);
  activeDriverName = isPg ? 'postgres' : 'pglite';

  if (isPg) {
    for (const [oid, fn] of Object.entries(PARSERS)) {
      pg.types.setTypeParser(Number(oid), fn);
    }
  }

  const needsImplicitSsl = isPg
    && !/[?&]sslmode=/i.test(targetUrl)
    && (config.isProd || /\.neon\.tech/i.test(targetUrl));

  dataSource = new DataSource({
    type: 'postgres',
    ...(isPg
      ? {
          url: targetUrl,
          ...(needsImplicitSsl ? { ssl: { rejectUnauthorized: true } } : {}),
          poolErrorHandler: (err) => logger.warn('Postgres pool error', { error: err?.message }),
          extra: {
            max: 10,
            idleTimeoutMillis: 20000,
            connectionTimeoutMillis: 20000,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
          },
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

  const maxAttempts = isPg ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await dataSource.initialize();
      return dataSource;
    } catch (err) {
      if (attempt < maxAttempts && isTransientInitError(err)) {
        logger.warn('Postgres initial connection retrying', { attempt, error: err?.message });
        await sleep(1500 * attempt);
        continue;
      }
      dataSource = undefined;
      activeDriverName = undefined;
      throw err;
    }
  }
  return dataSource;
}

export const getDataSource = () => {
  if (!dataSource?.isInitialized) throw new Error('Database not initialized');
  return dataSource;
};

export const pingDb = async () => {
  await getDataSource().query('SELECT 1 AS ok');
  return true;
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
