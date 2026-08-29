import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface CustomerListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  mobileVerified?: boolean;
  sort?: 'newest' | 'oldest';
}

export interface CustomerListResult {
  customers: CustomerSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface CustomerSummary {
  id: string;
  email: string;
  mobileNumber: string | null;
  mobileVerified: boolean;
  displayName: string | null;
  status: string;
  orderCount: number;
  lifetimeSpend: string | null;
  createdAt: string;
}

export interface CustomerDetail {
  id: string;
  email: string;
  mobileNumber: string | null;
  mobileVerified: boolean;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  status: string;
  providers: string[];
  orderCount: number;
  lifetimeSpend: string | null;
  recentOrders: CustomerOrderSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderSummary {
  id: string;
  status: string;
  total: string | null;
  createdAt: string;
}

/**
 * List customers (users without backend roles).
 */
export async function listCustomers(
  options: CustomerListOptions,
): Promise<CustomerListResult> {
  const db = getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  // Customers = users who are NOT in user_roles table
  let query = db
    .selectFrom('users')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('orders', 'orders.user_id', 'users.id')
    .select([
      'users.id',
      'users.email',
      'users.mobile_number',
      'users.mobile_verified_at',
      'users.status',
      'users.created_at',
      'profiles.display_name',
      sql<number>`COUNT(DISTINCT orders.id)::int`.as('order_count'),
      sql<string | null>`CAST(SUM(orders.total) AS TEXT)`.as('lifetime_spend'),
    ])
    .where((eb) => eb('users.id', 'not in',
      eb.selectFrom('user_roles').select('user_roles.user_id'),
    ))
    .groupBy(['users.id', 'users.email', 'users.mobile_number', 'users.mobile_verified_at', 'users.status', 'users.created_at', 'profiles.display_name']);

  let countQuery = db
    .selectFrom('users')
    .select(sql<number>`COUNT(*)::int`.as('total'))
    .where((eb) => eb('users.id', 'not in',
      eb.selectFrom('user_roles').select('user_roles.user_id'),
    ));

  // Filters
  if (options.status) {
    query = query.where('users.status', '=', options.status);
    countQuery = countQuery.where('users.status', '=', options.status);
  }
  if (options.mobileVerified === true) {
    query = query.where('users.mobile_verified_at', 'is not', null);
    countQuery = countQuery.where('users.mobile_verified_at', 'is not', null);
  } else if (options.mobileVerified === false) {
    query = query.where('users.mobile_verified_at', 'is', null);
    countQuery = countQuery.where('users.mobile_verified_at', 'is', null);
  }

  // Search
  if (options.search) {
    const pattern = `%${options.search}%`;
    query = query.where((eb) =>
      eb('users.email', 'ilike', pattern)
        .or('users.mobile_number', 'ilike', pattern)
        .or('users.id', 'ilike', pattern)
        .or(sql`profiles.display_name`, 'ilike', pattern),
    );
    countQuery = countQuery.where((eb) =>
      eb('users.email', 'ilike', pattern)
        .or('users.mobile_number', 'ilike', pattern)
        .or('users.id', 'ilike', pattern)
        .or(sql`profiles.display_name`, 'ilike', pattern),
    );
  }

  // Sort
  query = options.sort === 'oldest'
    ? query.orderBy('users.created_at', 'asc')
    : query.orderBy('users.created_at', 'desc');

  query = query.orderBy('users.id', 'asc');

  const [countResult, rows] = await Promise.all([
    countQuery.executeTakeFirstOrThrow(),
    query.limit(limit).offset(offset).execute(),
  ]);

  return {
    customers: rows.map((r) => ({
      id: r.id,
      email: r.email,
      mobileNumber: r.mobile_number ?? null,
      mobileVerified: r.mobile_verified_at !== null && r.mobile_number !== null,
      displayName: r.display_name ?? null,
      status: r.status,
      orderCount: r.order_count,
      lifetimeSpend: r.lifetime_spend ?? null,
      createdAt: r.created_at,
    })),
    total: countResult.total,
    limit,
    offset,
  };
}

/**
 * Get full customer detail.
 */
export async function getCustomerDetail(customerId: string): Promise<CustomerDetail> {
  const db = getDatabase();

  const user = await db
    .selectFrom('users')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .select([
      'users.id',
      'users.email',
      'users.mobile_number',
      'users.mobile_verified_at',
      'users.status',
      'users.created_at',
      'users.updated_at',
      'profiles.display_name',
      'profiles.bio',
      'profiles.avatar_url',
    ])
    .where('users.id', '=', customerId)
    .executeTakeFirst();

  if (!user) throw AppError.notFound('Customer not found');

  // Verify this is a customer (no backend roles) — just a check, no result used
  await db
    .selectFrom('user_roles')
    .select(sql<number>`COUNT(*)::int`.as('count'))
    .where('user_id', '=', customerId)
    .executeTakeFirstOrThrow();

  // Get identities (provider names only — no secrets)
  const identities = await db
    .selectFrom('user_identities')
    .select('provider')
    .where('user_id', '=', customerId)
    .execute();

  // Order stats
  const orderStats = await db
    .selectFrom('orders')
    .select([
      sql<number>`COUNT(*)::int`.as('order_count'),
      sql<string | null>`CAST(SUM(orders.total) AS TEXT)`.as('lifetime_spend'),
    ])
    .where('user_id', '=', customerId)
    .executeTakeFirstOrThrow();

  // Recent orders
  const recentOrders = await db
    .selectFrom('orders')
    .select([
      'orders.id',
      'orders.status',
      sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      'orders.created_at',
    ])
    .where('user_id', '=', customerId)
    .orderBy('orders.created_at', 'desc')
    .limit(10)
    .execute();

  return {
    id: user.id,
    email: user.email,
    mobileNumber: user.mobile_number ?? null,
    mobileVerified: user.mobile_verified_at !== null && user.mobile_number !== null,
    displayName: user.display_name ?? null,
    bio: user.bio ?? null,
    avatarUrl: user.avatar_url ?? null,
    status: user.status,
    providers: identities.map((i) => i.provider),
    orderCount: orderStats.order_count,
    lifetimeSpend: orderStats.lifetime_spend ?? null,
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total ?? null,
      createdAt: o.created_at,
    })),
    createdAt: user.created_at,
    updatedAt: user.updated_at ?? user.created_at,
  };
}

/**
 * Update customer status (active/disabled).
 * Disabling revokes all refresh tokens.
 */
export async function updateCustomerStatus(
  customerId: string,
  status: string,
  _actorId: string,
): Promise<{ id: string; status: string }> {
  const validStatuses = ['active', 'disabled'];
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest('Status must be one of: active, disabled');
  }

  const db = getDatabase();

  const result = await db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select(['id', 'status'])
      .where('id', '=', customerId)
      .forUpdate()
      .executeTakeFirst();

    if (!user) throw AppError.notFound('Customer not found');

    // Only allow status changes for customers (no backend roles)
    const roleCount = await trx
      .selectFrom('user_roles')
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .where('user_id', '=', customerId)
      .executeTakeFirstOrThrow();

    if (roleCount.count > 0) {
      throw AppError.badRequest('Cannot change status of a backend user via this endpoint');
    }

    if (user.status === status) {
      return { id: user.id, status: user.status };
    }

    await trx
      .updateTable('users')
      .set({ status, updated_at: sql`now()` })
      .where('id', '=', customerId)
      .execute();

    // If disabling, revoke all refresh tokens
    if (status === 'disabled') {
      await trx
        .deleteFrom('refresh_tokens')
        .where('user_id', '=', customerId)
        .execute();
    }

    return { id: user.id, status };
  });

  return result;
}

/**
 * List orders for a specific customer.
 */
export async function listCustomerOrders(
  customerId: string,
  limit = 50,
  offset = 0,
): Promise<{ orders: CustomerOrderSummary[]; total: number; limit: number; offset: number }> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);

  // Verify customer exists
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('id', '=', customerId)
    .executeTakeFirst();

  if (!user) throw AppError.notFound('Customer not found');

  const [countResult, rows] = await Promise.all([
    db
      .selectFrom('orders')
      .select(sql<number>`COUNT(*)::int`.as('total'))
      .where('user_id', '=', customerId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('orders')
      .select([
        'orders.id',
        'orders.status',
        sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
        'orders.created_at',
      ])
      .where('user_id', '=', customerId)
      .orderBy('orders.created_at', 'desc')
      .limit(safeLimit)
      .offset(safeOffset)
      .execute(),
  ]);

  return {
    orders: rows.map((r) => ({
      id: r.id,
      status: r.status,
      total: r.total ?? null,
      createdAt: r.created_at,
    })),
    total: countResult.total,
    limit: safeLimit,
    offset: safeOffset,
  };
}