import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { createNotification } from '../notifications/service.js';

export interface PaymentResponse {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: string;
  provider: string | null;
  providerRef: string | null;
  createdAt: string;
  updatedAt: string;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['completed', 'failed'],
};

/**
 * Helper: verify order ownership and return the order.
 * Re-throws 404 if not found or not owned.
 */
async function getOwnedOrder(
  userId: string,
  orderId: string,
): Promise<{ id: string; total: string | null; status: string }> {
  const db = getDatabase();

  const order = await db
    .selectFrom('orders')
    .select([
      'orders.id',
      sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      'orders.status',
    ])
    .where('orders.id', '=', orderId)
    .where('orders.user_id', '=', userId)
    .executeTakeFirst();

  if (!order) {
    throw AppError.notFound('Order not found');
  }

  return order;
}

function mapPayment(row: {
  id: string;
  order_id: string;
  amount: string;
  currency: string;
  status: string;
  provider: string | null;
  provider_ref: string | null;
  created_at: string;
  updated_at: string | undefined;
}): PaymentResponse {
  return {
    id: row.id,
    orderId: row.order_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    providerRef: row.provider_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/**
 * Create a payment for an order. Amount is derived from the persisted
 * order total — never from client input.
 *
 * Only one payment per order is allowed (UNIQUE constraint on order_id).
 * Only 'pending' orders can have payments created.
 * Orders with a null total (unpriced-only orders) are rejected.
 */
export async function createPayment(
  userId: string,
  orderId: string,
): Promise<PaymentResponse> {
  const db = getDatabase();

  const order = await getOwnedOrder(userId, orderId);

  if (order.status !== 'pending') {
    throw AppError.badRequest(
      `Cannot create payment for order with status "${order.status}"`,
    );
  }

  if (order.total === null) {
    throw AppError.badRequest(
      'Cannot create payment for an order with no total',
    );
  }

  const result = await db.transaction().execute(async (trx) => {
    // Lock the order row to prevent concurrent payment creation
    const lockedOrder = await trx
      .selectFrom('orders')
      .select(['orders.id', sql<string>`CAST(orders.total AS TEXT)`.as('total')])
      .where('orders.id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (!lockedOrder) {
      throw AppError.notFound('Order not found');
    }

    // Check for existing payment (catches race between concurrent calls)
    const existing = await trx
      .selectFrom('payments')
      .select(['payments.id'])
      .where('payments.order_id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (existing) {
      throw AppError.conflict('A payment already exists for this order');
    }

    const payment = await sql<{
      id: string;
      order_id: string;
      amount: string;
      currency: string;
      status: string;
      provider: string | null;
      provider_ref: string | null;
      created_at: string;
      updated_at: string;
    }>`
      INSERT INTO payments (order_id, amount, currency, status, created_at, updated_at)
      VALUES (${orderId}, ${lockedOrder.total}, 'USD', 'pending', now(), now())
      RETURNING *
    `.execute(trx);

    return mapPayment(payment.rows[0]!);
  });

  return result;
}

/**
 * Get the payment for an order. Ownership-scoped.
 */
export async function getPayment(
  userId: string,
  orderId: string,
): Promise<PaymentResponse> {
  const db = getDatabase();

  // Verify ownership first
  await getOwnedOrder(userId, orderId);

  const row = await db
    .selectFrom('payments')
    .select([
      'payments.id',
      'payments.order_id',
      sql<string>`CAST(payments.amount AS TEXT)`.as('amount'),
      'payments.currency',
      'payments.status',
      'payments.provider',
      'payments.provider_ref',
      'payments.created_at',
      'payments.updated_at',
    ])
    .where('payments.order_id', '=', orderId)
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('Payment not found');
  }

  return mapPayment(row);
}

/**
 * Update the payment status. Only valid transitions are allowed.
 * This is the provider callback boundary — a future provider integration
 * calls this endpoint upon receiving a provider-side confirmation.
 *
 * Valid transitions: pending → completed, pending → failed
 */
export async function updatePaymentStatus(
  userId: string,
  orderId: string,
  status: string,
): Promise<PaymentResponse> {
  const validStatuses = ['completed', 'failed'];
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest(
      `Invalid payment status "${status}". Allowed: ${validStatuses.join(', ')}`,
    );
  }

  const db = getDatabase();

  // Verify ownership
  await getOwnedOrder(userId, orderId);

  const result = await db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom('payments')
      .select([
        'payments.id',
        'payments.status',
      ])
      .where('payments.order_id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (!payment) {
      throw AppError.notFound('Payment not found');
    }

    const allowed = VALID_TRANSITIONS[payment.status];
    if (!allowed || !allowed.includes(status)) {
      throw AppError.badRequest(
        `Cannot transition payment from "${payment.status}" to "${status}"`,
      );
    }

    const updated = await sql<{
      id: string;
      order_id: string;
      amount: string;
      currency: string;
      status: string;
      provider: string | null;
      provider_ref: string | null;
      created_at: string;
      updated_at: string;
    }>`
      UPDATE payments
      SET status = ${status}, updated_at = now()
      WHERE id = ${payment.id}
      RETURNING *
    `.execute(trx);

    // Create notification for payment status change
    if (status === 'completed') {
      await createNotification(
        trx,
        userId,
        'payment_completed',
        'Payment Completed',
        `Your payment of $${updated.rows[0]!.amount} has been completed.`,
      );
    } else if (status === 'failed') {
      await createNotification(
        trx,
        userId,
        'payment_failed',
        'Payment Failed',
        `Your payment of $${updated.rows[0]!.amount} has failed.`,
      );
    }

    return mapPayment(updated.rows[0]!);
  });

  return result;
}