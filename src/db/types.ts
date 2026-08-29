import type { Generated, JSONColumnType } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  mobile_number: string | null;
  mobile_verified_at: string | null;
  status: Generated<string>;
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

export interface ProductVariantsTable {
  id: Generated<string>;
  product_id: string;
  sku: string;
  barcode: string | null;
  size: string;
  colour_name: string;
  colour_code: string | null;
  status: string;
  selling_price: string;
  mrp: string;
  cost_price: string | null;
  quantity: number;
  low_stock_threshold: number | null;
  hsn_code: string | null;
  tax_rate: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface CartItemsTable {
  id: Generated<string>;
  user_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface OrderStatusHistoryTable {
  id: Generated<string>;
  order_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
}

export interface OrderRefundsTable {
  id: Generated<string>;
  order_id: string;
  amount: string;
  currency: string;
  reason: string | null;
  status: string;
  provider_ref: string | null;
  processed_by: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface OrdersTable {
  id: Generated<string>;
  user_id: string;
  status: string;
  total: string | null;
  cancelled_at: string | null;
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
  payment_method: string | null;
  reconciliation_status: string | null;
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
  tracking_provider: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
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
  variant_id: string | null;
  product_name: string;
  variant_sku: string | null;
  variant_size: string | null;
  variant_colour: string | null;
  quantity: number;
  unit_price: string | null;
  line_total: string | null;
  hsn_code: string | null;
  tax_rate: string | null;
  tax_amount: string | null;
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
  variant_id: string | null;
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

export interface AdminLoginChallengesTable {
  id: Generated<string>;
  user_id: string;
  otp_hash: string;
  masked_mobile: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  verified_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface StoreSettingsTable {
  id: Generated<string>;
  store_name: string;
  default_currency: string;
  country_code: string;
  timezone: string;
  locale: string;
  gstin: string | null;
  legal_business_name: string | null;
  business_address: string | null;
  support_email: string | null;
  support_mobile: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface ReturnRequestsTable {
  id: Generated<string>;
  order_id: string;
  user_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface ReturnLineItemsTable {
  id: Generated<string>;
  return_request_id: string;
  order_item_id: string;
  quantity: number;
  return_reason: string | null;
  is_restockable: boolean;
  created_at: string;
}

export interface ExchangeRequestsTable {
  id: Generated<string>;
  return_request_id: string;
  replacement_variant_id: string | null;
  status: string;
  created_at: string;
  updated_at?: Generated<string>;
}

export interface DB {
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  profiles: ProfilesTable;
  categories: CategoriesTable;
  products: ProductsTable;
  product_variants: ProductVariantsTable;
  inventory: InventoryTable;
  prices: PricesTable;
  cart_items: CartItemsTable;
  orders: OrdersTable;
  payments: PaymentsTable;
  order_shipping: OrderShippingTable;
  order_status_history: OrderStatusHistoryTable;
  order_refunds: OrderRefundsTable;
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
  admin_login_challenges: AdminLoginChallengesTable;
  store_settings: StoreSettingsTable;
  return_requests: ReturnRequestsTable;
  return_line_items: ReturnLineItemsTable;
  exchange_requests: ExchangeRequestsTable;
}