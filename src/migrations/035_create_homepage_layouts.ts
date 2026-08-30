import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE homepage_layouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
      slug VARCHAR(180) NOT NULL UNIQUE, status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100000 AND 100000),
      starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT homepage_layout_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
    )
  `.execute(db);
  await sql`
    CREATE TABLE homepage_sections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), layout_id UUID NOT NULL REFERENCES homepage_layouts(id) ON DELETE CASCADE,
      section_key VARCHAR(120) NOT NULL, section_type VARCHAR(40) NOT NULL
        CHECK (section_type IN ('hero', 'banner_strip', 'collection_grid', 'product_carousel', 'category_grid', 'campaign_feature', 'promotion_callout', 'editorial')),
      title VARCHAR(240), subtitle TEXT, source_type VARCHAR(30) NOT NULL DEFAULT 'none'
        CHECK (source_type IN ('none', 'collection', 'category', 'campaign', 'promotion', 'banner_placement')),
      source_id UUID, source_key VARCHAR(180), config JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL CHECK (position >= 0), enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (layout_id, section_key), UNIQUE (layout_id, position),
      CONSTRAINT homepage_section_source CHECK (
        (source_type = 'none' AND source_id IS NULL AND source_key IS NULL) OR
        (source_type IN ('collection', 'category', 'campaign', 'promotion') AND source_id IS NOT NULL) OR
        (source_type = 'banner_placement' AND source_key IS NOT NULL)
      )
    )
  `.execute(db);
  await sql`CREATE INDEX idx_homepage_layouts_public ON homepage_layouts (status, priority DESC, slug, id)`.execute(db);
  await sql`CREATE INDEX idx_homepage_layouts_schedule ON homepage_layouts (starts_at, ends_at)`.execute(db);
  await sql`CREATE INDEX idx_homepage_sections_layout ON homepage_sections (layout_id, position, id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS homepage_sections`.execute(db);
  await sql`DROP TABLE IF EXISTS homepage_layouts`.execute(db);
}
