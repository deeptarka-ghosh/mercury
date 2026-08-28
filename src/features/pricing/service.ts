import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface PriceResponse {
  productId: string;
  productSlug: string;
  productName: string;
  amount: string;
}

export interface PriceStatusResponse {
  amount: string | null;
}

function mapPriceResponse(row: {
  product_id: string;
  slug: string;
  name: string;
  amount: string;
}): PriceResponse {
  return {
    productId: row.product_id,
    productSlug: row.slug,
    productName: row.name,
    amount: row.amount,
  };
}

/**
 * Public: get the price for an active product by slug.
 * Products without a price row return amount: null.
 */
export async function getPrice(slug: string): Promise<PriceStatusResponse> {
  const db = getDatabase();

  const row = await db
    .selectFrom('products')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .select([
      sql<string>`CAST(prices.amount AS TEXT)`.as('amount'),
    ])
    .where('products.slug', '=', slug)
    .where('products.status', '=', 'active')
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('Product not found');
  }

  return {
    amount: row.amount,
  };
}

/**
 * Authenticated: set price for a product by slug.
 * Uses SELECT FOR UPDATE within a transaction.
 * Amount must be a non-negative number with at most 2 decimal places.
 */
export async function setPrice(
  slug: string,
  amount: number,
): Promise<PriceResponse> {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw AppError.badRequest('Amount must be a non-negative number');
  }

  // Enforce at most 2 decimal places for monetary precision
  const amountStr = amount.toFixed(2);
  const numericRegex = /^\d+(\.\d{1,2})?$/;
  if (!numericRegex.test(amountStr)) {
    throw AppError.badRequest('Amount must have at most 2 decimal places');
  }

  const db = getDatabase();

  const result = await db.transaction().execute(async (trx) => {
    const product = await trx
      .selectFrom('products')
      .select(['products.id', 'products.name', 'products.slug'])
      .where('products.slug', '=', slug)
      .forUpdate()
      .executeTakeFirst();

    if (!product) {
      throw AppError.notFound('Product not found');
    }

    await sql`
      INSERT INTO prices (product_id, amount, created_at, updated_at)
      VALUES (${product.id}, ${amountStr}, now(), now())
      ON CONFLICT (product_id)
      DO UPDATE SET amount = ${amountStr}, updated_at = now()
    `.execute(trx);

    return {
      product_id: product.id,
      slug: product.slug,
      name: product.name,
      amount: amountStr,
    };
  });

  return mapPriceResponse(result);
}