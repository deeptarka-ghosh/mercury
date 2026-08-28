import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createPool, destroyPool } from './db/pool.js';
import { createDatabase, destroyDatabase } from './db/database.js';
import { logger } from './config/logger.js';

async function main(): Promise<void> {
  const migrationFolder = path.resolve(__dirname, 'migrations');

  const pool = createPool();
  const db = createDatabase(pool);

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  const command = process.argv[2] ?? 'up';

  let result;
  if (command === 'up') {
    result = await migrator.migrateToLatest();
  } else if (command === 'down') {
    result = await migrator.migrateDown();
  } else if (command === 'list') {
    const migrations = await migrator.getMigrations();
    for (const m of migrations) {
      logger.info({ name: m.name, executed: !!m.executedAt }, `Migration: ${m.name}`);
    }
    await destroyDatabase();
    await destroyPool();
    return;
  } else {
    logger.error({ command }, 'Unknown command. Use: up, down, list');
    process.exit(1);
  }

  if (result.error) {
    logger.error({ err: result.error }, 'Migration failed');
    process.exit(1);
  }

  if (result.results) {
    for (const r of result.results) {
      logger.info({ name: r.migrationName, status: r.status }, `Migration ${r.status}`);
    }
  }

  await destroyDatabase();
}

main().catch((err) => {
  logger.error({ err }, 'Migration script failed');
  process.exit(1);
});