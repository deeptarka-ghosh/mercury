import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
      amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed')),
      provider VARCHAR(50),
      provider_ref VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_payments_order_id ON payments (order_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS payments`.execute(db);
}