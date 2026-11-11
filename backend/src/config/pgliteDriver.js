import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PGlite, types } from '@electric-sql/pglite';

const toNumber = (v) => (v === null ? null : Number(v));
const keepString = (v) => v;

// Parse numeric (1700) and int8 (20) to JS numbers and keep date (1082) as YYYY-MM-DD strings.
export const PARSERS = { 1700: toNumber, 20: toNumber, 1082: keepString };

const SERIALIZERS = {
  [types.BOOL]: (val) => {
    if (val === true || val === 'true' || val === 1) return 'TRUE';
    if (val === false || val === 'false' || val === 0) return 'FALSE';
    return val;
  },
};

const queryOpts = { parsers: PARSERS, serializers: SERIALIZERS };

function extractCommand(sql) {
  const clean = sql.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/g, '');
  return clean.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
}

function normalizeResult(res, sql) {
  const rows = res?.rows ?? [];
  return {
    ...res,
    rows,
    rowCount: res?.affectedRows ?? rows.length ?? 0,
    command: extractCommand(sql),
  };
}

/**
 * Builds a node-postgres (`pg`) compatible driver wrapper around an embedded PGlite instance
 * so TypeORM's PostgresDriver works seamlessly with both in-memory and disk-backed PGlite.
 */
export function createPgliteDriver({ dataDir } = {}) {
  const resolvedDir = dataDir && dataDir !== 'memory' ? dataDir : undefined;
  if (resolvedDir) fs.mkdirSync(path.dirname(path.resolve(resolvedDir)), { recursive: true });

  let instancePromise = null;
  const getInstance = async () => {
    if (!instancePromise) {
      instancePromise = (async () => {
        const lite = new PGlite(resolvedDir, { parsers: PARSERS, serializers: SERIALIZERS });
        await lite.waitReady;
        return lite;
      })();
    }
    return instancePromise;
  };

  // Serialize checked-out QueryRunner connections on the single PGlite session so concurrent
  // TypeORM transactions cannot interleave BEGIN/COMMIT blocks.
  let lockChain = Promise.resolve();
  const acquireLease = () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const prev = lockChain;
    lockChain = lockChain.then(() => gate);
    return prev.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    });
  };

  class PGliteClient extends EventEmitter {
    query(sql, paramsOrCb, maybeCb) {
      let params = paramsOrCb;
      let cb = maybeCb;
      if (typeof paramsOrCb === 'function') {
        cb = paramsOrCb;
        params = undefined;
      }

      const run = async () => {
        const lite = await getInstance();
        const hasParams = Array.isArray(params) && params.length > 0;
        const raw = hasParams
          ? await lite.query(sql, params, queryOpts)
          : (await lite.exec(sql, queryOpts)).at(-1) ?? { rows: [], fields: [], affectedRows: 0 };
        return normalizeResult(raw, sql);
      };

      const promise = run();
      if (cb) {
        promise.then((res) => cb(null, res), (err) => cb(err, null));
        return undefined;
      }
      return promise;
    }
  }

  class PGlitePool extends EventEmitter {
    connect(cb) {
      const acquire = async () => {
        const done = await acquireLease();
        try {
          await getInstance();
          const client = new PGliteClient();
          return { client, done };
        } catch (err) {
          done();
          throw err;
        }
      };

      if (typeof cb === 'function') {
        acquire()
          .then(({ client, done }) => cb(null, client, done))
          .catch((err) => cb(err, null, () => {}));
        return undefined;
      }
      return acquire().then(({ client, done }) => Object.assign(client, { release: done }));
    }

    async end(cb) {
      try {
        if (instancePromise) {
          const lite = await instancePromise;
          instancePromise = null;
          await lite.close();
        }
        if (cb) cb(null);
      } catch (err) {
        if (cb) cb(err);
        else throw err;
      }
    }
  }

  return { Pool: PGlitePool };
}
