import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE categories ADD COLUMN audience VARCHAR(30), ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0, ADD CONSTRAINT categories_audience CHECK (audience IS NULL OR audience IN ('men','women','kids','unisex'))`.execute(db);
  await sql`ALTER TABLE products ADD COLUMN audience VARCHAR(30), ADD COLUMN material VARCHAR(160), ADD COLUMN fit VARCHAR(80), ADD COLUMN care_instructions TEXT, ADD COLUMN badge VARCHAR(80), ADD COLUMN merchandising_priority INTEGER NOT NULL DEFAULT 0, ADD CONSTRAINT products_audience CHECK (audience IS NULL OR audience IN ('men','women','kids','unisex')), ADD CONSTRAINT products_merchandising_priority CHECK (merchandising_priority BETWEEN -100000 AND 100000)`.execute(db);
  await sql`CREATE TABLE product_categories (product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (product_id, category_id), UNIQUE (product_id, position))`.execute(db);
  await sql`INSERT INTO product_categories (product_id,category_id,position) SELECT id,category_id,0 FROM products WHERE category_id IS NOT NULL ON CONFLICT DO NOTHING`.execute(db);
  await sql`CREATE INDEX idx_product_categories_category ON product_categories (category_id, position, product_id)`.execute(db);
  await sql`CREATE INDEX idx_products_audience_priority ON products (audience, merchandising_priority DESC, id)`.execute(db);
  await sql`CREATE TABLE customer_addresses (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, label VARCHAR(80) NOT NULL, recipient_name VARCHAR(255) NOT NULL, address_line1 VARCHAR(255) NOT NULL, address_line2 VARCHAR(255), city VARCHAR(120) NOT NULL, state VARCHAR(120) NOT NULL, postal_code VARCHAR(20) NOT NULL, country_code VARCHAR(3) NOT NULL DEFAULT 'IN', phone VARCHAR(30), is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_customer_addresses_one_default ON customer_addresses (user_id) WHERE is_default`.execute(db);
  await sql`CREATE INDEX idx_customer_addresses_user ON customer_addresses (user_id, created_at, id)`.execute(db);
  await sql`CREATE TABLE customer_preferences (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, audiences TEXT[] NOT NULL DEFAULT '{}', category_ids UUID[] NOT NULL DEFAULT '{}', size_preferences JSONB NOT NULL DEFAULT '{}'::jsonb, preferred_colours TEXT[] NOT NULL DEFAULT '{}', personalization_consent BOOLEAN NOT NULL DEFAULT false, marketing_consent BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE customer_behavior_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('product_view','search','collection_view','wishlist_add','cart_add','purchase')), product_id UUID REFERENCES products(id) ON DELETE SET NULL, collection_id UUID REFERENCES merchandising_collections(id) ON DELETE SET NULL, category_id UUID REFERENCES categories(id) ON DELETE SET NULL, search_query VARCHAR(200), occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT behavior_event_subject CHECK (product_id IS NOT NULL OR collection_id IS NOT NULL OR category_id IS NOT NULL OR search_query IS NOT NULL))`.execute(db);
  await sql`CREATE INDEX idx_behavior_events_user_time ON customer_behavior_events (user_id, occurred_at DESC, id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS customer_behavior_events`.execute(db);
  await sql`DROP TABLE IF EXISTS customer_preferences`.execute(db);
  await sql`DROP TABLE IF EXISTS customer_addresses`.execute(db);
  await sql`DROP TABLE IF EXISTS product_categories`.execute(db);
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_merchandising_priority, DROP CONSTRAINT IF EXISTS products_audience, DROP COLUMN IF EXISTS merchandising_priority, DROP COLUMN IF EXISTS badge, DROP COLUMN IF EXISTS care_instructions, DROP COLUMN IF EXISTS fit, DROP COLUMN IF EXISTS material, DROP COLUMN IF EXISTS audience`.execute(db);
  await sql`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_audience, DROP COLUMN IF EXISTS sort_order, DROP COLUMN IF EXISTS audience`.execute(db);
}
