import type { Generated } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at?: Generated<string>;
}

/**
 * Kysely database schema interface.
 *
 * Add a property for each table when migrations are created.
 * This type parameter is passed to Kysely<DB> for compile-time
 * type safety on all queries.
 */
export interface ProfilesTable {
  id: Generated<string>;
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface CategoriesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface ProductsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  category_id: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface InventoryTable {
  product_id: string;
  quantity: number;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface DB {
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  profiles: ProfilesTable;
  categories: CategoriesTable;
  products: ProductsTable;
  inventory: InventoryTable;
}