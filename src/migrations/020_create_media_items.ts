import { Kysely, sql } from 'kysely';

/**
 * Migration 020: Create media_items and product_media_sorts tables.
 *
 * media_items stores uploaded file metadata with a polymorphic
 * relationship to entity types (product, review). Files are stored
 * once and referenced from the owning entity via entity_type + entity_id.
 *
 * Each media item records the uploader (user_id) for ownership checks.
 *
 * product_media_sorts provides an explicit ordering for product media,
 * since review media uses creation order (most recent first).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE media_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('product', 'review')),
      entity_id UUID NOT NULL,
      file_type VARCHAR(10) NOT NULL CHECK (file_type IN ('image', 'video')),
      mime_type VARCHAR(100) NOT NULL,
      original_name TEXT,
      storage_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_seconds NUMERIC(10, 3),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_media_items_entity
    ON media_items (entity_type, entity_id);
  `.execute(db);

  await sql`
    CREATE INDEX idx_media_items_user_id
    ON media_items (user_id);
  `.execute(db);

  await sql`
    CREATE TABLE product_media_sorts (
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      media_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, media_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS product_media_sorts`.execute(db);
  await sql`DROP TABLE IF EXISTS media_items`.execute(db);
}