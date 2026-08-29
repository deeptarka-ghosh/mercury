import { Kysely, sql } from 'kysely';

/**
 * Migration 030: HSN codes and tax fields.
 *
 * Adds HSN code and tax rate to product_variants for India GST compliance.
 * Adds tax snapshot columns to order_items for historical invoice stability.
 * Tax rate is stored as NUMERIC(5,2) representing percentage (e.g. 18.00 for 18%).
 * Existing order_items get null tax snapshots.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // HSN code on product_variants (optional, max 8 chars for India GST HSN)
  await sql`
    ALTER TABLE product_variants
    ADD COLUMN hsn_code VARCHAR(8),
    ADD COLUMN tax_rate NUMERIC(5,2) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100))
  `.execute(db);

  // Tax snapshots on order_items (for historical invoice stability)
  await sql`
    ALTER TABLE order_items
    ADD COLUMN hsn_code VARCHAR(8),
    ADD COLUMN tax_rate NUMERIC(5,2),
    ADD COLUMN tax_amount NUMERIC(10,2)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS tax_amount`.execute(db);
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS tax_rate`.execute(db);
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS hsn_code`.execute(db);
  await sql`ALTER TABLE product_variants DROP COLUMN IF EXISTS tax_rate`.execute(db);
  await sql`ALTER TABLE product_variants DROP COLUMN IF EXISTS hsn_code`.execute(db);
}