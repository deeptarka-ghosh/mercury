import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE order_shipping ALTER COLUMN country_code DROP DEFAULT;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE order_shipping ALTER COLUMN country_code SET DEFAULT 'US';
  `.execute(db);
}