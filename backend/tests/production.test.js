import { describe, it, expect } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const BACKEND_ROOT = path.resolve(import.meta.dirname, '..');

async function evalEnv(extraEnv) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.DATABASE_URL;
  delete cleanEnv.DIRECT_DATABASE_URL;
  delete cleanEnv.DATABASE_URL_UNPOOLED;
  delete cleanEnv.JWT_SECRET;
  delete cleanEnv.CORS_ORIGIN;
  delete cleanEnv.COOKIE_SAME_SITE;
  delete cleanEnv.COOKIE_DOMAIN;
  delete cleanEnv.ALLOW_PGLITE_IN_PROD;
  const code = "import { config } from './src/config/environment.js'; console.log(JSON.stringify(config));";
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: BACKEND_ROOT,
    env: { ...cleanEnv, ...extraEnv },
  });
  return JSON.parse(stdout.trim());
}

describe('production environment & runtime guards', () => {
  it('fails fast in production when DATABASE_URL is missing', async () => {
    await expect(evalEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-secret-prod-key',
      DATABASE_URL: '',
    })).rejects.toThrow(/DATABASE_URL must be set in production/);
  });

  it('normalizes CORS origins, pooled/direct DB URLs, and cross-origin cookie flags', async () => {
    const cfg = await evalEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-secret-prod-key',
      DATABASE_URL: 'postgresql://user:pass@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
      DATABASE_URL_UNPOOLED: 'postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require',
      CORS_ORIGIN: ' https://crm.example.com/ , https://admin.example.com/// ',
      COOKIE_DOMAIN: ' .example.com ',
    });
    expect(cfg.corsOrigin).toEqual(['https://crm.example.com', 'https://admin.example.com']);
    expect(cfg.directDatabaseUrl).toContain('ep-demo.us-east-2.aws.neon.tech');
    expect(cfg.directDatabaseUrl).not.toContain('-pooler');
    expect(cfg.cookieSameSite).toBe('none');
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.cookieDomain).toBe('.example.com');
  });

  it('returns clean 404 before streaming headers when a legacy local file is missing on disk', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brightlook-missing-file-'));
    process.env.PGLITE_DIR = 'memory';
    process.env.UPLOAD_DIR = tempDir;

    const db = await import('../src/config/database.js');
    const entities = await import('../src/entities/index.js');
    const { runMigrations } = await import('../src/migrate.js');
    const { seed } = await import('../seeds/seed.js');
    const { serveFile } = await import('../src/modules/files/files.routes.js');

    await db.initDb();
    await runMigrations();
    await seed();

    try {
      const admin = await db.getRepo(entities.UserEntity).findOneBy({ username: 'admin' });
      const fileRepo = db.getRepo(entities.FileEntity);
      const missingRecord = await fileRepo.save(fileRepo.create({
        originalName: 'legacy.pdf',
        storedName: 'missing.pdf',
        relativePath: 'vendor-bills/2026/11/missing.pdf',
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        fileSize: 1234,
        storageProvider: 'local',
        checksum: '0'.repeat(64),
        visibility: 'INTERNAL',
        uploadedBy: admin.id,
      }));

      const headers = {};
      const mockRes = new Writable({ write(_c, _e, cb) { cb(); } });
      mockRes.setHeader = (k, v) => { headers[k.toLowerCase()] = v; };

      await expect(serveFile({
        valid: { params: { id: missingRecord.id } },
        query: {},
        headers: {},
        user: admin,
      }, mockRes)).rejects.toMatchObject({ status: 404, message: 'File not found' });

      expect(headers['content-length']).toBeUndefined();
      expect(headers['content-disposition']).toBeUndefined();
    } finally {
      await db.closeDb();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
