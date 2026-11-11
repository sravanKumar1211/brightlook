import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isHostedProd = isProd || env.RENDER === 'true';

const cleanUrl = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '').trim();
const databaseUrl = cleanUrl(env.DATABASE_URL);
const directDatabaseUrl = cleanUrl(env.DIRECT_DATABASE_URL || env.DATABASE_URL_UNPOOLED || databaseUrl);

if (isProd && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
if (isHostedProd && !databaseUrl && env.ALLOW_PGLITE_IN_PROD !== 'true') {
  throw new Error('DATABASE_URL must be set in production / Render (cannot fall back to ephemeral PGlite)');
}
if (databaseUrl && !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error('DATABASE_URL must be a valid postgres:// or postgresql:// URI');
}
if (directDatabaseUrl && !/^postgres(?:ql)?:\/\//i.test(directDatabaseUrl)) {
  throw new Error('DIRECT_DATABASE_URL / DATABASE_URL_UNPOOLED must be a valid postgres:// or postgresql:// URI');
}

const rawSameSite = (env.COOKIE_SAME_SITE || (isHostedProd ? 'none' : 'lax')).trim().toLowerCase();
const cookieSameSite = ['lax', 'strict', 'none'].includes(rawSameSite) ? rawSameSite : (isHostedProd ? 'none' : 'lax');

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  // If DATABASE_URL is set we use PostgreSQL via pg. Otherwise an embedded Postgres (PGlite) is used.
  databaseUrl,
  directDatabaseUrl,
  pgliteDir: env.PGLITE_DIR || './data/pgdata', // use "memory" for an ephemeral DB
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  accessTtl: env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlDays: Number(env.REFRESH_TOKEN_DAYS || 7),
  refreshTtlRememberDays: Number(env.REFRESH_TOKEN_REMEMBER_DAYS || 30),
  corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  cookieSameSite,
  cookieSecure: isHostedProd || cookieSameSite === 'none',
  cookieDomain: env.COOKIE_DOMAIN ? env.COOKIE_DOMAIN.trim() : undefined,
  uploadDir: env.UPLOAD_DIR || './uploads',
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  maxVideoUploadBytes: Number(env.MAX_VIDEO_UPLOAD_MB || 100) * 1024 * 1024,
  seedAdminPassword: env.SEED_ADMIN_PASSWORD || 'app@123',
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
    folder: env.CLOUDINARY_FOLDER || 'brightlook-crm',
  },
};
