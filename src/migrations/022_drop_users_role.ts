import { Kysely, sql } from 'kysely';

/**
 * Migration 022: Remove deprecated users.role column.
 *
 * RBAC now relies solely on the roles + user_roles tables.
 * The users.role column was deprecated in migration 021 and
 * is no longer referenced by any application code.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS role`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin'))
  `.execute(db);
}