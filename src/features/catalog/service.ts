import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

const SEARCH_MAX_LENGTH = 200;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'name_asc' | 'name_desc';

export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  categoryId: string | null;
  category: string | null;
  price: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariantPublicResponse {
  id: string;
  sku: string;
  size: string;
  colourName: string;
  colourCode: string | null;
  sellingPrice: string;
  mrp: string;
  quantity: number;
  lowStockThreshold: number | null;
}

export interface ProductDetailResponse extends ProductResponse {
  variants: VariantPublicResponse[];
}

export interface ProductListResponse {
  products: ProductResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProductSearchFilters {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: SortOption;
  limit?: number;
  offset?: number;
}

function isInStockFilterDefined(f: ProductSearchFilters): f is ProductSearchFilters & { inStock: boolean } {
  return f.inStock === true;
}

export function mapCategory(row: {
  id: string; name: string; slug: string; description: string | null; parent_id: string | null;
  created_at: string; updated_at: string | undefined;
}): CategoryResponse {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description, parentId: row.parent_id, createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at };
}

export function mapProduct(row: {
  id: string; name: string; slug: string; description: string | null; status: string;
  category_id: string | null; category_name: string | null; price: string | null;
  created_at: string; updated_at: string | undefined;
}): ProductResponse {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description, status: row.status, categoryId: row.category_id, category: row.category_name, price: row.price, createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at };
}

export async function listCategories(): Promise<CategoryResponse[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('categories').select(['categories.id', 'categories.name', 'categories.slug', 'categories.description', 'categories.parent_id', 'categories.created_at', 'categories.updated_at']).orderBy('name').execute();
  return rows.map(mapCategory);
}

export async function getCategoryBySlug(slug: string): Promise<{ category: CategoryResponse; products: ProductResponse[] }> {
  const db = getDatabase();
  const category = await db.selectFrom('categories').select(['categories.id', 'categories.name', 'categories.slug', 'categories.description', 'categories.parent_id', 'categories.created_at', 'categories.updated_at']).where('slug', '=', slug).executeTakeFirst();
  if (!category) throw AppError.notFound('Category not found');
  const products = await db.selectFrom('products').leftJoin('categories', 'categories.id', 'products.category_id').leftJoin('prices', 'prices.product_id', 'products.id').select(['products.id', 'products.name', 'products.slug', 'products.description', 'products.status', 'products.category_id', 'categories.name as category_name', sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'), 'products.created_at', 'products.updated_at']).where('products.category_id', '=', category.id).where('products.status', '=', 'active').orderBy('products.name').orderBy('products.id').execute();
  return { category: mapCategory(category), products: products.map(mapProduct) };
}

/**
 * List active products with filtering, sorting, and pagination.
 * All filters (category, minPrice, maxPrice, inStock) applied IDENTICALLY
 * to data and count queries. products.id tiebreaker ensures deterministic pagination.
 */
export async function listProducts(filters: ProductSearchFilters = {}): Promise<ProductListResponse> {
  const db = getDatabase();
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  // ---- Data query ----
  let query = db.selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select(['products.id', 'products.name', 'products.slug', 'products.description', 'products.status', 'products.category_id', 'categories.name as category_name', sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'), 'products.created_at', 'products.updated_at'])
    .where('products.status', '=', 'active');

  if (filters.category) query = query.where('categories.slug', '=', filters.category);
  if (filters.minPrice !== undefined) query = query.where(sql`prices.amount`, '>=', filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.where(sql`prices.amount`, '<=', filters.maxPrice);
  if (isInStockFilterDefined(filters)) query = query.where((eb) => eb('inventory.quantity', '>', 0).or('inventory.quantity', 'is', null));

  const sortOrders: Record<string, string> = {
    price_asc: `prices.amount ASC NULLS LAST, products.name ASC, products.id ASC`,
    price_desc: `prices.amount DESC NULLS LAST, products.name ASC, products.id ASC`,
    newest: `products.created_at DESC, products.name ASC, products.id ASC`,
    name_asc: `products.name ASC, products.id ASC`,
    name_desc: `products.name DESC, products.id ASC`,
  };
  const sortClause = sortOrders[filters.sort ?? 'name_asc'] ?? sortOrders.name_asc!;
  query = query.orderBy(sql.raw(sortClause) as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  // ---- Count query (SAME filters) ----
  let countQuery = db.selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select(sql<number>`COUNT(*)::int`.as('total'))
    .where('products.status', '=', 'active');

  if (filters.category) countQuery = countQuery.where('categories.slug', '=', filters.category);
  if (filters.minPrice !== undefined) countQuery = countQuery.where(sql`prices.amount`, '>=', filters.minPrice);
  if (filters.maxPrice !== undefined) countQuery = countQuery.where(sql`prices.amount`, '<=', filters.maxPrice);
  if (isInStockFilterDefined(filters)) countQuery = countQuery.where((eb) => eb('inventory.quantity', '>', 0).or('inventory.quantity', 'is', null));

  const [countResult, rows] = await Promise.all([countQuery.executeTakeFirstOrThrow(), query.limit(limit).offset(offset).execute()]);
  return { products: rows.map(mapProduct), total: countResult.total, limit, offset };
}

/**
 * Get full product detail for public catalog, including active variants.
 */
export async function getProductBySlug(slug: string): Promise<ProductDetailResponse> {
  const db = getDatabase();
  const row = await db.selectFrom('products').leftJoin('categories', 'categories.id', 'products.category_id').leftJoin('prices', 'prices.product_id', 'products.id').select(['products.id', 'products.name', 'products.slug', 'products.description', 'products.status', 'products.category_id', 'categories.name as category_name', sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'), 'products.created_at', 'products.updated_at']).where('products.slug', '=', slug).where('products.status', '=', 'active').executeTakeFirst();
  if (!row) throw AppError.notFound('Product not found');

  const variants = await db
    .selectFrom('product_variants')
    .select([
      'product_variants.id',
      'product_variants.sku',
      'product_variants.size',
      'product_variants.colour_name',
      'product_variants.colour_code',
      sql<string>`CAST(product_variants.selling_price AS TEXT)`.as('selling_price'),
      sql<string>`CAST(product_variants.mrp AS TEXT)`.as('mrp'),
      'product_variants.quantity',
      'product_variants.low_stock_threshold',
    ])
    .where('product_variants.product_id', '=', row.id)
    .where('product_variants.status', '=', 'active')
    .orderBy('product_variants.created_at')
    .execute();

  return {
    ...mapProduct(row),
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      colourName: v.colour_name,
      colourCode: v.colour_code,
      sellingPrice: v.selling_price,
      mrp: v.mrp,
      quantity: v.quantity,
      lowStockThreshold: v.low_stock_threshold,
    })),
  };
}

/**
 * Search active products with filtering, pagination, and relevance ordering.
 * All filters applied identically to data and count queries.
 */
export async function searchProducts(filters: ProductSearchFilters): Promise<ProductListResponse> {
  if (!filters.q || filters.q.trim().length === 0) throw AppError.badRequest('Search query is required');
  if (filters.q.length > SEARCH_MAX_LENGTH) throw AppError.badRequest(`Search query must be at most ${SEARCH_MAX_LENGTH} characters`);

  const db = getDatabase();
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  const qs = filters.q.trim().toLowerCase();
  const pattern = `%${qs}%`;
  const prefixPattern = `${qs}%`;

  // ---- Data query ----
  let query = db.selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select(['products.id', 'products.name', 'products.slug', 'products.description', 'products.status', 'products.category_id', 'categories.name as category_name', sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'), 'products.created_at', 'products.updated_at'])
    .where('products.status', '=', 'active')
    .where((eb) => eb('products.name', 'ilike', pattern).or('products.description', 'ilike', pattern));

  if (filters.category) query = query.where('categories.slug', '=', filters.category);
  if (filters.minPrice !== undefined) query = query.where(sql`prices.amount`, '>=', filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.where(sql`prices.amount`, '<=', filters.maxPrice);
  if (isInStockFilterDefined(filters)) query = query.where((eb) => eb('inventory.quantity', '>', 0).or('inventory.quantity', 'is', null));

  const sort = filters.sort ?? 'relevance';
  switch (sort) {
    case 'relevance':
      query = query
        .orderBy(sql`CASE WHEN LOWER(products.name) LIKE ${prefixPattern} THEN 3 ELSE 0 END`, 'desc')
        .orderBy(sql`CASE WHEN LOWER(products.name) = ${qs} THEN 2 ELSE 0 END`, 'desc')
        .orderBy(sql`CASE WHEN LOWER(products.name) ILIKE ${pattern} THEN 1 ELSE 0 END`, 'desc')
        .orderBy('products.name', 'asc')
        .orderBy('products.id', 'asc');
      break;
    case 'price_asc': query = query.orderBy('prices.amount', 'asc').orderBy('products.name', 'asc').orderBy('products.id', 'asc'); break;
    case 'price_desc': query = query.orderBy('prices.amount', 'desc').orderBy('products.name', 'asc').orderBy('products.id', 'asc'); break;
    case 'newest': query = query.orderBy('products.created_at', 'desc').orderBy('products.name', 'asc').orderBy('products.id', 'asc'); break;
    case 'name_asc': query = query.orderBy('products.name', 'asc').orderBy('products.id', 'asc'); break;
    case 'name_desc': query = query.orderBy('products.name', 'desc').orderBy('products.id', 'asc'); break;
    default: query = query.orderBy('products.name', 'asc').orderBy('products.id', 'asc');
  }

  // ---- Count query (SAME filters) ----
  let countQuery = db.selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .leftJoin('inventory', 'inventory.product_id', 'products.id')
    .select(sql<number>`COUNT(*)::int`.as('total'))
    .where('products.status', '=', 'active')
    .where((eb) => eb('products.name', 'ilike', pattern).or('products.description', 'ilike', pattern));

  if (filters.category) countQuery = countQuery.where('categories.slug', '=', filters.category);
  if (filters.minPrice !== undefined) countQuery = countQuery.where(sql`prices.amount`, '>=', filters.minPrice);
  if (filters.maxPrice !== undefined) countQuery = countQuery.where(sql`prices.amount`, '<=', filters.maxPrice);
  if (isInStockFilterDefined(filters)) countQuery = countQuery.where((eb) => eb('inventory.quantity', '>', 0).or('inventory.quantity', 'is', null));

  const [countResult, rows] = await Promise.all([countQuery.executeTakeFirstOrThrow(), query.limit(limit).offset(offset).execute()]);
  return { products: rows.map(mapProduct), total: countResult.total, limit, offset };
}