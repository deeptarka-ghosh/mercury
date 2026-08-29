import { Kysely, sql } from 'kysely';

/**
 * Migration 027: Add customer status management.
 *
 * Adds a status column to users for enabling/disabling customer accounts.
 * Existing users are active by default.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled'))
  `.execute(db);

  // Index for filtering customers by status
  await sql`
    CREATE INDEX idx_users_status ON users (status);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_users_status`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS status`.execute(db);
}