import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE merchandising_banners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
      placement VARCHAR(80) NOT NULL, headline VARCHAR(240), body TEXT,
      desktop_image_url TEXT NOT NULL, mobile_image_url TEXT, alt_text VARCHAR(300) NOT NULL,
      target_type VARCHAR(30) NOT NULL DEFAULT 'url' CHECK (target_type IN ('product', 'category', 'collection', 'campaign', 'promotion', 'url', 'none')),
      target_id UUID, target_url TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT banner_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
      CONSTRAINT banner_target CHECK ((target_type = 'none' AND target_id IS NULL AND target_url IS NULL) OR (target_type = 'url' AND target_url IS NOT NULL) OR (target_type NOT IN ('none', 'url') AND target_id IS NOT NULL))
    )
  `.execute(db);
  await sql`CREATE INDEX idx_banners_public ON merchandising_banners (placement, status, priority DESC, id)`.execute(db);
  await sql`CREATE INDEX idx_banners_schedule ON merchandising_banners (starts_at, ends_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS merchandising_banners`.execute(db);
}
