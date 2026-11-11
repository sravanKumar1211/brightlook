import { config } from './config/environment.js';
import { initDb, driverName, closeDb } from './config/database.js';
import { runMigrations } from './migrate.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

await initDb();
await runMigrations();
const dbHost = (() => {
  if (!config.databaseUrl) return 'pglite';
  try { return new URL(config.databaseUrl).hostname; } catch { return 'postgres'; }
})();

const server = createApp().listen(config.port, '0.0.0.0', () =>
  logger.info('Brightlook CRM API listening', {
    port: config.port,
    database: driverName(),
    dbHost,
    env: config.env,
    cloudinaryConfigured: Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret),
  }));

const shutdown = () => server.close(async () => { await closeDb(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
