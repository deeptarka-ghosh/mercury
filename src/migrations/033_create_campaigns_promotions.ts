import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE merchandising_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
      slug VARCHAR(180) NOT NULL UNIQUE, description TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT merchandising_campaign_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
    )
  `.execute(db);
  await sql`
    CREATE TABLE merchandising_campaign_collections (
      campaign_id UUID NOT NULL REFERENCES merchandising_campaigns(id) ON DELETE CASCADE,
      collection_id UUID NOT NULL REFERENCES merchandising_collections(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (campaign_id, collection_id), UNIQUE (campaign_id, position)
    )
  `.execute(db);
  await sql`
    CREATE TABLE promotions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
      code VARCHAR(60) UNIQUE, description TEXT,
      discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
      discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
      minimum_order_amount NUMERIC(12,2) CHECK (minimum_order_amount IS NULL OR minimum_order_amount >= 0),
      collection_id UUID REFERENCES merchandising_collections(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
      priority INTEGER NOT NULL DEFAULT 0, stackable BOOLEAN NOT NULL DEFAULT false,
      starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT promotion_percentage CHECK (discount_type <> 'percentage' OR discount_value <= 100),
      CONSTRAINT promotion_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_campaigns_public ON merchandising_campaigns (status, priority DESC, slug)`.execute(db);
  await sql`CREATE INDEX idx_campaigns_schedule ON merchandising_campaigns (starts_at, ends_at)`.execute(db);
  await sql`CREATE INDEX idx_promotions_public ON promotions (status, priority DESC, id)`.execute(db);
  await sql`CREATE INDEX idx_promotions_schedule ON promotions (starts_at, ends_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS promotions`.execute(db);
  await sql`DROP TABLE IF EXISTS merchandising_campaign_collections`.execute(db);
  await sql`DROP TABLE IF EXISTS merchandising_campaigns`.execute(db);
}
