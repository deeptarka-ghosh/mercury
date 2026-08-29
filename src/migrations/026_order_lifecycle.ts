import { Kysely, sql } from 'kysely';

/**
 * Migration 026: Order lifecycle expansion.
 *
 * Extends the order status CHECK to support the full admin order lifecycle.
 * Creates order_status_history and order_refunds tables.
 * Backfills a current-status history row for every existing order.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Widen the orders.status CHECK constraint
  await sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`.execute(db);

  await sql`
    ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN (
      'pending', 'confirmed', 'processing', 'packed',
      'shipped', 'delivered', 'cancelled',
      'return_requested', 'returned',
      'partially_refunded', 'refunded'
    ))
  `.execute(db);

  // 2. Add cancelled_at column (nullable, set on cancellation)
  await sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ
  `.execute(db);
  
  // 3. Add order_status_history table
  await sql`
    CREATE TABLE order_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      from_status VARCHAR(30),
      to_status VARCHAR(30) NOT NULL,
      changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_order_status_history_order_id ON order_status_history (order_id);
  `.execute(db);

  // 4. Create order_refunds table
  await sql`
    CREATE TABLE order_refunds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      provider_ref VARCHAR(255),
      processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_order_refunds_order_id ON order_refunds (order_id);
  `.execute(db);

  // 5. Backfill: insert status history rows for existing orders
  await sql`
    INSERT INTO order_status_history (order_id, from_status, to_status, created_at)
    SELECT id, NULL, status, created_at
    FROM orders
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS order_refunds`.execute(db);
  await sql`DROP TABLE IF EXISTS order_status_history`.execute(db);
  await sql`ALTER TABLE orders DROP COLUMN IF EXISTS cancelled_at`.execute(db);

  // Restore original CHECK
  await sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`.execute(db);
  await sql`
    ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled'))
  `.execute(db);
}