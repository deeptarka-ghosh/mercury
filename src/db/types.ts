import type { Generated, JSONColumnType } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  mobile_number: string | null;
  mobile_verified_at: string | null;
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

export interface PricesTable {
  product_id: string;
  amount: string;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface CartItemsTable {
  id: Generated<string>;
  user_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface OrdersTable {
  id: Generated<string>;
  user_id: string;
  status: string;
  total: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface PaymentsTable {
  id: Generated<string>;
  order_id: string;
  amount: string;
  currency: string;
  status: string;
  provider: string | null;
  provider_ref: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface OrderShippingTable {
  id: Generated<string>;
  order_id: string;
  status: string;
  recipient_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  phone: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface OrderItemsTable {
  id: Generated<string>;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string | null;
  line_total: string | null;
  created_at: string;
}

export interface ReviewsTable {
  id: Generated<string>;
  user_id: string;
  product_id: string;
  rating: number;
  content: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface WishlistItemsTable {
  id: Generated<string>;
  user_id: string;
  product_id: string;
  created_at: string;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: JSONColumnType<Record<string, unknown> | null>;
  created_at: string;
}

export interface MediaItemsTable {
  id: Generated<string>;
  user_id: string;
  entity_type: string;
  entity_id: string;
  file_type: string;
  mime_type: string;
  original_name: string | null;
  storage_path: string;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  created_at: string;
}

export interface ProductMediaSortsTable {
  product_id: string;
  media_id: string;
  sort_order: number;
}

export interface RolesTable {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface UserRolesTable {
  user_id: string;
  role_id: string;
  created_at: string;
}

export interface UserIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  provider_subject: string;
  provider_email: string | null;
  created_at: Generated<string>;
}

export interface DB {
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  profiles: ProfilesTable;
  categories: CategoriesTable;
  products: ProductsTable;
  inventory: InventoryTable;
  prices: PricesTable;
  cart_items: CartItemsTable;
  orders: OrdersTable;
  payments: PaymentsTable;
  order_shipping: OrderShippingTable;
  notifications: NotificationsTable;
  order_items: OrderItemsTable;
  reviews: ReviewsTable;
  wishlist_items: WishlistItemsTable;
  audit_log: AuditLogTable;
  media_items: MediaItemsTable;
  product_media_sorts: ProductMediaSortsTable;
  roles: RolesTable;
  user_roles: UserRolesTable;
  user_identities: UserIdentitiesTable;
}