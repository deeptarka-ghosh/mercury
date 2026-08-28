import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add role column with CHECK constraint for valid values
  await sql`
    ALTER TABLE users
    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users DROP COLUMN IF EXISTS role
  `.execute(db);
}