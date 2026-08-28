import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import type { DB } from './types.js';

let db: Kysely<DB> | null = null;

export function createDatabase(pool: Pool): Kysely<DB> {
  if (db) {
    return db;
  }

  db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });

  return db;
}

export function getDatabase(): Kysely<DB> {
  if (!db) {
    throw new Error('Database not initialized. Call createDatabase() first.');
  }
  return db;
}

export async function destroyDatabase(): Promise<void> {
  if (!db) {
    return;
  }

  await db.destroy();
  db = null;
}