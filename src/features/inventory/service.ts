import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface InventoryResponse {
  productId: string;
  productSlug: string;
  productName: string;
  quantity: number;
}

export interface InventoryStatusResponse {
  inStock: boolean;
  quantity: number;
}

function mapInventory(row: {
  product_id: string;
  slug: string;
  name: string;
  quantity: number;
}): InventoryResponse {
  return {
    productId: row.product_id,
    productSlug: row.slug,
    productName: row.name,
    quantity: row.quantity,
  };
}

/**
 * Public: get stock level for an active product by slug.
 */
export async function getInventory(slug: string): Promise<InventoryStatusResponse> {
  const db = getDatabase();

  // Only active products are publicly visible
  const row = await db
    .selectFrom('products')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select([
      'inventory.quantity',
    ])
    .where('products.slug', '=', slug)
    .where('products.status', '=', 'active')
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('Product not found');
  }

  const quantity = row.quantity ?? 0;

  return {
    inStock: quantity > 0,
    quantity,
  };
}

/**
 * Authenticated: set inventory quantity for a product by slug.
 * Uses SELECT FOR UPDATE within a transaction for concurrency safety.
 */
export async function setInventory(
  slug: string,
  quantity: number,
): Promise<InventoryResponse> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw AppError.badRequest('Quantity must be a non-negative integer');
  }

  const db = getDatabase();

  // Use a transaction with FOR UPDATE to prevent concurrent updates
  const result = await db.transaction().execute(async (trx) => {
    // Lock the product row
    const product = await trx
      .selectFrom('products')
      .select(['products.id', 'products.name', 'products.slug'])
      .where('products.slug', '=', slug)
      .forUpdate()
      .executeTakeFirst();

    if (!product) {
      throw AppError.notFound('Product not found');
    }

    // Upsert inventory — FOR UPDATE on the inventory row too
    await sql`
      INSERT INTO inventory (product_id, quantity, created_at, updated_at)
      VALUES (${product.id}, ${quantity}, now(), now())
      ON CONFLICT (product_id)
      DO UPDATE SET quantity = ${quantity}, updated_at = now()
    `.execute(trx);

    return {
      product_id: product.id,
      slug: product.slug,
      name: product.name,
      quantity,
    };
  });

  return mapInventory(result);
}