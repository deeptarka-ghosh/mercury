import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface OrderItemResponse {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface OrderResponse {
  id: string;
  status: string;
  total: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemResponse[];
}

export interface OrderSummaryResponse {
  id: string;
  status: string;
  total: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * List orders belonging to the authenticated user.
 * Sorted by most recent first. Uses stored snapshots only.
 * Supports optional pagination via limit and offset.
 */
export async function listOrders(userId: string, limit = 50, offset = 0): Promise<OrderSummaryResponse[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);

  const rows = await db
    .selectFrom('orders')
    .select([
      'orders.id',
      'orders.status',
      sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      'orders.created_at',
      'orders.updated_at',
    ])
    .where('orders.user_id', '=', userId)
    .orderBy('orders.created_at', 'desc')
    .limit(safeLimit)
    .offset(safeOffset)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    total: row.total ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  }));
}

/**
 * Get a single order with its items.
 * Ownership is enforced as part of the query — a non-owned order
 * returns 404, providing no information about its existence.
 */
export async function getOrder(userId: string, orderId: string): Promise<OrderResponse> {
  const db = getDatabase();

  const order = await db
    .selectFrom('orders')
    .select([
      'orders.id',
      'orders.status',
      sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      'orders.created_at',
      'orders.updated_at',
    ])
    .where('orders.id', '=', orderId)
    .where('orders.user_id', '=', userId)
    .executeTakeFirst();

  if (!order) {
    throw AppError.notFound('Order not found');
  }

  const items = await db
    .selectFrom('order_items')
    .select([
      'order_items.id',
      'order_items.product_id',
      'order_items.product_name',
      'order_items.quantity',
      sql<string | null>`CAST(order_items.unit_price AS TEXT)`.as('unit_price'),
      sql<string | null>`CAST(order_items.line_total AS TEXT)`.as('line_total'),
    ])
    .where('order_items.order_id', '=', orderId)
    .orderBy('order_items.created_at')
    .execute();

  return {
    id: order.id,
    status: order.status,
    total: order.total ?? null,
    createdAt: order.created_at,
    updatedAt: order.updated_at ?? order.created_at,
    items: items.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineTotal: row.line_total,
    })),
  };
}