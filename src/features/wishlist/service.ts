import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface WishlistItemResponse {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  price: string | null;
  createdAt: string;
}

/**
 * Get all wishlist items for the current user.
 * Joins with products, prices, and categories for full product info.
 */
export async function getWishlist(userId: string): Promise<WishlistItemResponse[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('wishlist_items')
    .innerJoin('products', 'products.id', 'wishlist_items.product_id')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'wishlist_items.product_id')
    .select([
      'wishlist_items.id',
      'wishlist_items.product_id',
      'products.slug',
      'products.name',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'),
      'wishlist_items.created_at',
    ])
    .where('wishlist_items.user_id', '=', userId)
    .orderBy('wishlist_items.created_at', 'desc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productSlug: row.slug,
    productName: row.name,
    price: row.price,
    createdAt: row.created_at,
  }));
}

/**
 * Add a product to the current user's wishlist.
 * Verifies the product is active before adding.
 * Uses ON CONFLICT DO NOTHING for idempotent duplicate handling.
 */
export async function addToWishlist(
  userId: string,
  productId: string,
): Promise<WishlistItemResponse> {
  const db = getDatabase();

  // Verify product exists and is active
  const product = await db
    .selectFrom('products')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .select([
      'products.id',
      'products.slug',
      'products.name',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'),
    ])
    .where('products.id', '=', productId)
    .where('products.status', '=', 'active')
    .executeTakeFirst();

  if (!product) {
    throw AppError.notFound('Product not found');
  }

  // Atomic insert with duplicate protection
  await sql`
    INSERT INTO wishlist_items (user_id, product_id, created_at)
    VALUES (${userId}, ${productId}, now())
    ON CONFLICT (user_id, product_id) DO NOTHING
  `.execute(db);

  // Fetch the row (either newly inserted or pre-existing)
  const row = await db
    .selectFrom('wishlist_items')
    .select([
      'wishlist_items.id',
      'wishlist_items.product_id',
      'wishlist_items.created_at',
    ])
    .where('wishlist_items.user_id', '=', userId)
    .where('wishlist_items.product_id', '=', productId)
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    productId: row.product_id,
    productSlug: product.slug,
    productName: product.name,
    price: product.price,
    createdAt: row.created_at,
  };
}

/**
 * Remove a product from the current user's wishlist.
 * Ownership is enforced by filtering on both user_id and product_id.
 */
export async function removeFromWishlist(
  userId: string,
  productId: string,
): Promise<void> {
  const db = getDatabase();

  const result = await db
    .deleteFrom('wishlist_items')
    .where('wishlist_items.user_id', '=', userId)
    .where('wishlist_items.product_id', '=', productId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw AppError.notFound('Wishlist item not found');
  }
}