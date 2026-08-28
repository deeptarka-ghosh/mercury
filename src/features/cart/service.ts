import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface CartItemResponse {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  quantity: number;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface CartResponse {
  items: CartItemResponse[];
  total: string | null;
}

/**
 * Get the current user's cart: all items with product info and prices.
 * Totals are computed in PostgreSQL to avoid floating-point errors.
 */
export async function getCart(userId: string): Promise<CartResponse> {
  const db = getDatabase();

  const items = await db
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
    .select([
      'cart_items.id',
      'cart_items.product_id',
      'products.slug',
      'products.name',
      'cart_items.quantity',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('unit_price'),
      sql<string | null>`
        CASE WHEN prices.amount IS NOT NULL
          THEN CAST(cart_items.quantity * prices.amount AS TEXT)
          ELSE NULL
        END
      `.as('line_total'),
    ])
    .where('cart_items.user_id', '=', userId)
    .orderBy('cart_items.created_at')
    .execute();

  let total: string | null = null;
  if (items.length > 0) {
    const totalRow = await db
      .selectFrom('cart_items')
      .innerJoin('products', 'products.id', 'cart_items.product_id')
      .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
      .select([
        sql<string | null>`
          CASE WHEN COUNT(prices.amount) > 0
            THEN CAST(SUM(cart_items.quantity * prices.amount) AS TEXT)
            ELSE NULL
          END
        `.as('cart_total'),
      ])
      .where('cart_items.user_id', '=', userId)
      .executeTakeFirstOrThrow();

    total = totalRow.cart_total ?? null;
  }

  return {
    items: items.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productSlug: row.slug,
      productName: row.name,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineTotal: row.line_total,
    })),
    total,
  };
}

/**
 * Add a product to the cart or increase quantity.
 * Uses ON CONFLICT DO UPDATE for atomic upsert semantics.
 * Only active products may be added.
 * Products with zero stock are rejected (soft check, no reservation).
 */
export async function addToCart(
  userId: string,
  productId: string,
  quantity: number,
): Promise<CartItemResponse> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw AppError.badRequest('Quantity must be a positive integer');
  }

  const db = getDatabase();

  // Verify product exists and is active
  const product = await db
    .selectFrom('products')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select([
      'products.id',
      'products.slug',
      'products.name',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('unit_price'),
      sql<number | null>`inventory.quantity`.as('stock_quantity'),
    ])
    .where('products.id', '=', productId)
    .where('products.status', '=', 'active')
    .executeTakeFirst();

  if (!product) {
    throw AppError.notFound('Product not found');
  }

  // Soft inventory check: reject if stock is explicitly 0
  if (product.stock_quantity !== null && product.stock_quantity <= 0) {
    throw AppError.badRequest('Product is out of stock');
  }

  // Atomic upsert: insert or add to existing quantity
  await sql`
    INSERT INTO cart_items (user_id, product_id, quantity, created_at, updated_at)
    VALUES (${userId}, ${productId}, ${quantity}, now(), now())
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
  `.execute(db);

  // Fetch the current state
  const row = await db
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
    .select([
      'cart_items.id',
      'cart_items.product_id',
      'products.slug',
      'products.name',
      'cart_items.quantity',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('unit_price'),
      sql<string | null>`
        CASE WHEN prices.amount IS NOT NULL
          THEN CAST(cart_items.quantity * prices.amount AS TEXT)
          ELSE NULL
        END
      `.as('line_total'),
    ])
    .where('cart_items.user_id', '=', userId)
    .where('cart_items.product_id', '=', productId)
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    productId: row.product_id,
    productSlug: row.slug,
    productName: row.name,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
  };
}

/**
 * Update the quantity of a specific cart item.
 * Sets absolute quantity (not delta).
 */
export async function updateCartItem(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<CartItemResponse> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw AppError.badRequest('Quantity must be a positive integer');
  }

  const db = getDatabase();

  // Verify the item belongs to the user
  const existing = await db
    .selectFrom('cart_items')
    .select(['cart_items.id'])
    .where('cart_items.id', '=', itemId)
    .where('cart_items.user_id', '=', userId)
    .executeTakeFirst();

  if (!existing) {
    throw AppError.notFound('Cart item not found');
  }

  await db
    .updateTable('cart_items')
    .set({ quantity, updated_at: sql`now()` })
    .where('cart_items.id', '=', itemId)
    .execute();

  // Fetch updated state with product/price info
  const row = await db
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
    .select([
      'cart_items.id',
      'cart_items.product_id',
      'products.slug',
      'products.name',
      'cart_items.quantity',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('unit_price'),
      sql<string | null>`
        CASE WHEN prices.amount IS NOT NULL
          THEN CAST(cart_items.quantity * prices.amount AS TEXT)
          ELSE NULL
        END
      `.as('line_total'),
    ])
    .where('cart_items.id', '=', itemId)
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    productId: row.product_id,
    productSlug: row.slug,
    productName: row.name,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
  };
}

/**
 * Remove a single item from the cart.
 */
export async function removeCartItem(
  userId: string,
  itemId: string,
): Promise<void> {
  const db = getDatabase();

  const result = await db
    .deleteFrom('cart_items')
    .where('cart_items.id', '=', itemId)
    .where('cart_items.user_id', '=', userId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw AppError.notFound('Cart item not found');
  }
}

/**
 * Clear all items from the current user's cart.
 */
export async function clearCart(userId: string): Promise<void> {
  const db = getDatabase();

  await db
    .deleteFrom('cart_items')
    .where('cart_items.user_id', '=', userId)
    .execute();
}