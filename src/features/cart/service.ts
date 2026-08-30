import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface CartItemResponse {
  id: string;
  productId: string;
  variantId: string | null;
  productSlug: string;
  productName: string;
  quantity: number;
  unitPrice: string | null;
  lineTotal: string | null;
  variantSku: string | null;
  variantSize: string | null;
  variantColour: string | null;
}

export interface CartResponse {
  items: CartItemResponse[];
  total: string | null;
}

const cartItemSelect = (db: ReturnType<typeof getDatabase>) =>
  db
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .leftJoin('product_variants', 'product_variants.id', 'cart_items.variant_id')
    .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
    .select([
      'cart_items.id',
      'cart_items.product_id',
      'cart_items.variant_id',
      'products.slug',
      'products.name',
      'cart_items.quantity',
      sql<string | null>`CASE WHEN product_variants.selling_price IS NOT NULL
        THEN CAST(product_variants.selling_price AS TEXT)
        ELSE CAST(prices.amount AS TEXT)
      END`.as('unit_price'),
      sql<string | null>`
        CASE
          WHEN product_variants.selling_price IS NOT NULL
            THEN CAST(cart_items.quantity * product_variants.selling_price AS TEXT)
          WHEN prices.amount IS NOT NULL
            THEN CAST(cart_items.quantity * prices.amount AS TEXT)
          ELSE NULL
        END
      `.as('line_total'),
      'product_variants.sku as variant_sku',
      'product_variants.size as variant_size',
      'product_variants.colour_name as variant_colour',
    ]);

/**
 * Get the current user's cart: all items with product/variant info and prices.
 * Totals are computed in PostgreSQL to avoid floating-point errors.
 */
export async function getCart(userId: string): Promise<CartResponse> {
  const db = getDatabase();

  const items = await cartItemSelect(db)
    .where('cart_items.user_id', '=', userId)
    .orderBy('cart_items.created_at')
    .execute();

  let total: string | null = null;
  if (items.length > 0) {
    const totalRow = await db
      .selectFrom('cart_items')
      .innerJoin('products', 'products.id', 'cart_items.product_id')
      .leftJoin('product_variants', 'product_variants.id', 'cart_items.variant_id')
      .leftJoin('prices', 'prices.product_id', 'cart_items.product_id')
      .select([
        sql<string | null>`
          CASE
            WHEN COUNT(product_variants.selling_price) > 0 OR COUNT(prices.amount) > 0
              THEN CAST(SUM(
                CASE
                  WHEN product_variants.selling_price IS NOT NULL
                    THEN cart_items.quantity * product_variants.selling_price
                  WHEN prices.amount IS NOT NULL
                    THEN cart_items.quantity * prices.amount
                  ELSE 0
                END
              ) AS TEXT)
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
      variantId: row.variant_id,
      productSlug: row.slug,
      productName: row.name,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineTotal: row.line_total,
      variantSku: row.variant_sku,
      variantSize: row.variant_size,
      variantColour: row.variant_colour,
    })),
    total,
  };
}

/**
 * Resolve product + variant. If variantId is specified, use it; otherwise
 * resolve the default active variant for backward compatibility.
 */
async function resolveVariant(
  productId: string,
  variantId: string | undefined | null,
): Promise<{
  variantId: string;
  sku: string;
  size: string;
  colourName: string;
  sellingPrice: string | null;
  quantity: number;
}> {
  const db = getDatabase();

  // Verify product is active
  const product = await db
    .selectFrom('products')
    .select('id')
    .where('id', '=', productId)
    .where('products.status', '=', 'active')
    .executeTakeFirst();

  if (!product) throw AppError.notFound('Product not found');

  if (variantId) {
    const variant = await db
      .selectFrom('product_variants')
      .select([
        'product_variants.id',
        'product_variants.sku',
        'product_variants.size',
        'product_variants.colour_name',
        sql<string | null>`CAST(product_variants.selling_price AS TEXT)`.as('selling_price'),
        'product_variants.quantity',
      ])
      .where('id', '=', variantId)
      .where('product_id', '=', productId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!variant) throw AppError.notFound('Variant not found or not active');
    return {
      variantId: variant.id,
      sku: variant.sku,
      size: variant.size,
      colourName: variant.colour_name,
      sellingPrice: variant.selling_price,
      quantity: variant.quantity,
    };
  }

  // Backward compat: resolve default active variant
  const defaultVariant = await db
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

  if (!defaultVariant) {
    // Backward compatibility: products without any variant are treated
    // as having a virtual variant with 0 stock and no price.
    // This preserves the old "missing inventory row = zero stock" behavior.
    return {
      variantId: `${productId}__virtual`,
      sku: 'virtual',
      size: 'Default',
      colourName: 'Default',
      sellingPrice: null,
      quantity: 0,
    };
  }

  return {
    variantId: defaultVariant.id,
    sku: defaultVariant.sku,
    size: defaultVariant.size,
    colourName: defaultVariant.colour_name,
    sellingPrice: defaultVariant.selling_price,
    quantity: defaultVariant.quantity,
  };
}

/**
 * Add a product variant to the cart or increase quantity.
 * When variantId is omitted, the default active variant is used.
 * Uses variant-level stock check.
 */
export async function addToCart(
  userId: string,
  productId: string,
  quantity: number,
  variantId?: string | null,
): Promise<CartItemResponse> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw AppError.badRequest('Quantity must be a positive integer');
  }

  const variant = await resolveVariant(productId, variantId);

  // Soft inventory check: reject only for real variants that are explicitly 0
  // Virtual variants (backward compat for products without variants) use
  // quantity=0 but should not be rejected here — checkout handles the strict check.
  const isVirtual = variant.variantId.endsWith('__virtual');
  if (!isVirtual && variant.quantity <= 0) {
    throw AppError.badRequest('Variant is out of stock');
  }

  const db = getDatabase();

  // Insert with variant_id — manually check + upsert for simpler syntax
  const upsertVariantId = variant.variantId;

  if (isVirtual) {
    await sql`
      INSERT INTO cart_items (user_id, product_id, quantity, created_at, updated_at)
      VALUES (${userId}, ${productId}, ${quantity}, now(), now())
      ON CONFLICT (user_id, product_id) DO UPDATE
      SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
    `.execute(db);
  } else {
    await sql`
      INSERT INTO cart_items (user_id, product_id, variant_id, quantity, created_at, updated_at)
      VALUES (${userId}, ${productId}, ${upsertVariantId}, ${quantity}, now(), now())
      ON CONFLICT (user_id, variant_id) WHERE variant_id IS NOT NULL DO UPDATE
      SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
    `.execute(db);
  }

  // Fetch the current state — use product_id + variant_id or just product_id for virtual variants
  let row;
  if (isVirtual) {
    row = await cartItemSelect(db)
      .where('cart_items.user_id', '=', userId)
      .where('cart_items.product_id', '=', productId)
      .where('cart_items.variant_id', 'is', null)
      .executeTakeFirstOrThrow();
  } else {
    row = await cartItemSelect(db)
      .where('cart_items.user_id', '=', userId)
      .where('cart_items.variant_id', '=', upsertVariantId)
      .executeTakeFirstOrThrow();
  }

  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    productSlug: row.slug,
    productName: row.name,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    variantSku: row.variant_sku,
    variantSize: row.variant_size,
    variantColour: row.variant_colour,
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

  // Fetch updated state
  const row = await cartItemSelect(db)
    .where('cart_items.id', '=', itemId)
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    productSlug: row.slug,
    productName: row.name,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    variantSku: row.variant_sku,
    variantSize: row.variant_size,
    variantColour: row.variant_colour,
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
