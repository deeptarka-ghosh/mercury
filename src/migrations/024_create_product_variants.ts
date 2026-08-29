import { Kysely, sql } from 'kysely';

/**
 * Migration 024: Product variants model.
 *
 * Creates the product_variants table with sellable inventory at variant level.
 * Generates a deterministic default variant for every existing product to
 * preserve backward compatibility with existing prices, inventory, carts,
 * and orders.
 *
 * Backward-compatibility guarantees:
 * - Existing products without variants receive one "Default" variant
 * - The default variant's SKU is "<product_slug>-default"
 * - Selling price copies from the prices table (or 0 if no price exists)
 * - MRP is set equal to selling price (cost_price left null)
 * - Inventory quantity copies from the inventory table (or 0)
 * - size = 'Default', colour_name = 'Default', status = 'active'
 * - Existing product-level price/inventory APIs still work for products
 *   with a single default variant (they operate on that default variant)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Create product_variants table
  await sql`
    CREATE TABLE product_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku VARCHAR(100) NOT NULL,
      barcode VARCHAR(100),
      size VARCHAR(50) NOT NULL,
      colour_name VARCHAR(100) NOT NULL,
      colour_code VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      selling_price NUMERIC(10,2) NOT NULL CHECK (selling_price >= 0),
      mrp NUMERIC(10,2) NOT NULL CHECK (mrp >= 0),
      cost_price NUMERIC(10,2) CHECK (cost_price >= 0),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      low_stock_threshold INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT mrp_ge_selling_price CHECK (mrp >= selling_price)
    );
  `.execute(db);

  // Unique SKU
  await sql`
    CREATE UNIQUE INDEX idx_product_variants_sku ON product_variants (sku);
  `.execute(db);

  // Unique barcode (when present)
  await sql`
    CREATE UNIQUE INDEX idx_product_variants_barcode
    ON product_variants (barcode)
    WHERE barcode IS NOT NULL;
  `.execute(db);

  // Index for product lookups
  await sql`
    CREATE INDEX idx_product_variants_product_id ON product_variants (product_id);
  `.execute(db);

  // Index for variant status
  await sql`
    CREATE INDEX idx_product_variants_status ON product_variants (status);
  `.execute(db);

  // Generate default variants for ALL existing products
  // Uses slug as base for deterministic SKU, copies price and inventory
  await sql`
    INSERT INTO product_variants (product_id, sku, size, colour_name, status, selling_price, mrp, quantity, created_at, updated_at)
    SELECT
      p.id,
      CONCAT(p.slug, '-default'),
      'Default',
      'Default',
      'active',
      COALESCE(pr.amount, 0),
      COALESCE(pr.amount, 0),
      COALESCE(i.quantity, 0),
      now(),
      now()
    FROM products p
    LEFT JOIN prices pr ON pr.product_id = p.id
    LEFT JOIN inventory i ON i.product_id = p.id
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS product_variants`.execute(db);
}