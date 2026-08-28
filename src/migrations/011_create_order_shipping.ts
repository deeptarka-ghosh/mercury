import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE order_shipping (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'shipped', 'delivered', 'cancelled')),
      recipient_name VARCHAR(255) NOT NULL,
      address_line1 VARCHAR(255) NOT NULL,
      address_line2 VARCHAR(255),
      city VARCHAR(120) NOT NULL,
      state VARCHAR(120) NOT NULL,
      postal_code VARCHAR(20) NOT NULL,
      country_code VARCHAR(3) NOT NULL,
      phone VARCHAR(30),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_order_shipping_order_id ON order_shipping (order_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS order_shipping`.execute(db);
}