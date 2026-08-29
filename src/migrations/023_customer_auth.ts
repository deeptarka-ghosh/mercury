import { Kysely, sql } from 'kysely';

/**
 * Migration 023: Customer authentication model.
 *
 * - Adds mobile_number and mobile_verified_at to users table
 * - Creates user_identities table for provider-linked logins
 * - UNIQUE constraint on verified mobile numbers
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Add mobile fields to users
  await sql`
    ALTER TABLE users
    ADD COLUMN mobile_number VARCHAR(20),
    ADD COLUMN mobile_verified_at TIMESTAMPTZ
  `.execute(db);

  // Unique index on verified mobile numbers — prevents duplicate verified mobiles
  // but allows multiple unverified or null entries
  await sql`
    CREATE UNIQUE INDEX idx_users_verified_mobile
    ON users (mobile_number)
    WHERE mobile_number IS NOT NULL AND mobile_verified_at IS NOT NULL
  `.execute(db);

  // Create user_identities table
  await sql`
    CREATE TABLE user_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(30) NOT NULL CHECK (provider IN ('email', 'google', 'apple', 'facebook', 'mobile')),
      provider_subject VARCHAR(255) NOT NULL,
      provider_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_user_identities_provider
    ON user_identities (provider, provider_subject);
  `.execute(db);

  await sql`
    CREATE INDEX idx_user_identities_user_id
    ON user_identities (user_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_identities`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_users_verified_mobile`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS mobile_number`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS mobile_verified_at`.execute(db);
}