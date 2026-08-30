import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE recommendation_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
      placement VARCHAR(80) NOT NULL, strategy VARCHAR(30) NOT NULL
        CHECK (strategy IN ('manual', 'collection', 'category', 'new_arrivals', 'best_sellers')),
      source_id UUID, explanation VARCHAR(300) NOT NULL, result_limit INTEGER NOT NULL DEFAULT 12
        CHECK (result_limit BETWEEN 1 AND 100), status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'archived')), priority INTEGER NOT NULL DEFAULT 0
        CHECK (priority BETWEEN -100000 AND 100000), starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT recommendation_rule_schedule CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
      CONSTRAINT recommendation_rule_source CHECK (
        (strategy IN ('collection', 'category') AND source_id IS NOT NULL) OR
        (strategy NOT IN ('collection', 'category') AND source_id IS NULL)
      )
    )
  `.execute(db);
  await sql`
    CREATE TABLE recommendation_rule_products (
      rule_id UUID NOT NULL REFERENCES recommendation_rules(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (rule_id, product_id), UNIQUE (rule_id, position)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_recommendation_rules_public ON recommendation_rules (placement, status, priority DESC, id)`.execute(db);
  await sql`CREATE INDEX idx_recommendation_rules_schedule ON recommendation_rules (starts_at, ends_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS recommendation_rule_products`.execute(db);
  await sql`DROP TABLE IF EXISTS recommendation_rules`.execute(db);
}
