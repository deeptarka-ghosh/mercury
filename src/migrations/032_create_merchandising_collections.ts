import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE merchandising_collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
      slug VARCHAR(180) NOT NULL UNIQUE, description TEXT,
      collection_type VARCHAR(40) NOT NULL DEFAULT 'curated' CHECK (collection_type IN ('curated', 'featured', 'seasonal', 'new_arrivals', 'trending', 'best_sellers', 'recommended', 'category', 'deals')),
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT merchandising_collection_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
    )
  `.execute(db);
  await sql`
    CREATE TABLE merchandising_collection_products (
      collection_id UUID NOT NULL REFERENCES merchandising_collections(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_id, product_id), UNIQUE (collection_id, position)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_merchandising_collections_public ON merchandising_collections (status, priority DESC, slug)`.execute(db);
  await sql`CREATE INDEX idx_merchandising_collections_schedule ON merchandising_collections (starts_at, ends_at)`.execute(db);
  await sql`CREATE INDEX idx_merchandising_collection_products_product ON merchandising_collection_products (product_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS merchandising_collection_products`.execute(db);
  await sql`DROP TABLE IF EXISTS merchandising_collections`.execute(db);
}
