import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

// ===== Returns Management =====

export interface ReturnListResult {
  returns: ReturnSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReturnSummary {
  id: string;
  orderId: string;
  userId: string;
  userEmail: string | null;
  status: string;
  reason: string | null;
  lineItemCount: number;
  createdAt: string;
}

export interface ReturnDetail {
  id: string;
  orderId: string;
  userId: string;
  userEmail: string | null;
  status: string;
  reason: string | null;
  lineItems: ReturnLineItemDetail[];
  exchange: ExchangeDetail | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnLineItemDetail {
  id: string;
  orderItemId: string;
  productName: string;
  quantity: number;
  returnReason: string | null;
  isRestockable: boolean;
}

export interface ExchangeDetail {
  id: string;
  replacementVariantId: string | null;
  status: string;
}

const RETURN_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(['approved', 'rejected']),
  approved: new Set(['goods_received', 'rejected']),
  rejected: new Set([]),
  goods_received: new Set(['refund_initiated', 'closed']),
  refund_initiated: new Set(['refunded']),
  refunded: new Set(['closed']),
  closed: new Set([]),
};

function validateReturnTransition(current: string, next: string): void {
  const allowed = RETURN_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    throw AppError.conflict(`Cannot transition return from '${current}' to '${next}'`);
  }
}

export async function listReturns(
  limit = 50, offset = 0,
): Promise<ReturnListResult> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);

  const [countResult, rows] = await Promise.all([
    db.selectFrom('return_requests')
      .select(sql<number>`COUNT(*)::int`.as('total'))
      .executeTakeFirstOrThrow(),
    db.selectFrom('return_requests')
      .leftJoin('users', 'users.id', 'return_requests.user_id')
      .leftJoin('return_line_items', 'return_line_items.return_request_id', 'return_requests.id')
      .select([
        'return_requests.id',
        'return_requests.order_id',
        'return_requests.user_id',
        'users.email as user_email',
        'return_requests.status',
        'return_requests.reason',
        sql<number>`COUNT(DISTINCT return_line_items.id)::int`.as('line_item_count'),
        'return_requests.created_at',
      ])
      .groupBy(['return_requests.id', 'return_requests.order_id', 'return_requests.user_id', 'users.email', 'return_requests.status', 'return_requests.reason', 'return_requests.created_at'])
      .orderBy('return_requests.created_at', 'desc')
      .limit(safeLimit)
      .offset(safeOffset)
      .execute(),
  ]);

  return {
    returns: rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      userId: r.user_id,
      userEmail: r.user_email ?? null,
      status: r.status,
      reason: r.reason,
      lineItemCount: r.line_item_count,
      createdAt: r.created_at,
    })),
    total: countResult.total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getReturnDetail(returnId: string): Promise<ReturnDetail> {
  const db = getDatabase();

  const ret = await db
    .selectFrom('return_requests')
    .leftJoin('users', 'users.id', 'return_requests.user_id')
    .select([
      'return_requests.id',
      'return_requests.order_id',
      'return_requests.user_id',
      'users.email as user_email',
      'return_requests.status',
      'return_requests.reason',
      'return_requests.created_at',
      'return_requests.updated_at',
    ])
    .where('return_requests.id', '=', returnId)
    .executeTakeFirst();

  if (!ret) throw AppError.notFound('Return request not found');

  const lineItems = await db
    .selectFrom('return_line_items')
    .leftJoin('order_items', 'order_items.id', 'return_line_items.order_item_id')
    .select([
      'return_line_items.id',
      'return_line_items.order_item_id',
      'order_items.product_name',
      'return_line_items.quantity',
      'return_line_items.return_reason',
      'return_line_items.is_restockable',
    ])
    .where('return_line_items.return_request_id', '=', returnId)
    .execute();

  const exchange = await db
    .selectFrom('exchange_requests')
    .select([
      'exchange_requests.id',
      'exchange_requests.replacement_variant_id',
      'exchange_requests.status',
    ])
    .where('exchange_requests.return_request_id', '=', returnId)
    .executeTakeFirst();

  return {
    id: ret.id,
    orderId: ret.order_id,
    userId: ret.user_id,
    userEmail: ret.user_email ?? null,
    status: ret.status,
    reason: ret.reason,
    lineItems: lineItems.map((li) => ({
      id: li.id,
      orderItemId: li.order_item_id,
      productName: li.product_name ?? 'Unknown',
      quantity: li.quantity,
      returnReason: li.return_reason,
      isRestockable: li.is_restockable,
    })),
    exchange: exchange ? {
      id: exchange.id,
      replacementVariantId: exchange.replacement_variant_id,
      status: exchange.status,
    } : null,
    createdAt: ret.created_at,
    updatedAt: ret.updated_at ?? ret.created_at,
  };
}

export async function updateReturnStatus(
  returnId: string,
  newStatus: string,
  _actorId: string,
): Promise<ReturnDetail> {
  const db = getDatabase();

  await db.transaction().execute(async (trx) => {
    const ret = await trx
      .selectFrom('return_requests')
      .select(['id', 'status'])
      .where('id', '=', returnId)
      .forUpdate()
      .executeTakeFirst();

    if (!ret) throw AppError.notFound('Return request not found');

    validateReturnTransition(ret.status, newStatus);

    // If goods_received and restockable, restore inventory
    if (newStatus === 'goods_received') {
      const items = await trx
        .selectFrom('return_line_items')
        .innerJoin('order_items', 'order_items.id', 'return_line_items.order_item_id')
        .select([
          'order_items.variant_id',
          'return_line_items.quantity',
          'return_line_items.is_restockable',
        ])
        .where('return_line_items.return_request_id', '=', returnId)
        .execute();

      for (const item of items) {
        if (item.is_restockable && item.variant_id) {
          await sql`
            UPDATE product_variants
            SET quantity = quantity + ${item.quantity}, updated_at = now()
            WHERE id = ${item.variant_id}
          `.execute(trx);
        }
      }
    }

    await trx
      .updateTable('return_requests')
      .set({ status: newStatus, updated_at: sql`now()` })
      .where('id', '=', returnId)
      .execute();

    return ret;
  });

  return getReturnDetail(returnId);
}

// ===== Shipment Tracking =====

export async function updateShipmentTracking(
  orderId: string,
  tracking: {
    provider?: string;
    number?: string;
    url?: string;
  },
): Promise<void> {
  const db = getDatabase();

  const updates: Record<string, unknown> = { updated_at: sql`now()` };
  if (tracking.provider !== undefined) updates.tracking_provider = tracking.provider;
  if (tracking.number !== undefined) updates.tracking_number = tracking.number;
  if (tracking.url !== undefined) updates.tracking_url = tracking.url;

  if (Object.keys(updates).length <= 1) {
    throw AppError.badRequest('Nothing to update');
  }

  const result = await db
    .updateTable('order_shipping')
    .set(updates as never)
    .where('order_id', '=', orderId)
    .executeTakeFirst();

  if (!result || result.numUpdatedRows === 0n) {
    throw AppError.notFound('Order has no shipping record');
  }
}