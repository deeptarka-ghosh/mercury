import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  `.execute(db);

  await sql`
    CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
  `.execute(db);

  await sql`
    CREATE INDEX idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_products_name_trgm`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_products_description_trgm`.execute(db);
}