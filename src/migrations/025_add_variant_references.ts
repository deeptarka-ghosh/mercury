import { Kysely, sql } from 'kysely';

/**
 * Migration 025: Add variant references to cart_items, order_items, wishlist_items.
 *
 * All new columns are nullable for backward compatibility with existing data.
 * Order items gain additional snapshot columns (variant_sku, variant_size,
 * variant_colour) so historical order records remain valid.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- cart_items ---
  await sql`
    ALTER TABLE cart_items
    ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_cart_items_variant_id ON cart_items (variant_id);
  `.execute(db);

  // New unique constraint for (user_id, variant_id) — null variant_id not affected
  await sql`
    CREATE UNIQUE INDEX idx_cart_items_user_variant
    ON cart_items (user_id, variant_id)
    WHERE variant_id IS NOT NULL;
  `.execute(db);

  // --- order_items ---
  await sql`
    ALTER TABLE order_items
    ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    ADD COLUMN variant_sku VARCHAR(100),
    ADD COLUMN variant_size VARCHAR(50),
    ADD COLUMN variant_colour VARCHAR(100)
  `.execute(db);

  await sql`
    CREATE INDEX idx_order_items_variant_id ON order_items (variant_id);
  `.execute(db);

  // --- wishlist_items ---
  await sql`
    ALTER TABLE wishlist_items
    ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_wishlist_items_variant_id ON wishlist_items (variant_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_cart_items_user_variant`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_cart_items_variant_id`.execute(db);
  await sql`ALTER TABLE cart_items DROP COLUMN IF EXISTS variant_id`.execute(db);

  await sql`DROP INDEX IF EXISTS idx_order_items_variant_id`.execute(db);
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS variant_colour`.execute(db);
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS variant_size`.execute(db);
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS variant_sku`.execute(db);
  await sql`ALTER TABLE order_items DROP COLUMN IF EXISTS variant_id`.execute(db);

  await sql`DROP INDEX IF EXISTS idx_wishlist_items_variant_id`.execute(db);
  await sql`ALTER TABLE wishlist_items DROP COLUMN IF EXISTS variant_id`.execute(db);
}