import { Kysely, sql } from 'kysely';

/**
 * Migration 029: Centralized store configuration.
 *
 * Creates a singleton store_settings table for India-specific commerce config.
 * Seeds a default row with INR, Asia/Kolkata, en-IN.
 * Existing USD records in payments/orders remain unchanged.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE store_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_name VARCHAR(255) NOT NULL DEFAULT 'Mercury Store',
      default_currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      country_code VARCHAR(3) NOT NULL DEFAULT 'IN',
      timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
      locale VARCHAR(20) NOT NULL DEFAULT 'en-IN',
      gstin VARCHAR(50),
      legal_business_name VARCHAR(255),
      business_address TEXT,
      support_email VARCHAR(255),
      support_mobile VARCHAR(20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  // Seed the default row (singleton pattern: only one row allowed)
  await sql`
    INSERT INTO store_settings (store_name, default_currency, country_code, timezone, locale)
    VALUES ('Mercury Store', 'INR', 'IN', 'Asia/Kolkata', 'en-IN')
  `.execute(db);

  // Change default currency on payments table from USD to INR for new records
  // Existing records retain their original currency
  await sql`
    ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'INR';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'USD'`.execute(db);
  await sql`DROP TABLE IF EXISTS store_settings`.execute(db);
}