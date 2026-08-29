import { Kysely, sql } from 'kysely';

/**
 * Migration 028: Admin login challenges for two-factor authentication.
 *
 * Stores login challenges in PostgreSQL (not in-memory) for multi-process
 * correctness. OTPs are stored as SHA-256 hashes — never in plain text.
 * Challenges are one-time-use with expiry, attempt limits, and cooldown.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE admin_login_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      otp_hash VARCHAR(64) NOT NULL,
      masked_mobile VARCHAR(20) NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      expires_at TIMESTAMPTZ NOT NULL,
      verified_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  // Index for looking up challenges by ID during verification
  await sql`
    CREATE INDEX idx_admin_login_challenges_id ON admin_login_challenges (id);
  `.execute(db);

  // Index for rate limiting per user
  await sql`
    CREATE INDEX idx_admin_login_challenges_user_id ON admin_login_challenges (user_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS admin_login_challenges`.execute(db);
}