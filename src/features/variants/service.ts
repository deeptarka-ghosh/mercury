import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface VariantResponse {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  size: string;
  colourName: string;
  colourCode: string | null;
  status: string;
  sellingPrice: string;
  mrp: string;
  costPrice: string | null;
  quantity: number;
  lowStockThreshold: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariantListResponse {
  variants: VariantResponse[];
  total: number;
  limit: number;
  offset: number;
}

function mapVariant(row: {
  id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  size: string;
  colour_name: string;
  colour_code: string | null;
  status: string;
  selling_price: string;
  mrp: string;
  cost_price: string | null;
  quantity: number;
  low_stock_threshold: number | null;
  created_at: string;
  updated_at: string | undefined;
}): VariantResponse {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    barcode: row.barcode,
    size: row.size,
    colourName: row.colour_name,
    colourCode: row.colour_code,
    status: row.status,
    sellingPrice: row.selling_price,
    mrp: row.mrp,
    costPrice: row.cost_price,
    quantity: row.quantity,
    lowStockThreshold: row.low_stock_threshold,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export async function listVariants(
  productId: string,
  limit = 50,
  offset = 0,
): Promise<VariantListResponse> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);

  // Verify product exists
  const product = await db
    .selectFrom('products')
    .select('id')
    .where('id', '=', productId)
    .executeTakeFirst();

  if (!product) throw AppError.notFound('Product not found');

  const [countResult, rows] = await Promise.all([
    db
      .selectFrom('product_variants')
      .select(sql<number>`COUNT(*)::int`.as('total'))
      .where('product_id', '=', productId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('product_variants')
      .selectAll()
      .where('product_id', '=', productId)
      .orderBy('created_at', 'asc')
      .limit(safeLimit)
      .offset(safeOffset)
      .execute(),
  ]);

  return {
    variants: rows.map(mapVariant),
    total: countResult.total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getVariant(
  productId: string,
  variantId: string,
): Promise<VariantResponse> {
  const db = getDatabase();
  const row = await db
    .selectFrom('product_variants')
    .selectAll()
    .where('id', '=', variantId)
    .where('product_id', '=', productId)
    .executeTakeFirst();

  if (!row) throw AppError.notFound('Variant not found');
  return mapVariant(row);
}

export interface CreateVariantInput {
  sku: string;
  barcode?: string | null;
  size: string;
  colourName: string;
  colourCode?: string | null;
  sellingPrice: number;
  mrp: number;
  costPrice?: number | null;
  quantity?: number;
  lowStockThreshold?: number | null;
  status?: string;
}

export async function createVariant(
  productId: string,
  data: CreateVariantInput,
): Promise<VariantResponse> {
  const db = getDatabase();

  // Verify product exists
  const product = await db
    .selectFrom('products')
    .select('id')
    .where('id', '=', productId)
    .executeTakeFirst();

  if (!product) throw AppError.notFound('Product not found');

  // Validate inputs
  if (!data.sku || typeof data.sku !== 'string') {
    throw AppError.badRequest('sku is required');
  }
  if (!data.size || typeof data.size !== 'string') {
    throw AppError.badRequest('size is required');
  }
  if (!data.colourName || typeof data.colourName !== 'string') {
    throw AppError.badRequest('colourName is required');
  }
  if (typeof data.sellingPrice !== 'number' || !Number.isFinite(data.sellingPrice) || data.sellingPrice < 0) {
    throw AppError.badRequest('sellingPrice must be a non-negative number');
  }
  if (typeof data.mrp !== 'number' || !Number.isFinite(data.mrp) || data.mrp < 0) {
    throw AppError.badRequest('mrp must be a non-negative number');
  }
  if (data.mrp < data.sellingPrice) {
    throw AppError.badRequest('mrp must be >= sellingPrice');
  }
  if (data.costPrice !== undefined && data.costPrice !== null) {
    if (typeof data.costPrice !== 'number' || data.costPrice < 0) {
      throw AppError.badRequest('costPrice must be a non-negative number');
    }
  }
  if (data.quantity !== undefined && (!Number.isInteger(data.quantity) || data.quantity < 0)) {
    throw AppError.badRequest('quantity must be a non-negative integer');
  }

  const validStatuses = ['active', 'archived'];
  const status = data.status ?? 'active';
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest('status must be one of: active, archived');
  }

  const sellingPriceStr = data.sellingPrice.toFixed(2);
  const mrpStr = data.mrp.toFixed(2);
  const costPriceStr = data.costPrice !== undefined && data.costPrice !== null
    ? data.costPrice.toFixed(2)
    : null;

  try {
    const result = await sql<{
      id: string; product_id: string; sku: string; barcode: string | null;
      size: string; colour_name: string; colour_code: string | null;
      status: string; selling_price: string; mrp: string; cost_price: string | null;
      quantity: number; low_stock_threshold: number | null;
      created_at: string; updated_at: string;
    }>`
      INSERT INTO product_variants (product_id, sku, barcode, size, colour_name, colour_code, status, selling_price, mrp, cost_price, quantity, low_stock_threshold, created_at, updated_at)
      VALUES (${productId}, ${data.sku}, ${data.barcode ?? null}, ${data.size}, ${data.colourName}, ${data.colourCode ?? null}, ${status}, ${sellingPriceStr}, ${mrpStr}, ${costPriceStr}, ${data.quantity ?? 0}, ${data.lowStockThreshold ?? null}, now(), now())
      RETURNING id, product_id, sku, barcode, size, colour_name, colour_code, status, CAST(selling_price AS TEXT) AS selling_price, CAST(mrp AS TEXT) AS mrp, CAST(cost_price AS TEXT) AS cost_price, quantity, low_stock_threshold, created_at, updated_at
    `.execute(db);

    return mapVariant(result.rows[0]!);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      const constraint = (err as { constraint?: string }).constraint;
      if (constraint?.includes('sku')) {
        throw AppError.conflict('A variant with this SKU already exists');
      }
      if (constraint?.includes('barcode')) {
        throw AppError.conflict('A variant with this barcode already exists');
      }
      throw AppError.conflict('Duplicate variant');
    }
    throw err;
  }
}

export interface UpdateVariantInput {
  sku?: string;
  barcode?: string | null;
  size?: string;
  colourName?: string;
  colourCode?: string | null;
  sellingPrice?: number;
  mrp?: number;
  costPrice?: number | null;
  lowStockThreshold?: number | null;
}

export async function updateVariant(
  productId: string,
  variantId: string,
  data: UpdateVariantInput,
): Promise<VariantResponse> {
  const db = getDatabase();

  // Verify variant exists
  const existing = await db
    .selectFrom('product_variants')
    .selectAll()
    .where('id', '=', variantId)
    .where('product_id', '=', productId)
    .executeTakeFirst();

  if (!existing) throw AppError.notFound('Variant not found');

  const updates: Record<string, unknown> = { updated_at: sql`now()` };

  if (data.sku !== undefined) {
    if (typeof data.sku !== 'string') throw AppError.badRequest('sku must be a string');
    updates.sku = data.sku;
  }
  if (data.barcode !== undefined) {
    updates.barcode = data.barcode;
  }
  if (data.size !== undefined) {
    if (typeof data.size !== 'string') throw AppError.badRequest('size must be a string');
    updates.size = data.size;
  }
  if (data.colourName !== undefined) {
    if (typeof data.colourName !== 'string') throw AppError.badRequest('colourName must be a string');
    updates.colour_name = data.colourName;
  }
  if (data.colourCode !== undefined) {
    updates.colour_code = data.colourCode;
  }
  if (data.sellingPrice !== undefined) {
    if (typeof data.sellingPrice !== 'number' || data.sellingPrice < 0) {
      throw AppError.badRequest('sellingPrice must be a non-negative number');
    }
    updates.selling_price = data.sellingPrice.toFixed(2);
  }
  if (data.mrp !== undefined) {
    if (typeof data.mrp !== 'number' || data.mrp < 0) {
      throw AppError.badRequest('mrp must be a non-negative number');
    }
    updates.mrp = data.mrp.toFixed(2);
  }
  if (data.costPrice !== undefined) {
    updates.cost_price = data.costPrice === null ? null : data.costPrice.toFixed(2);
  }
  if (data.lowStockThreshold !== undefined) {
    updates.low_stock_threshold = data.lowStockThreshold;
  }

  // Validate MRP >= selling price after update
  const finalSellingPrice = updates.selling_price ?? existing.selling_price;
  const finalMrp = updates.mrp ?? existing.mrp;
  if (parseFloat(finalMrp as string) < parseFloat(finalSellingPrice as string)) {
    throw AppError.badRequest('mrp must be >= sellingPrice');
  }

  if (Object.keys(updates).length <= 1) {
    throw AppError.badRequest('Nothing to update');
  }

  try {
    await db
      .updateTable('product_variants')
      .set(updates as never)
      .where('id', '=', variantId)
      .execute();

    return getVariant(productId, variantId);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw AppError.conflict('SKU or barcode conflict');
    }
    throw err;
  }
}

export async function setVariantStatus(
  productId: string,
  variantId: string,
  status: string,
): Promise<VariantResponse> {
  const validStatuses = ['active', 'archived'];
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest('Status must be one of: active, archived');
  }

  const db = getDatabase();

  const existing = await db
    .selectFrom('product_variants')
    .select('id')
    .where('id', '=', variantId)
    .where('product_id', '=', productId)
    .executeTakeFirst();

  if (!existing) throw AppError.notFound('Variant not found');

  await db
    .updateTable('product_variants')
    .set({ status, updated_at: sql`now()` })
    .where('id', '=', variantId)
    .execute();

  return getVariant(productId, variantId);
}

export async function setVariantInventory(
  productId: string,
  variantId: string,
  quantity: number,
): Promise<VariantResponse> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw AppError.badRequest('Quantity must be a non-negative integer');
  }

  const db = getDatabase();

  const result = await db.transaction().execute(async (trx) => {
    const variant = await trx
      .selectFrom('product_variants')
      .select(['id', 'product_id'])
      .where('id', '=', variantId)
      .where('product_id', '=', productId)
      .forUpdate()
      .executeTakeFirst();

    if (!variant) throw AppError.notFound('Variant not found');

    await trx
      .updateTable('product_variants')
      .set({ quantity, updated_at: sql`now()` })
      .where('id', '=', variantId)
      .execute();

    return getVariant(productId, variantId);
  });

  return result;
}

export async function setVariantPricing(
  productId: string,
  variantId: string,
  sellingPrice: number,
  mrp: number,
  costPrice?: number | null,
): Promise<VariantResponse> {
  const db = getDatabase();

  if (typeof sellingPrice !== 'number' || sellingPrice < 0) {
    throw AppError.badRequest('sellingPrice must be a non-negative number');
  }
  if (typeof mrp !== 'number' || mrp < 0) {
    throw AppError.badRequest('mrp must be a non-negative number');
  }
  if (mrp < sellingPrice) {
    throw AppError.badRequest('mrp must be >= sellingPrice');
  }
  if (costPrice !== undefined && costPrice !== null && costPrice < 0) {
    throw AppError.badRequest('costPrice must be a non-negative number');
  }

  const result = await db.transaction().execute(async (trx) => {
    const variant = await trx
      .selectFrom('product_variants')
      .select(['id', 'product_id'])
      .where('id', '=', variantId)
      .where('product_id', '=', productId)
      .forUpdate()
      .executeTakeFirst();

    if (!variant) throw AppError.notFound('Variant not found');

    const updates: Record<string, unknown> = {
      selling_price: sellingPrice.toFixed(2),
      mrp: mrp.toFixed(2),
      updated_at: sql`now()`,
    };
    if (costPrice !== undefined) {
      updates.cost_price = costPrice === null ? null : costPrice.toFixed(2);
    }

    await trx
      .updateTable('product_variants')
      .set(updates as never)
      .where('id', '=', variantId)
      .execute();

    return getVariant(productId, variantId);
  });

  return result;
}

/**
 * Get the default variant for a product (the one created during migration).
 * Used for backward compatibility when no variant is explicitly specified.
 */
export async function getDefaultVariant(productId: string): Promise<{
  variantId: string | null;
  sku: string;
  size: string;
  colourName: string;
  sellingPrice: string | null;
  quantity: number;
} | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('product_variants')
    .select([
      'product_variants.id',
      'product_variants.sku',
      'product_variants.size',
      'product_variants.colour_name',
      sql<string | null>`CAST(product_variants.selling_price AS TEXT)`.as('selling_price'),
      'product_variants.quantity',
    ])
    .where('product_id', '=', productId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    variantId: row.id,
    sku: row.sku,
    size: row.size,
    colourName: row.colour_name,
    sellingPrice: row.selling_price,
    quantity: row.quantity,
  };
}

/**
 * Check if a product has at least one active, purchasable variant
 * with a valid selling price > 0.
 */
export async function hasActivePurchasableVariant(productId: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .selectFrom('product_variants')
    .select(sql<number>`COUNT(*)::int`.as('count'))
    .where('product_id', '=', productId)
    .where('status', '=', 'active')
    .where(sql`selling_price`, '>', 0)
    .executeTakeFirstOrThrow();

  return result.count > 0;
}

/**
 * Get variant by SKU.
 */
export async function getVariantBySku(sku: string): Promise<VariantResponse | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('product_variants')
    .selectAll()
    .where('sku', '=', sku)
    .executeTakeFirst();

  return row ? mapVariant(row) : null;
}