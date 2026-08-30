import { sql } from 'kysely';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';

const types = ['curated', 'featured', 'seasonal', 'new_arrivals', 'trending', 'best_sellers', 'recommended', 'category', 'deals'];
const statuses = ['draft', 'active', 'archived'];
export interface CollectionInput { name: string; slug: string; description?: string | null; collectionType?: string; status?: string; priority?: number; startsAt?: string | null; endsAt?: string | null }

interface CollectionRow { id: string; name: string; slug: string; description: string | null; collection_type: string; status: string; priority: number; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string | undefined }
const map = (r: CollectionRow) => ({
  id: r.id, name: r.name, slug: r.slug, description: r.description,
  collectionType: r.collection_type, status: r.status, priority: r.priority,
  startsAt: r.starts_at, endsAt: r.ends_at,
  createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
});

function validate(input: Partial<CollectionInput>, create = false) {
  if (create && (!input.name || !input.slug)) throw AppError.badRequest('name and slug are required');
  if (input.name !== undefined && (!input.name.trim() || input.name.length > 160)) throw AppError.badRequest('name must be 1 to 160 characters');
  if (input.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw AppError.badRequest('slug must contain lowercase letters, numbers, and hyphens only');
  if (input.collectionType !== undefined && !types.includes(input.collectionType)) throw AppError.badRequest('invalid collectionType');
  if (input.status !== undefined && !statuses.includes(input.status)) throw AppError.badRequest('invalid status');
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 100000)) throw AppError.badRequest('priority must be an integer between -100000 and 100000');
  const start = input.startsAt ? Date.parse(input.startsAt) : null;
  const end = input.endsAt ? Date.parse(input.endsAt) : null;
  if (input.startsAt && Number.isNaN(start)) throw AppError.badRequest('startsAt must be a valid date');
  if (input.endsAt && Number.isNaN(end)) throw AppError.badRequest('endsAt must be a valid date');
  if (start !== null && end !== null && end <= start) throw AppError.badRequest('endsAt must be after startsAt');
}

export async function listAdminCollections() {
  return (await getDatabase().selectFrom('merchandising_collections').selectAll().orderBy('priority', 'desc').orderBy('slug').orderBy('id').execute()).map(map);
}

export async function listPublicCollections(at = new Date()) {
  if (Number.isNaN(at.getTime())) throw AppError.badRequest('at must be a valid date');
  const instant = at.toISOString();
  return (await getDatabase().selectFrom('merchandising_collections').selectAll().where('status', '=', 'active')
    .where((eb) => eb('starts_at', 'is', null).or('starts_at', '<=', instant))
    .where((eb) => eb('ends_at', 'is', null).or('ends_at', '>', instant))
    .orderBy('priority', 'desc').orderBy('slug').orderBy('id').execute()).map(map);
}

export async function getPublicCollection(slug: string, at = new Date()) {
  const collection = (await listPublicCollections(at)).find((item) => item.slug === slug);
  if (!collection) throw AppError.notFound('Collection not found');
  const rows = await getDatabase().selectFrom('merchandising_collection_products as membership')
    .innerJoin('products', 'products.id', 'membership.product_id').leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('prices', 'prices.product_id', 'products.id')
    .select(['products.id', 'products.name', 'products.slug', 'products.description', 'products.category_id', 'categories.name as category', sql<string | null>`CAST(prices.amount AS TEXT)`.as('price'), 'membership.position'])
    .where('membership.collection_id', '=', collection.id).where('products.status', '=', 'active')
    .orderBy('membership.position').orderBy('products.id').execute();
  return { collection, products: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, categoryId: r.category_id, category: r.category, price: r.price, position: r.position })) };
}

export async function createCollection(input: CollectionInput) {
  validate(input, true);
  try {
    return map(await getDatabase().insertInto('merchandising_collections').values({ name: input.name.trim(), slug: input.slug, description: input.description ?? null, collection_type: input.collectionType ?? 'curated', status: input.status ?? 'draft', priority: input.priority ?? 0, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).returningAll().executeTakeFirstOrThrow());
  } catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Collection slug already exists'); throw error; }
}

export async function updateCollection(id: string, input: Partial<CollectionInput>) {
  validate(input);
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const names: Record<string, string> = { name: 'name', slug: 'slug', description: 'description', collectionType: 'collection_type', status: 'status', priority: 'priority', startsAt: 'starts_at', endsAt: 'ends_at' };
  for (const [api, column] of Object.entries(names)) if ((input as Record<string, unknown>)[api] !== undefined) values[column] = api === 'name' ? input.name!.trim() : (input as Record<string, unknown>)[api];
  try { const row = await getDatabase().updateTable('merchandising_collections').set(values).where('id', '=', id).returningAll().executeTakeFirst(); if (!row) throw AppError.notFound('Collection not found'); return map(row); }
  catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Collection slug already exists'); throw error; }
}

export async function replaceCollectionProducts(collectionId: string, productIds: unknown) {
  if (!Array.isArray(productIds) || !productIds.every((id) => typeof id === 'string') || productIds.length > 500 || new Set(productIds).size !== productIds.length) throw AppError.badRequest('productIds must contain up to 500 unique product IDs');
  return getDatabase().transaction().execute(async (trx) => {
    if (!await trx.selectFrom('merchandising_collections').select('id').where('id', '=', collectionId).executeTakeFirst()) throw AppError.notFound('Collection not found');
    if (productIds.length && (await trx.selectFrom('products').select('id').where('id', 'in', productIds).execute()).length !== productIds.length) throw AppError.badRequest('One or more product IDs do not exist');
    await trx.deleteFrom('merchandising_collection_products').where('collection_id', '=', collectionId).execute();
    if (productIds.length) await trx.insertInto('merchandising_collection_products').values(productIds.map((productId, position) => ({ collection_id: collectionId, product_id: productId, position, created_at: new Date().toISOString() }))).execute();
    return { collectionId, productIds };
  });
}
