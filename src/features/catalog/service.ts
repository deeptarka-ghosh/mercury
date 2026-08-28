import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

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

function mapCategory(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string | undefined;
}): CategoryResponse {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function mapProduct(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  category_id: string | null;
  category_name: string | null;
  price: string | null;
  created_at: string;
  updated_at: string | undefined;
}): ProductResponse {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    categoryId: row.category_id,
    category: row.category_name,
    price: row.price,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export async function listCategories(): Promise<CategoryResponse[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('categories')
    .select([
      'categories.id',
      'categories.name',
      'categories.slug',
      'categories.description',
      'categories.parent_id',
      'categories.created_at',
      'categories.updated_at',
    ])
    .orderBy('name')
    .execute();

  return rows.map(mapCategory);
}

export async function getCategoryBySlug(slug: string): Promise<{ category: CategoryResponse; products: ProductResponse[] }> {
  const db = getDatabase();

  const category = await db
    .selectFrom('categories')
    .select([
      'categories.id',
      'categories.name',
      'categories.slug',
      'categories.description',
      'categories.parent_id',
      'categories.created_at',
      'categories.updated_at',
    ])
    .where('slug', '=', slug)
    .executeTakeFirst();

  if (!category) {
    throw AppError.notFound('Category not found');
  }

  const products = await db
    .selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .select([
      'products.id',
      'products.name',
      'products.slug',
      'products.description',
      'products.status',
      'products.category_id',
      'categories.name as category_name',
      sql<string>`CAST(prices.amount AS TEXT)`.as('price'),
      'products.created_at',
      'products.updated_at',
    ])
    .where('products.category_id', '=', category.id)
    .where('products.status', '=', 'active')
    .orderBy('products.name')
    .execute();

  return {
    category: mapCategory(category),
    products: products.map(mapProduct),
  };
}

export async function listProducts(categorySlug?: string): Promise<ProductResponse[]> {
  const db = getDatabase();

  let query = db
    .selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .select([
      'products.id',
      'products.name',
      'products.slug',
      'products.description',
      'products.status',
      'products.category_id',
      'categories.name as category_name',
      sql<string>`CAST(prices.amount AS TEXT)`.as('price'),
      'products.created_at',
      'products.updated_at',
    ])
    .where('products.status', '=', 'active')
    .orderBy('products.name');

  if (categorySlug) {
    query = query.where('categories.slug', '=', categorySlug);
  }

  const rows = await query.execute();

  return rows.map(mapProduct);
}

export async function getProductBySlug(slug: string): Promise<ProductResponse> {
  const db = getDatabase();

  const row = await db
    .selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .select([
      'products.id',
      'products.name',
      'products.slug',
      'products.description',
      'products.status',
      'products.category_id',
      'categories.name as category_name',
      sql<string>`CAST(prices.amount AS TEXT)`.as('price'),
      'products.created_at',
      'products.updated_at',
    ])
    .where('products.slug', '=', slug)
    .where('products.status', '=', 'active')
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('Product not found');
  }

  return mapProduct(row);
}