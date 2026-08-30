# Mercury — Database Schema

## Clothing catalog and customer signals (migrations 037–038)

Categories and products include audience and deterministic sort/merchandising
priority. Products also expose material, fit, care, and badge metadata;
`product_categories` supports ordered many-to-many taxonomy membership.
`customer_addresses`, `customer_preferences`, and `customer_behavior_events`
are all user-owned with cascading cleanup. One partial unique index enforces one
default address per customer. Behavior storage requires application-level
personalization consent and contains constrained event subjects only.

## Recommendation rules (migration 036)

`recommendation_rules` stores placement, explainable strategy, optional source,
result limit, publication state, priority, and schedule. Source-shape checks
prevent ambiguous strategies. `recommendation_rule_products` provides unique,
explicit ordering for manual rules. Public selection is priority then stable ID;
strategy results always use deterministic secondary ordering.

## Homepage layouts (migration 035)

`homepage_layouts` provides named, slug-addressable, scheduled publications.
`homepage_sections` stores an ordered, uniquely keyed set of enabled content
blocks with a constrained section/source type, optional entity or banner
placement reference, and extensible JSONB configuration. Cascading deletion and
per-layout unique key/position constraints make atomic section replacement safe.

## Merchandising banners (migration 034)

`merchandising_banners` stores placement-addressable responsive creative with
desktop and optional mobile image URLs, required alt text, typed destinations,
draft/active/archived state, priority, and an optional publication window.
Database checks enforce valid states, target types, schedule order, target
shape, and bounded priority. Public resolution is deterministic by placement,
priority descending, then ID.

## Campaigns and promotions (migration 033)

`merchandising_campaigns` and `merchandising_campaign_collections` provide
scheduled campaign shells with deterministic collection placement.
`promotions` stores percentage or fixed-amount offers, optional codes and
collection scope, minimum-order amount, stacking policy, schedule and priority.

## Merchandising collections (migration 032)

`merchandising_collections` stores named, slug-addressable merchandising units
with type, publication status, integer priority, and optional start/end window.
`merchandising_collection_products` is an ordered many-to-many link. Its primary
key prevents duplicate products and its `(collection_id, position)` uniqueness
constraint prevents ambiguous rank.

## Overview

All data is stored in PostgreSQL. Kysely provides type-safe query building. The schema is defined by 23 ordered migrations in `src/migrations/`.

### Migration chain

| # | Migration | Type |
|---|-----------|------|
| 001 | `create_users` | Table |
| 002 | `create_refresh_tokens` | Table |
| 003 | `create_profiles` | Table |
| 004 | `create_categories` | Table |
| 005 | `create_products` | Table |
| 006 | `create_inventory` | Table |
| 007 | `create_prices` | Table |
| 008 | `create_cart_items` | Table |
| 009 | `create_orders` + `order_items` | Tables |
| 010 | `create_payments` | Table |
| 011 | `create_order_shipping` | Table |
| 012 | `drop_default_country_code` | Alter |
| 013 | `create_notifications` | Table |
| 014 | `create_search_indexes` | Indexes (pg_trgm) |
| 015 | `create_reviews` | Table |
| 016 | `create_wishlist_items` | Table |
| 017 | `add_user_role` | Alter (add column) |
| 018 | `create_audit_log` | Table |
| 019 | `add_performance_indexes` | Indexes |
| 020 | `create_media_items` | Tables (media_items + product_media_sorts) |
| 021 | `create_rbac` | Tables (roles + user_roles), seed 4 roles, migrate admin users |
| 022 | `drop_users_role` | Alter (drop deprecated column `role` from users) |
| 023 | `create_customer_auth` | Alter (add mobile fields to users) + Table (user_identities) |

### Migration behavior

- `pnpm run migrate` — runs all pending migrations up
- `pnpm run migrate:down` — runs one `down()` step (use with caution)
- `pnpm run migrate:list` — shows migration status
- Kysely's `kysely_migration_lock` table prevents concurrent migrations
- All down migrations exist but are **not CI-tested**; prefer backup-based rollback

---

## Tables

### users

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE | |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt hash |
| `mobile_number` | VARCHAR(20) | | E.164 format, unique when verified |
| `mobile_verified_at` | TIMESTAMPTZ | | Set after OTP verification |
| `email_verified_at` | TIMESTAMPTZ | | Nullable; no email verification implemented |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: partial unique index `idx_users_verified_mobile` ON (mobile_number) WHERE mobile_number IS NOT NULL AND mobile_verified_at IS NOT NULL

### user_identities

Linked authentication providers for a user (email, google, apple, facebook, mobile). Added in migration 023.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `provider` | VARCHAR(30) | NOT NULL, CHECK (IN ('email','google','apple','facebook','mobile')) | |
| `provider_subject` | VARCHAR(255) | NOT NULL | Stable external subject ID |
| `provider_email` | VARCHAR(255) | | Nullable (Apple may use private relay) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: UNIQUE (provider, provider_subject), idx_user_identities_user_id

### refresh_tokens

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `token_hash` | VARCHAR(255) | NOT NULL | SHA-256 of the actual refresh token |
| `expires_at` | TIMESTAMPTZ | NOT NULL | 7 days from creation |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

Indexes: `idx_refresh_tokens_token_hash`, `idx_refresh_tokens_user_id`

### profiles

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, UNIQUE, FK → users(id) ON DELETE CASCADE | One profile per user |
| `display_name` | VARCHAR(100) | | Nullable |
| `bio` | VARCHAR(500) | | Nullable |
| `avatar_url` | VARCHAR(500) | | Nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Index: `idx_profiles_user_id`

### categories

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `name` | VARCHAR(100) | NOT NULL | |
| `slug` | VARCHAR(120) | NOT NULL, UNIQUE | URL-friendly identifier |
| `description` | VARCHAR(500) | | Nullable |
| `parent_id` | UUID | FK → categories(id) ON DELETE SET NULL | Self-referencing hierarchy |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Index: `idx_categories_parent_id`

### products

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `name` | VARCHAR(255) | NOT NULL | |
| `slug` | VARCHAR(280) | NOT NULL, UNIQUE | URL-friendly identifier |
| `description` | TEXT | | Nullable |
| `status` | VARCHAR(20) | NOT NULL DEFAULT 'draft', CHECK (IN ('draft','active','archived')) | Only `active` is publicly visible |
| `category_id` | UUID | FK → categories(id) ON DELETE SET NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: `idx_products_category_id`, `idx_products_status`
GIN indexes (migration 014): `idx_products_name_trgm`, `idx_products_description_trgm`

### inventory

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `product_id` | UUID | PK, FK → products(id) ON DELETE CASCADE | One row per product |
| `quantity` | INTEGER | NOT NULL DEFAULT 0, CHECK (>= 0) | **Missing row = zero stock** |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

No separate index — PK is on product_id.

### prices

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `product_id` | UUID | PK, FK → products(id) ON DELETE CASCADE | One row per product |
| `amount` | NUMERIC(10,2) | NOT NULL, CHECK (>= 0) | Money — never use JS floating-point |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

### cart_items

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `product_id` | UUID | NOT NULL, FK → products(id) ON DELETE CASCADE | |
| `quantity` | INTEGER | NOT NULL, CHECK (> 0) | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| | | UNIQUE(user_id, product_id) | Prevents duplicate product rows |

Index: `idx_cart_items_user_id`

### orders

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE RESTRICT | Cannot delete users with orders |
| `status` | VARCHAR(20) | NOT NULL DEFAULT 'pending', CHECK (IN ('pending','confirmed','cancelled')) | |
| `total` | NUMERIC(10,2) | | Nullable for unpriced-only orders |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: `idx_orders_user_id`, `idx_orders_status` (migration 019)

### order_items

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `order_id` | UUID | NOT NULL, FK → orders(id) ON DELETE CASCADE | |
| `product_id` | UUID | NOT NULL, FK → products(id) ON DELETE RESTRICT | Cannot delete product with order items |
| `product_name` | VARCHAR(255) | NOT NULL | Snapshot at checkout time |
| `quantity` | INTEGER | NOT NULL, CHECK (> 0) | |
| `unit_price` | NUMERIC(10,2) | | Snapshot at checkout time; nullable for unpriced products |
| `line_total` | NUMERIC(10,2) | | quantity * unit_price; nullable if unpriced |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Index: `idx_order_items_order_id`

### payments

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `order_id` | UUID | NOT NULL, UNIQUE, FK → orders(id) ON DELETE RESTRICT | One payment per order |
| `amount` | NUMERIC(10,2) | NOT NULL, CHECK (>= 0) | Sourced from order total, never client |
| `currency` | VARCHAR(3) | NOT NULL DEFAULT 'USD' | |
| `status` | VARCHAR(20) | NOT NULL DEFAULT 'pending', CHECK (IN ('pending','completed','failed')) | |
| `provider` | VARCHAR(50) | | Future: payment provider name |
| `provider_ref` | VARCHAR(255) | | Future: payment provider reference ID |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: `idx_payments_order_id`, `idx_payments_status` (migration 019)

### order_shipping

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `order_id` | UUID | NOT NULL, UNIQUE, FK → orders(id) ON DELETE CASCADE | One shipping per order |
| `status` | VARCHAR(20) | NOT NULL DEFAULT 'pending', CHECK (IN ('pending','shipped','delivered','cancelled')) | |
| `recipient_name` | VARCHAR(255) | NOT NULL | Snapshot at creation time |
| `address_line1` | VARCHAR(255) | NOT NULL | |
| `address_line2` | VARCHAR(255) | | Nullable |
| `city` | VARCHAR(120) | NOT NULL | |
| `state` | VARCHAR(120) | NOT NULL | |
| `postal_code` | VARCHAR(20) | NOT NULL | |
| `country_code` | VARCHAR(3) | NOT NULL | |
| `phone` | VARCHAR(30) | | Nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Index: `idx_order_shipping_order_id`

### notifications

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `type` | VARCHAR(30) | NOT NULL, CHECK (IN ('order_created','payment_completed','payment_failed')) | |
| `title` | VARCHAR(255) | NOT NULL | |
| `message` | TEXT | NOT NULL | |
| `is_read` | BOOLEAN | NOT NULL DEFAULT false | |
| `read_at` | TIMESTAMPTZ | | Nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Index: `idx_notifications_user_id`

### reviews

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `product_id` | UUID | NOT NULL, FK → products(id) ON DELETE CASCADE | |
| `rating` | INTEGER | NOT NULL, CHECK (>= 1 AND <= 5) | |
| `content` | TEXT | | Nullable; max 5000 characters (app-level) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| | | UNIQUE(user_id, product_id) | One review per user per product |

Indexes: `idx_reviews_product_id`, `idx_reviews_user_id`

### wishlist_items

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `product_id` | UUID | NOT NULL, FK → products(id) ON DELETE CASCADE | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| | | UNIQUE(user_id, product_id) | One entry per user per product |

Index: `idx_wishlist_items_user_id`

### audit_log

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `actor_id` | UUID | FK → users(id) ON DELETE SET NULL | Set to null when user is deleted |
| `action` | VARCHAR(50) | NOT NULL | E.g. `product.create`, `category.update` |
| `resource_type` | VARCHAR(50) | NOT NULL | E.g. `product`, `category`, `price` |
| `resource_id` | UUID | | Nullable |
| `metadata` | JSONB | | Arbitrary contextual data; never contains secrets |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: `idx_audit_log_created_at` (DESC), `idx_audit_log_action`, `idx_audit_log_resource` (resource_type, resource_id)

### media_items

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK DEFAULT gen_random_uuid() | |
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | Uploader for ownership checks |
| `entity_type` | VARCHAR(20) | NOT NULL, CHECK (IN ('product','review')) | Polymorphic owner type |
| `entity_id` | UUID | NOT NULL | Polymorphic owner ID |
| `file_type` | VARCHAR(10) | NOT NULL, CHECK (IN ('image','video')) | |
| `mime_type` | VARCHAR(100) | NOT NULL | Authoritative MIME (sniffed from magic bytes) |
| `original_name` | TEXT | | Client-provided filename (not trusted for security) |
| `storage_path` | TEXT | NOT NULL | Relative path in the storage backend |
| `file_size` | INTEGER | NOT NULL | Bytes |
| `width` | INTEGER | | Pixel width (null if undetermined) |
| `height` | INTEGER | | Pixel height (null if undetermined) |
| `duration_seconds` | NUMERIC(10,3) | | Video duration (null for images) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Indexes: `idx_media_items_entity` (entity_type, entity_id), `idx_media_items_user_id`

### product_media_sorts

Explicit ordering for product media items. Review media uses creation date ordering instead.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `product_id` | UUID | NOT NULL, FK → products(id) ON DELETE CASCADE | |
| `media_id` | UUID | NOT NULL, FK → media_items(id) ON DELETE CASCADE | |
| `sort_order` | INTEGER | NOT NULL DEFAULT 0 | 0-based display order |

Primary key: (product_id, media_id)

### roles

Fixed set of 4 backend roles seeded in migration 021 with stable UUIDs.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Fixed UUIDs: 00000000-0000-0000-0000-000000000001 through 00000000-0000-0000-0000-000000000004 |
| `name` | VARCHAR(50) | NOT NULL, UNIQUE | `backend_read`, `backend_write`, `backend_admin`, `user_management` |
| `description` | TEXT | NOT NULL | Human-readable description of the role's permissions |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

### user_roles

Many-to-many relationship between users and backend roles.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `user_id` | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `role_id` | UUID | NOT NULL, FK → roles(id) ON DELETE CASCADE | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Primary key: (user_id, role_id). Index: `idx_user_roles_user_id`

## Key Database Semantics

### Money (NUMERIC)
All monetary values use PostgreSQL `NUMERIC(10,2)`. They are serialized to API responses as strings via `CAST(... AS TEXT)`. JavaScript floating-point arithmetic is never used for authoritative monetary calculations.

### Missing inventory = zero stock
If no `inventory` row exists for a product, its quantity is treated as `0`. The checkout transaction and inventory service both implement this semantics.

### Historical snapshots
- `order_items.product_name`, `order_items.unit_price`, `order_items.line_total` are snapshots from checkout time — they never update when the product name or price changes.
- `order_shipping` fields are snapshots from the shipping-create request — they never update from the user's profile.

### ON DELETE behavior
- `CASCADE`: Child rows are deleted when the parent is deleted (cart_items, reviews, wishlist_items with products; refresh_tokens with users)
- `RESTRICT`: Deletion is blocked if child rows exist (orders restrict user deletion; order_items restrict product deletion)
- `SET NULL`: The FK column is set to null (categories.parent_id on parent category deletion; products.category_id on category deletion)

### Constraint enforcement
- Application validation is a defense-in-depth layer. Database constraints (UNIQUE, CHECK, FK) are the authoritative integrity enforcement.
- UNIQUE(user_id, product_id) on cart_items, reviews, and wishlist_items prevents duplicates atomically.
- CHECK constraints on rating, quantity, amount, status, and role prevent invalid data regardless of application behavior.
