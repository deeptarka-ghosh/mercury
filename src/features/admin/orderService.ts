import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

// ===== Order State Machine =====

/**
 * Allowed state transitions for the full order lifecycle.
 * Order matters: status must transition through the graph.
 * Key: current status, Value: set of allowed next statuses.
 */
const ORDER_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['processing', 'cancelled']),
  processing: new Set(['packed', 'cancelled']),
  packed: new Set(['shipped']),
  shipped: new Set(['delivered']),
  delivered: new Set(['return_requested']),
  cancelled: new Set([]),
  return_requested: new Set(['returned', 'partially_refunded', 'refunded']),
  returned: new Set(['partially_refunded', 'refunded']),
  partially_refunded: new Set(['refunded']),
  refunded: new Set([]),
};

function validateTransition(current: string, next: string): void {
  const allowed = ORDER_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    throw AppError.conflict(
      `Cannot transition order from '${current}' to '${next}'`,
    );
  }
}

// ===== Admin Order Queries =====

export interface AdminOrderListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  paymentStatus?: string;
  shippingStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'newest' | 'oldest' | 'total_asc' | 'total_desc';
}

export interface AdminOrderListResult {
  orders: AdminOrderSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminOrderSummary {
  id: string;
  userId: string;
  userEmail: string | null;
  status: string;
  total: string | null;
  paymentStatus: string | null;
  shippingStatus: string | null;
  createdAt: string;
}

export interface AdminOrderDetail {
  id: string;
  userId: string;
  userEmail: string | null;
  userMobile: string | null;
  status: string;
  total: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
  payment: AdminPaymentInfo | null;
  shipping: AdminShippingInfo | null;
  statusHistory: StatusHistoryEntry[];
  refunds: AdminRefundEntry[];
}

export interface AdminOrderItem {
  id: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantSku: string | null;
  variantSize: string | null;
  variantColour: string | null;
  quantity: number;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface AdminPaymentInfo {
  id: string;
  amount: string | null;
  currency: string | null;
  status: string | null;
  provider: string | null;
  providerRef: string | null;
}

export interface AdminShippingInfo {
  id: string;
  status: string | null;
  recipientName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AdminRefundEntry {
  id: string;
  amount: string;
  currency: string;
  reason: string | null;
  status: string;
  providerRef: string | null;
  createdAt: string;
}

/**
 * List orders with filtering, search, pagination, and sorting.
 */
export async function listAdminOrders(
  options: AdminOrderListOptions,
): Promise<AdminOrderListResult> {
  const db = getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = db
    .selectFrom('orders')
    .leftJoin('users', 'users.id', 'orders.user_id')
    .leftJoin('payments', 'payments.order_id', 'orders.id')
    .leftJoin('order_shipping', 'order_shipping.order_id', 'orders.id')
    .select([
      'orders.id',
      'orders.user_id',
      'users.email as user_email',
      'orders.status',
      sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      'payments.status as payment_status',
      'order_shipping.status as shipping_status',
      'orders.created_at',
    ]);

  let countQuery = db
    .selectFrom('orders')
    .leftJoin('users', 'users.id', 'orders.user_id')
    .leftJoin('payments', 'payments.order_id', 'orders.id')
    .leftJoin('order_shipping', 'order_shipping.order_id', 'orders.id')
    .select(sql<number>`COUNT(DISTINCT orders.id)::int`.as('total'));

  // Filters
  if (options.status) {
    query = query.where('orders.status', '=', options.status);
    countQuery = countQuery.where('orders.status', '=', options.status);
  }
  if (options.paymentStatus) {
    query = query.where('payments.status', '=', options.paymentStatus);
    countQuery = countQuery.where('payments.status', '=', options.paymentStatus);
  }
  if (options.shippingStatus) {
    query = query.where('order_shipping.status', '=', options.shippingStatus);
    countQuery = countQuery.where('order_shipping.status', '=', options.shippingStatus);
  }
  if (options.dateFrom) {
    query = query.where('orders.created_at', '>=', options.dateFrom);
    countQuery = countQuery.where('orders.created_at', '>=', options.dateFrom);
  }
  if (options.dateTo) {
    query = query.where('orders.created_at', '<=', options.dateTo);
    countQuery = countQuery.where('orders.created_at', '<=', options.dateTo);
  }

  // Search — order ID, customer email, mobile, shipping recipient
  if (options.search) {
    const pattern = `%${options.search}%`;
    query = query.where((eb) =>
      eb('orders.id', 'ilike', pattern)
        .or('users.email', 'ilike', pattern)
        .or('users.mobile_number', 'ilike', pattern)
        .or('order_shipping.recipient_name', 'ilike', pattern),
    );
    countQuery = countQuery.where((eb) =>
      eb('orders.id', 'ilike', pattern)
        .or('users.email', 'ilike', pattern)
        .or('users.mobile_number', 'ilike', pattern)
        .or('order_shipping.recipient_name', 'ilike', pattern),
    );
  }

  // Sorting
  switch (options.sort) {
    case 'oldest':
      query = query.orderBy('orders.created_at', 'asc');
      break;
    case 'total_asc':
      query = query.orderBy('orders.total', 'asc').orderBy('orders.created_at', 'desc');
      break;
    case 'total_desc':
      query = query.orderBy('orders.total', 'desc').orderBy('orders.created_at', 'desc');
      break;
    default:
      query = query.orderBy('orders.created_at', 'desc');
  }

  const [countResult, rows] = await Promise.all([
    countQuery.executeTakeFirstOrThrow(),
    query.limit(limit).offset(offset).execute(),
  ]);

  return {
    orders: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email ?? null,
      status: r.status,
      total: r.total ?? null,
      paymentStatus: r.payment_status ?? null,
      shippingStatus: r.shipping_status ?? null,
      createdAt: r.created_at,
    })),
    total: countResult.total,
    limit,
    offset,
  };
}

/**
 * Get full order detail (admin view — no ownership filter).
 */
export async function getAdminOrder(orderId: string): Promise<AdminOrderDetail> {
  const db = getDatabase();

  const order = await db
    .selectFrom('orders')
    .leftJoin('users', 'users.id', 'orders.user_id')
    .select([
      'orders.id',
      'orders.user_id',
      'users.email as user_email',
      'users.mobile_number as user_mobile',
      'orders.status',
      sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      'orders.cancelled_at',
      'orders.created_at',
      'orders.updated_at',
    ])
    .where('orders.id', '=', orderId)
    .executeTakeFirst();

  if (!order) throw AppError.notFound('Order not found');

  const items = await db
    .selectFrom('order_items')
    .select([
      'order_items.id',
      'order_items.product_id',
      sql<string | null>`order_items.variant_id`.as('variant_id'),
      'order_items.product_name',
      sql<string | null>`order_items.variant_sku`.as('variant_sku'),
      sql<string | null>`order_items.variant_size`.as('variant_size'),
      sql<string | null>`order_items.variant_colour`.as('variant_colour'),
      'order_items.quantity',
      sql<string | null>`CAST(order_items.unit_price AS TEXT)`.as('unit_price'),
      sql<string | null>`CAST(order_items.line_total AS TEXT)`.as('line_total'),
    ])
    .where('order_items.order_id', '=', orderId)
    .orderBy('order_items.created_at')
    .execute();

  const payment = await db
    .selectFrom('payments')
    .select([
      'payments.id',
      sql<string | null>`CAST(payments.amount AS TEXT)`.as('amount'),
      'payments.currency',
      'payments.status',
      'payments.provider',
      'payments.provider_ref',
    ])
    .where('payments.order_id', '=', orderId)
    .executeTakeFirst();

  const shipping = await db
    .selectFrom('order_shipping')
    .select([
      'order_shipping.id',
      'order_shipping.status',
      'order_shipping.recipient_name',
      'order_shipping.address_line1',
      'order_shipping.city',
      'order_shipping.state',
      'order_shipping.postal_code',
      'order_shipping.country_code',
    ])
    .where('order_shipping.order_id', '=', orderId)
    .executeTakeFirst();

  const statusHistory = await db
    .selectFrom('order_status_history')
    .select([
      'order_status_history.id',
      'order_status_history.from_status',
      'order_status_history.to_status',
      'order_status_history.changed_by',
      'order_status_history.reason',
      'order_status_history.created_at',
    ])
    .where('order_status_history.order_id', '=', orderId)
    .orderBy('order_status_history.created_at', 'asc')
    .execute();

  const refunds = await db
    .selectFrom('order_refunds')
    .select([
      'order_refunds.id',
      sql<string>`CAST(order_refunds.amount AS TEXT)`.as('amount'),
      'order_refunds.currency',
      'order_refunds.reason',
      'order_refunds.status',
      'order_refunds.provider_ref',
      'order_refunds.created_at',
    ])
    .where('order_refunds.order_id', '=', orderId)
    .orderBy('order_refunds.created_at', 'desc')
    .execute();

  return {
    id: order.id,
    userId: order.user_id,
    userEmail: order.user_email ?? null,
    userMobile: order.user_mobile ?? null,
    status: order.status,
    total: order.total ?? null,
    cancelledAt: order.cancelled_at ?? null,
    createdAt: order.created_at,
    updatedAt: order.updated_at ?? order.created_at,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      productName: i.product_name,
      variantSku: i.variant_sku,
      variantSize: i.variant_size,
      variantColour: i.variant_colour,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
    payment: payment
      ? {
          id: payment.id,
          amount: payment.amount ?? null,
          currency: payment.currency ?? null,
          status: payment.status ?? null,
          provider: payment.provider ?? null,
          providerRef: payment.provider_ref ?? null,
        }
      : null,
    shipping: shipping
      ? {
          id: shipping.id,
          status: shipping.status ?? null,
          recipientName: shipping.recipient_name ?? null,
          addressLine1: shipping.address_line1 ?? null,
          city: shipping.city ?? null,
          state: shipping.state ?? null,
          postalCode: shipping.postal_code ?? null,
          countryCode: shipping.country_code ?? null,
        }
      : null,
    statusHistory: statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      changedBy: h.changed_by,
      reason: h.reason,
      createdAt: h.created_at,
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      amount: r.amount,
      currency: r.currency,
      reason: r.reason,
      status: r.status,
      providerRef: r.provider_ref,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Transition an order to a new status with validation and inventory management.
 * Records the transition in order_status_history and audit log.
 */
export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  actorId: string,
  reason?: string,
): Promise<AdminOrderDetail> {
  const db = getDatabase();

  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom('orders')
      .select(['id', 'status', 'user_id'])
      .where('id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (!order) throw AppError.notFound('Order not found');

    validateTransition(order.status, newStatus);

    const updates: Record<string, unknown> = {
      status: newStatus,
      updated_at: sql`now()`,
    };

    // Set cancelled_at when cancelling
    if (newStatus === 'cancelled') {
      updates.cancelled_at = sql`now()`;

      // Restore variant inventory on cancellation (confirmed/processing only)
      if (order.status === 'confirmed' || order.status === 'processing') {
        const items = await trx
          .selectFrom('order_items')
          .select([
            sql<string | null>`order_items.variant_id`.as('variant_id'),
            'order_items.quantity',
          ])
          .where('order_id', '=', orderId)
          .where(sql`order_items.variant_id`, 'is not', null)
          .execute();

        for (const item of items) {
          if (item.variant_id) {
            await sql`
              UPDATE product_variants
              SET quantity = quantity + ${item.quantity}, updated_at = now()
              WHERE id = ${item.variant_id}
            `.execute(trx);
          }
        }
      }
    }

    await trx
      .updateTable('orders')
      .set(updates as never)
      .where('id', '=', orderId)
      .execute();

    // Record status history
    await sql`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, created_at)
      VALUES (${orderId}, ${order.status}, ${newStatus}, ${actorId}, ${reason ?? null}, now())
    `.execute(trx);

    return order;
  });

  return getAdminOrder(orderId);
}

/**
 * Cancel an order idempotently.
 * If already cancelled, returns success. If in an invalid state, throws.
 */
export async function cancelOrder(
  orderId: string,
  actorId: string,
  reason?: string,
): Promise<AdminOrderDetail> {
  const db = getDatabase();

  const order = await db
    .selectFrom('orders')
    .select(['status'])
    .where('id', '=', orderId)
    .executeTakeFirst();

  if (!order) throw AppError.notFound('Order not found');

  // Idempotent: already cancelled
  if (order.status === 'cancelled') {
    return getAdminOrder(orderId);
  }

  // pending, confirmed, processing can be cancelled
  return updateOrderStatus(orderId, 'cancelled', actorId, reason);
}

/**
 * Record a refund for an order.
 * The refund is recorded as pending and must be processed externally.
 */
export async function createRefund(
  orderId: string,
  amount: number,
  currency: string,
  reason: string | undefined,
  actorId: string,
): Promise<AdminRefundEntry> {
  const db = getDatabase();

  if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
    throw AppError.badRequest('Refund amount must be a positive number');
  }

  const result = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom('orders')
      .select(['id', 'status'])
      .where('id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (!order) throw AppError.notFound('Order not found');

    // Only delivered or returned orders can be refunded
    if (!['delivered', 'returned', 'return_requested', 'partially_refunded'].includes(order.status)) {
      throw AppError.conflict('Order must be delivered or returned before refunding');
    }

    const refundResult = await sql<{
      id: string; amount: string; currency: string; reason: string | null;
      status: string; provider_ref: string | null; created_at: string;
    }>`
      INSERT INTO order_refunds (order_id, amount, currency, reason, status, processed_by, created_at, updated_at)
      VALUES (${orderId}, ${amount.toFixed(2)}, ${currency}, ${reason ?? null}, 'pending', ${actorId}, now(), now())
      RETURNING id, CAST(amount AS TEXT) as amount, currency, reason, status, provider_ref, created_at
    `.execute(trx);

    return refundResult.rows[0]!;
  });

  return {
    id: result.id,
    amount: result.amount,
    currency: result.currency,
    reason: result.reason,
    status: result.status,
    providerRef: result.provider_ref,
    createdAt: result.created_at,
  };
}

/**
 * Update shipping status for an order.
 */
export async function updateShippingStatus(
  orderId: string,
  shippingStatus: string,
): Promise<void> {
  const db = getDatabase();

  const validStatuses = ['pending', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(shippingStatus)) {
    throw AppError.badRequest(
      `Invalid shipping status. Must be one of: ${validStatuses.join(', ')}`,
    );
  }

  const result = await sql`
    UPDATE order_shipping
    SET status = ${shippingStatus}, updated_at = now()
    WHERE order_id = ${orderId}
  `.execute(db);

  if (result.numAffectedRows === 0n) {
    throw AppError.notFound('Shipping record not found for this order');
  }
}