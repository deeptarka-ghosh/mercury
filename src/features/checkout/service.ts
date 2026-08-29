import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { createNotification } from '../notifications/service.js';

export interface CheckoutResponse {
  orderId: string;
  status: string;
  total: string | null;
}

/**
 * Execute checkout for the authenticated user's current cart.
 *
 * Single atomic transaction:
 * 1. Lock cart items (FOR UPDATE)
 * 2. Lock existing inventory rows for cart products (FOR UPDATE)
 * 3. Validate cart not empty, products active, sufficient stock
 * 4. INSERT order + order_items (snapshot with current prices)
 * 5. Decrement inventory atomically with conditional WHERE guard
 * 6. Clear cart, return order summary
 */
export async function checkout(userId: string): Promise<CheckoutResponse> {
  const db = getDatabase();

  const result = await db.transaction().execute(async (trx) => {
    // Step 0: Verify mobile number is verified
    const user = await trx
      .selectFrom('users')
      .select(['mobile_number', 'mobile_verified_at'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user || user.mobile_number === null || user.mobile_verified_at === null) {
      throw Object.assign(
        new Error('Mobile number verification is required before placing an order.'),
        { statusCode: 403, code: 'MOBILE_VERIFICATION_REQUIRED' },
      );
    }
    // Step 1: Lock the user's cart items
    const cartLock = await trx
      .selectFrom('cart_items')
      .select(['cart_items.product_id', 'cart_items.quantity'])
      .where('cart_items.user_id', '=', userId)
      .forUpdate()
      .execute();

    if (cartLock.length === 0) {
      throw AppError.badRequest('Cart is empty');
    }

    const productIds = cartLock.map((c) => c.product_id);

    // Step 2: Lock inventory rows for these products (existing rows only)
    const existingInventory = await trx
      .selectFrom('inventory')
      .select('inventory.product_id')
      .where('inventory.product_id', 'in', productIds)
      .forUpdate()
      .execute();

    const inventoriedIds = new Set(existingInventory.map((i) => i.product_id));

    // Step 3: Read full cart data with LEFT JOINs (no FOR UPDATE — already locked)
    const cartItems = await trx
      .selectFrom('cart_items')
      .innerJoin('products', 'products.id', 'cart_items.product_id')
      .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
      .leftJoin('inventory', 'inventory.product_id', 'cart_items.product_id')
      .select([
        'cart_items.product_id',
        'cart_items.quantity',
        'products.name',
        'products.status',
        sql<string | null>`CAST(prices.amount AS TEXT)`.as('unit_price'),
        sql<number | null>`inventory.quantity`.as('stock_quantity'),
      ])
      .where('cart_items.user_id', '=', userId)
      .execute();

    // Step 4: Validate
    for (const item of cartItems) {
      if (item.status !== 'active') {
        throw AppError.badRequest(
          `Product "${item.name}" is no longer available`,
        );
      }

      // Missing inventory row = quantity 0, consistent with Inventory module
      const available = item.stock_quantity ?? 0;
      if (available < item.quantity) {
        const msg =
          item.stock_quantity === null
            ? `Product "${item.name}" is out of stock`
            : `Insufficient stock for "${item.name}". Available: ${item.stock_quantity}, requested: ${item.quantity}`;
        throw AppError.conflict(msg);
      }
    }

    // Step 5: Insert order header
    const orderInsert = await sql<{ id: string }>`
      INSERT INTO orders (user_id, status, created_at, updated_at)
      VALUES (${userId}, 'pending', now(), now())
      RETURNING id
    `.execute(trx);

    const orderId = orderInsert.rows[0]!.id;

    // Step 6: Insert order_items — snapshot cart with current prices
    await sql`
      INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
      SELECT
        ${orderId}::UUID,
        ci.product_id,
        p.name,
        ci.quantity,
        pr.amount,
        CASE WHEN pr.amount IS NOT NULL THEN ci.quantity * pr.amount ELSE NULL END
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN prices pr ON pr.product_id = ci.product_id
      WHERE ci.user_id = ${userId}
    `.execute(trx);

    // Step 7: Decrement inventory for tracked products — conditional guard
    for (const item of cartItems) {
      if (inventoriedIds.has(item.product_id) && item.stock_quantity !== null) {
        const updateResult = await sql`
          UPDATE inventory
          SET quantity = quantity - ${item.quantity}, updated_at = now()
          WHERE product_id = ${item.product_id}
            AND quantity >= ${item.quantity}
        `.execute(trx);

        if (updateResult.numAffectedRows !== 1n) {
          throw AppError.conflict(
            `Insufficient stock for "${item.name}" during checkout`,
          );
        }
      }
    }

    // Step 8: Compute and persist order total
    await sql`
      UPDATE orders
      SET total = (
        SELECT CAST(SUM(line_total) AS NUMERIC(10, 2))
        FROM order_items
        WHERE order_id = ${orderId}
      ), updated_at = now()
      WHERE id = ${orderId}
    `.execute(trx);

    // Step 9: Clear the cart
    await sql`DELETE FROM cart_items WHERE user_id = ${userId}`.execute(trx);

    // Step 10: Read back the order
    const order = await trx
      .selectFrom('orders')
      .select([
        'orders.id',
        'orders.status',
        sql<string | null>`CAST(orders.total AS TEXT)`.as('total'),
      ])
      .where('orders.id', '=', orderId)
      .executeTakeFirstOrThrow();

    // Create notification
    const totalStr = order.total ?? undefined;
    const msg = totalStr
      ? `Your order #${orderId.slice(0, 8)} has been placed for ${totalStr}.`
      : `Your order #${orderId.slice(0, 8)} has been placed.`;
    await createNotification(trx, userId, 'order_created', 'Order Created', msg);

    return {
      orderId: order.id,
      status: order.status,
      total: order.total ?? null,
    };
  });

  return result;
}