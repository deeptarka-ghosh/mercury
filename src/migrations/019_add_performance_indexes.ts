import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Index on orders.status — supports analytics GROUP BY queries
  await sql`
    CREATE INDEX idx_orders_status ON orders (status);
  `.execute(db);

  // Index on payments.status — supports revenue analytics queries
  await sql`
    CREATE INDEX idx_payments_status ON payments (status);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_orders_status`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_payments_status`.execute(db);
}