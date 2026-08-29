import { Kysely, sql } from 'kysely';

/**
 * Migration 021: Create RBAC roles and user_roles tables.
 *
 * Introduces a normalized multi-role authorization model:
 * - roles: fixed set of 4 backend roles
 * - user_roles: many-to-many assignments
 *
 * Existing 'admin' users are migrated to receive all 4 backend roles.
 * Existing 'user' accounts remain customers (no backend roles).
 * The old users.role column is kept but deprecated — widened CHECK to
 * allow new values so existing triggers/constraints don't block.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Create roles table
  await sql`
    CREATE TABLE roles (
      id UUID PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  // Seed the 4 backend roles with fixed UUIDs for consistency
  await sql`
    INSERT INTO roles (id, name, description) VALUES
      ('00000000-0000-0000-0000-000000000001', 'backend_read', 'Can access backend read-only APIs (categories, products, inventory, pricing, audit/analytics)'),
      ('00000000-0000-0000-0000-000000000002', 'backend_write', 'Can create, update, publish/unpublish products and categories; update inventory and pricing'),
      ('00000000-0000-0000-0000-000000000003', 'backend_admin', 'Full backend operational access including sensitive operations'),
      ('00000000-0000-0000-0000-000000000004', 'user_management', 'Can list, view, create backend users and assign/revoke roles');
  `.execute(db);

  // Create user_roles table
  await sql`
    CREATE TABLE user_roles (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role_id)
    );
  `.execute(db);

  await sql`
    CREATE INDEX idx_user_roles_user_id ON user_roles (user_id);
  `.execute(db);

  // Migrate existing 'admin' users: assign all 4 backend roles
  await sql`
    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM users u
    CROSS JOIN roles r
    WHERE u.role = 'admin'
    ON CONFLICT DO NOTHING;
  `.execute(db);

  // Widen the users.role CHECK constraint to allow all valid values
  // (we're deprecating it but can't drop it without breaking existing code)
  await sql`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  `.execute(db);

  await sql`
    ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'admin', 'backend_read', 'backend_write', 'backend_admin', 'user_management'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_roles`.execute(db);
  await sql`DROP TABLE IF EXISTS roles`.execute(db);

  // Restore original CHECK constraint
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))`.execute(db);
}