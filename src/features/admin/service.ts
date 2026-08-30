import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { mapProduct, mapCategory } from '../catalog/service.js';

// --- Audit ---

/**
 * Record an audit log entry.
 * Called after a successful mutation to record the action.
 * Uses a separate insert (not in the mutation's transaction) by design,
 * since existing admin operations do not use transactions.
 * Returns the inserted row id.
 */
export async function recordAudit(
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  const db = getDatabase();
  await sql`
    INSERT INTO audit_log (actor_id, action, resource_type, resource_id, metadata, created_at)
    VALUES (${actorId}, ${action}, ${resourceType}, ${resourceId}, ${metadata ? JSON.stringify(metadata) : null}, now())
  `.execute(db);
}

// --- Category Management ---

export async function listAllCategories() {
  const db = getDatabase();
  const rows = await db
    .selectFrom('categories')
    .select([
      'categories.id',
      'categories.name',
      'categories.slug',
      'categories.description',
      'categories.parent_id',
      'categories.audience','categories.sort_order',
      'categories.created_at',
      'categories.updated_at',
    ])
    .orderBy('name')
    .execute();
  return rows.map(mapCategory);
}

export async function getCategoryById(id: string) {
  const db = getDatabase();
  const row = await db
    .selectFrom('categories')
    .select([
      'categories.id',
      'categories.name',
      'categories.slug',
      'categories.description',
      'categories.parent_id',
      'categories.audience','categories.sort_order',
      'categories.created_at',
      'categories.updated_at',
    ])
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) throw AppError.notFound('Category not found');
  return mapCategory(row);
}

export async function createCategory(data: {
  name: string;
  slug: string;
  description?: string | null;
  parentId?: string | null;
  audience?: string | null; sortOrder?: number;
}) {
  const db = getDatabase();
  try {
    const result = await sql<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      parent_id: string | null;
      created_at: string;
      updated_at: string;
    }>`
      INSERT INTO categories (name, slug, description, parent_id, audience, sort_order, created_at, updated_at)
      VALUES (${data.name}, ${data.slug}, ${data.description ?? null}, ${data.parentId ?? null}, ${data.audience ?? null}, ${data.sortOrder ?? 0}, now(), now())
      RETURNING id, name, slug, description, parent_id, audience, sort_order, created_at, updated_at
    `.execute(db);
    return mapCategory(result.rows[0]!);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw AppError.conflict('A category with this slug already exists');
    }
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
      throw AppError.badRequest('Parent category not found');
    }
    throw err;
  }
}

export async function updateCategory(
  id: string,
  data: { name?: string; slug?: string; description?: string | null; parentId?: string | null; audience?: string | null; sortOrder?: number },
) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updateFields: Record<string, string | number | null> = { updated_at: now };

  if (data.name !== undefined) updateFields.name = data.name;
  if (data.slug !== undefined) updateFields.slug = data.slug;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.parentId !== undefined) updateFields.parent_id = data.parentId;
  if (data.audience !== undefined) updateFields.audience = data.audience;
  if (data.sortOrder !== undefined) updateFields.sort_order = data.sortOrder;

  // Check at least one custom field was provided (updated_at is always set)
  const customKeys = Object.keys(updateFields).filter((k) => k !== 'updated_at');
  if (customKeys.length === 0) throw AppError.badRequest('Nothing to update');

  try {
    const existing = await db
      .selectFrom('categories')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) throw AppError.notFound('Category not found');

    await db
      .updateTable('categories')
      .set(updateFields as never)
      .where('id', '=', id)
      .execute();

    // Fetch the updated row to return
    return getCategoryById(id);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw AppError.conflict('A category with this slug already exists');
    }
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
      throw AppError.badRequest('Parent category not found');
    }
    throw err;
  }
}

export async function deleteCategory(id: string) {
  const db = getDatabase();
  try {
    const result = await sql`DELETE FROM categories WHERE id = ${id}`.execute(db);
    if (result.numAffectedRows === 0n) throw AppError.notFound('Category not found');
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
      throw AppError.badRequest('Cannot delete category: it has child categories or products');
    }
    throw err;
  }
}

// --- Product Management ---

export interface AdminProductInput {
  name: string;
  slug: string;
  description?: string | null;
  status?: string;
  categoryId?: string | null;
  audience?: string | null; material?: string | null; fit?: string | null; careInstructions?: string | null; badge?: string | null; merchandisingPriority?: number;
}

export async function listAllProducts(statusFilter?: string) {
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
      'products.audience','products.material','products.fit','products.care_instructions','products.badge','products.merchandising_priority',
      'categories.name as category_name',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'),
      'products.created_at',
      'products.updated_at',
    ])
    .orderBy('products.created_at', 'desc');

  if (statusFilter) {
    query = query.where('products.status', '=', statusFilter);
  }

  const rows = await query.execute();
  return rows.map(mapProduct);
}

export async function getProductById(id: string) {
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
      'products.audience','products.material','products.fit','products.care_instructions','products.badge','products.merchandising_priority',
      'categories.name as category_name',
      sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'),
      'products.created_at',
      'products.updated_at',
    ])
    .where('products.id', '=', id)
    .executeTakeFirst();

  if (!row) throw AppError.notFound('Product not found');
  return mapProduct(row);
}

export async function createProduct(data: AdminProductInput) {
  const db = getDatabase();
  try {
    const result = await sql<{
      id: string; name: string; slug: string; description: string | null;
      status: string; category_id: string | null; created_at: string; updated_at: string;
    }>`
      INSERT INTO products (name, slug, description, status, category_id, audience, material, fit, care_instructions, badge, merchandising_priority, created_at, updated_at)
      VALUES (${data.name}, ${data.slug}, ${data.description ?? null}, ${data.status ?? 'draft'}, ${data.categoryId ?? null}, ${data.audience ?? null}, ${data.material ?? null}, ${data.fit ?? null}, ${data.careInstructions ?? null}, ${data.badge ?? null}, ${data.merchandisingPriority ?? 0}, now(), now())
      RETURNING id, name, slug, description, status, category_id, audience, material, fit, care_instructions, badge, merchandising_priority, created_at, updated_at
    `.execute(db);
    return mapProduct({
      ...result.rows[0]!,
      category_name: null,
      price: null,
    });
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw AppError.conflict('A product with this slug already exists');
    }
    throw err;
  }
}

export async function updateProduct(
  id: string,
  data: Partial<AdminProductInput>,
) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updateFields: Record<string, string | number | null> = { updated_at: now };

  if (data.name !== undefined) updateFields.name = data.name;
  if (data.slug !== undefined) updateFields.slug = data.slug;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.status !== undefined) updateFields.status = data.status;
  if (data.categoryId !== undefined) updateFields.category_id = data.categoryId;
  if (data.audience !== undefined) updateFields.audience = data.audience;
  if (data.material !== undefined) updateFields.material = data.material;
  if (data.fit !== undefined) updateFields.fit = data.fit;
  if (data.careInstructions !== undefined) updateFields.care_instructions = data.careInstructions;
  if (data.badge !== undefined) updateFields.badge = data.badge;
  if (data.merchandisingPriority !== undefined) updateFields.merchandising_priority = data.merchandisingPriority;

  const customKeys = Object.keys(updateFields).filter((k) => k !== 'updated_at');
  if (customKeys.length === 0) throw AppError.badRequest('Nothing to update');

  try {
    const existing = await db
      .selectFrom('products')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) throw AppError.notFound('Product not found');

    await db
      .updateTable('products')
      .set(updateFields as never)
      .where('id', '=', id)
      .execute();

    return getProductById(id);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw AppError.conflict('A product with this slug already exists');
    }
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
      throw AppError.badRequest('Category not found');
    }
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23514') {
      throw AppError.badRequest('Invalid status value (must be draft, active, or archived)');
    }
    throw err;
  }
}

export async function deleteProduct(id: string) {
  const db = getDatabase();
  try {
    const result = await sql`DELETE FROM products WHERE id = ${id}`.execute(db);
    if (result.numAffectedRows === 0n) throw AppError.notFound('Product not found');
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
      throw AppError.badRequest('Cannot delete product: it has associated orders');
    }
    throw err;
  }
}

export async function setProductStatus(id: string, status: string) {
  const validStatuses = ['draft', 'active', 'archived'];
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest('Status must be one of: draft, active, archived');
  }

  const db = getDatabase();

  // When activating, verify the product has at least one active, purchasable variant
  if (status === 'active') {
    const { hasActivePurchasableVariant } = await import('../variants/service.js');
    const canActivate = await hasActivePurchasableVariant(id);
    if (!canActivate) {
      throw AppError.badRequest(
        'Cannot activate a product without at least one active variant with a valid selling price',
      );
    }
  }

  const result = await sql`
    UPDATE products SET status = ${status}, updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `.execute(db);

  if (result.numAffectedRows === 0n) throw AppError.notFound('Product not found');
  return getProductById(id);
}
