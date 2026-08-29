import { Kysely, sql } from 'kysely';

/**
 * Migration 031: Returns, exchanges, COD, and shipment tracking.
 *
 * - return_requests: parent return request with status workflow
 * - return_line_items: items being returned, reasons, restock choice
 * - exchange: links a return to a replacement variant
 * - payments: add COD flag and reconciliation state
 * - order_shipping: add tracking provider, number, URL
 * - order_shipping: add status history reference
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Return requests
  await sql`
    CREATE TABLE return_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'goods_received', 'refund_initiated', 'refunded', 'closed')),
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_return_requests_order_id ON return_requests (order_id);
  `.execute(db);

  await sql`
    CREATE INDEX idx_return_requests_user_id ON return_requests (user_id);
  `.execute(db);

  // Return line items
  await sql`
    CREATE TABLE return_line_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
      order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      return_reason VARCHAR(100),
      is_restockable BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_return_line_items_return_id ON return_line_items (return_request_id);
  `.execute(db);

  // Exchange requests (optional link from return to replacement variant)
  await sql`
    CREATE TABLE exchange_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
      replacement_variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'shipped', 'completed', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_exchange_requests_return_id ON exchange_requests (return_request_id);
  `.execute(db);

  // Add COD and reconciliation fields to payments
  await sql`
    ALTER TABLE payments
    ADD COLUMN payment_method VARCHAR(20) CHECK (payment_method IN ('cod', 'prepaid', 'card', 'upi', 'netbanking')),
    ADD COLUMN reconciliation_status VARCHAR(20) CHECK (reconciliation_status IN ('pending', 'settled', 'failed'))
  `.execute(db);

  // Add tracking fields to order_shipping
  await sql`
    ALTER TABLE order_shipping
    ADD COLUMN tracking_provider VARCHAR(100),
    ADD COLUMN tracking_number VARCHAR(100),
    ADD COLUMN tracking_url VARCHAR(500)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE order_shipping DROP COLUMN IF EXISTS tracking_url`.execute(db);
  await sql`ALTER TABLE order_shipping DROP COLUMN IF EXISTS tracking_number`.execute(db);
  await sql`ALTER TABLE order_shipping DROP COLUMN IF EXISTS tracking_provider`.execute(db);
  await sql`ALTER TABLE payments DROP COLUMN IF EXISTS reconciliation_status`.execute(db);
  await sql`ALTER TABLE payments DROP COLUMN IF EXISTS payment_method`.execute(db);
  await sql`DROP TABLE IF EXISTS exchange_requests`.execute(db);
  await sql`DROP TABLE IF EXISTS return_line_items`.execute(db);
  await sql`DROP TABLE IF EXISTS return_requests`.execute(db);
}