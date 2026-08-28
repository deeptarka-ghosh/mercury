import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled')),
      total NUMERIC(10, 2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_orders_user_id ON orders (user_id);
  `.execute(db);

  await sql`
    CREATE TABLE order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name VARCHAR(255) NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(10, 2),
      line_total NUMERIC(10, 2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_order_items_order_id ON order_items (order_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS order_items`.execute(db);
  await sql`DROP TABLE IF EXISTS orders`.execute(db);
}