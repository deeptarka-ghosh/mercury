import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface ShippingResponse {
  id: string;
  orderId: string;
  status: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingInput {
  recipientName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode?: string;
  phone?: string;
}

function mapShipping(row: {
  id: string;
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
  updated_at: string | undefined;
}): ShippingResponse {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    recipientName: row.recipient_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/**
 * Helper: verify order ownership and return the order.
 */
async function getOwnedOrder(
  userId: string,
  orderId: string,
): Promise<{ id: string }> {
  const db = getDatabase();

  const order = await db
    .selectFrom('orders')
    .select(['orders.id'])
    .where('orders.id', '=', orderId)
    .where('orders.user_id', '=', userId)
    .executeTakeFirst();

  if (!order) {
    throw AppError.notFound('Order not found');
  }

  return order;
}

function validateShippingInput(input: ShippingInput): void {
  const errors: string[] = [];

  if (!input.recipientName || input.recipientName.trim().length === 0) {
    errors.push('recipientName is required');
  }
  if (input.recipientName && input.recipientName.length > 255) {
    errors.push('recipientName must be at most 255 characters');
  }

  if (!input.addressLine1 || input.addressLine1.trim().length === 0) {
    errors.push('addressLine1 is required');
  }
  if (input.addressLine1 && input.addressLine1.length > 255) {
    errors.push('addressLine1 must be at most 255 characters');
  }

  if (input.addressLine2 && input.addressLine2.length > 255) {
    errors.push('addressLine2 must be at most 255 characters');
  }

  if (!input.city || input.city.trim().length === 0) {
    errors.push('city is required');
  }
  if (input.city && input.city.length > 120) {
    errors.push('city must be at most 120 characters');
  }

  if (!input.state || input.state.trim().length === 0) {
    errors.push('state is required');
  }
  if (input.state && input.state.length > 120) {
    errors.push('state must be at most 120 characters');
  }

  if (!input.postalCode || input.postalCode.trim().length === 0) {
    errors.push('postalCode is required');
  }
  if (input.postalCode && input.postalCode.length > 20) {
    errors.push('postalCode must be at most 20 characters');
  }

  if (input.countryCode && input.countryCode.length > 3) {
    errors.push('countryCode must be at most 3 characters');
  }

  if (input.phone && input.phone.length > 30) {
    errors.push('phone must be at most 30 characters');
  }

  if (errors.length > 0) {
    throw AppError.badRequest(errors.join('; '));
  }
}

/**
 * Create shipping information for an order.
 * Address fields are snapshotted from the request body — not from user profile.
 * Only one shipping record per order (UNIQUE constraint).
 */
export async function createShipping(
  userId: string,
  orderId: string,
  input: ShippingInput,
): Promise<ShippingResponse> {
  validateShippingInput(input);

  const db = getDatabase();

  await getOwnedOrder(userId, orderId);

  const result = await db.transaction().execute(async (trx) => {
    // Lock the order row
    const lockedOrder = await trx
      .selectFrom('orders')
      .select(['orders.id'])
      .where('orders.id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (!lockedOrder) {
      throw AppError.notFound('Order not found');
    }

    // Check for existing shipping record
    const existing = await trx
      .selectFrom('order_shipping')
      .select(['order_shipping.id'])
      .where('order_shipping.order_id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (existing) {
      throw AppError.conflict('Shipping information already exists for this order');
    }

    const insertResult = await sql<{
      id: string;
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
      updated_at: string;
    }>`
      INSERT INTO order_shipping
        (order_id, recipient_name, address_line1, address_line2, city, state, postal_code, country_code, phone, created_at, updated_at)
      VALUES (
        ${orderId},
        ${input.recipientName.trim()},
        ${input.addressLine1.trim()},
        ${input.addressLine2 ? input.addressLine2.trim() : null},
        ${input.city.trim()},
        ${input.state.trim()},
        ${input.postalCode.trim()},
        ${input.countryCode ? input.countryCode.trim() : 'US'},
        ${input.phone ? input.phone.trim() : null},
        now(), now()
      )
      RETURNING *
    `.execute(trx);

    return mapShipping(insertResult.rows[0]!);
  });

  return result;
}

/**
 * Get shipping information for an order. Ownership-scoped.
 */
export async function getShipping(
  userId: string,
  orderId: string,
): Promise<ShippingResponse> {
  const db = getDatabase();

  await getOwnedOrder(userId, orderId);

  const row = await db
    .selectFrom('order_shipping')
    .selectAll()
    .where('order_shipping.order_id', '=', orderId)
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('Shipping information not found');
  }

  return mapShipping(row);
}

/**
 * Update shipping information. Only allowed if shipping status is 'pending'.
 */
export async function updateShipping(
  userId: string,
  orderId: string,
  input: ShippingInput,
): Promise<ShippingResponse> {
  validateShippingInput(input);

  const db = getDatabase();

  await getOwnedOrder(userId, orderId);

  const result = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('order_shipping')
      .select(['order_shipping.id', 'order_shipping.status'])
      .where('order_shipping.order_id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();

    if (!existing) {
      throw AppError.notFound('Shipping information not found');
    }

    if (existing.status !== 'pending') {
      throw AppError.badRequest(
        `Cannot update shipping with status "${existing.status}"`,
      );
    }

    const updated = await sql<{
      id: string;
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
      updated_at: string;
    }>`
      UPDATE order_shipping
      SET
        recipient_name = ${input.recipientName.trim()},
        address_line1 = ${input.addressLine1.trim()},
        address_line2 = ${input.addressLine2 ? input.addressLine2.trim() : null},
        city = ${input.city.trim()},
        state = ${input.state.trim()},
        postal_code = ${input.postalCode.trim()},
        country_code = ${input.countryCode ? input.countryCode.trim() : 'US'},
        phone = ${input.phone ? input.phone.trim() : null},
        updated_at = now()
      WHERE id = ${existing.id}
      RETURNING *
    `.execute(trx);

    return mapShipping(updated.rows[0]!);
  });

  return result;
}