import { sql } from 'kysely';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';

const statuses = ['draft', 'active', 'archived'];
export interface ScheduleInput { name: string; slug: string; description?: string | null; status?: string; priority?: number; startsAt?: string | null; endsAt?: string | null }
export interface PromotionInput { name: string; code?: string | null; description?: string | null; discountType: string; discountValue: number; minimumOrderAmount?: number | null; collectionId?: string | null; status?: string; priority?: number; stackable?: boolean; startsAt?: string | null; endsAt?: string | null }

function validateSchedule(input: Partial<ScheduleInput>, create = false) {
  if (create && (!input.name || !input.slug)) throw AppError.badRequest('name and slug are required');
  if (input.name !== undefined && (!input.name.trim() || input.name.length > 160)) throw AppError.badRequest('name must be 1 to 160 characters');
  if (input.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw AppError.badRequest('invalid slug');
  if (input.status !== undefined && !statuses.includes(input.status)) throw AppError.badRequest('invalid status');
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 100000)) throw AppError.badRequest('invalid priority');
  const start = input.startsAt ? Date.parse(input.startsAt) : null;
  const end = input.endsAt ? Date.parse(input.endsAt) : null;
  if (input.startsAt && Number.isNaN(start)) throw AppError.badRequest('startsAt must be a valid date');
  if (input.endsAt && Number.isNaN(end)) throw AppError.badRequest('endsAt must be a valid date');
  if (start !== null && end !== null && end <= start) throw AppError.badRequest('endsAt must be after startsAt');
}

const mapCampaign = (row: { id: string; name: string; slug: string; description: string | null; status: string; priority: number; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string | undefined }) => ({ id: row.id, name: row.name, slug: row.slug, description: row.description, status: row.status, priority: row.priority, startsAt: row.starts_at, endsAt: row.ends_at, createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at });

export async function listCampaigns(admin: boolean, at = new Date()) {
  if (Number.isNaN(at.getTime())) throw AppError.badRequest('at must be a valid date');
  let query = getDatabase().selectFrom('merchandising_campaigns').selectAll();
  if (!admin) query = query.where('status', '=', 'active').where((eb) => eb('starts_at', 'is', null).or('starts_at', '<=', at.toISOString())).where((eb) => eb('ends_at', 'is', null).or('ends_at', '>', at.toISOString()));
  return (await query.orderBy('priority', 'desc').orderBy('slug').orderBy('id').execute()).map(mapCampaign);
}

export async function getCampaign(slug: string, at = new Date()) {
  const campaign = (await listCampaigns(false, at)).find((item) => item.slug === slug);
  if (!campaign) throw AppError.notFound('Campaign not found');
  const collections = await getDatabase().selectFrom('merchandising_campaign_collections as link').innerJoin('merchandising_collections as collection', 'collection.id', 'link.collection_id')
    .select(['collection.id', 'collection.name', 'collection.slug', 'collection.collection_type', 'collection.priority', 'link.position'])
    .where('link.campaign_id', '=', campaign.id).where('collection.status', '=', 'active')
    .where((eb) => eb('collection.starts_at', 'is', null).or('collection.starts_at', '<=', at.toISOString()))
    .where((eb) => eb('collection.ends_at', 'is', null).or('collection.ends_at', '>', at.toISOString()))
    .orderBy('link.position').orderBy('collection.id').execute();
  return { campaign, collections: collections.map((row) => ({ id: row.id, name: row.name, slug: row.slug, collectionType: row.collection_type, priority: row.priority, position: row.position })) };
}

export async function createCampaign(input: ScheduleInput) {
  validateSchedule(input, true);
  try { return mapCampaign(await getDatabase().insertInto('merchandising_campaigns').values({ name: input.name.trim(), slug: input.slug, description: input.description ?? null, status: input.status ?? 'draft', priority: input.priority ?? 0, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).returningAll().executeTakeFirstOrThrow()); }
  catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Campaign slug already exists'); throw error; }
}

export async function updateCampaign(id: string, input: Partial<ScheduleInput>) {
  validateSchedule(input); const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const columns: Record<string, string> = { name: 'name', slug: 'slug', description: 'description', status: 'status', priority: 'priority', startsAt: 'starts_at', endsAt: 'ends_at' };
  for (const [key, column] of Object.entries(columns)) if ((input as Record<string, unknown>)[key] !== undefined) values[column] = key === 'name' ? input.name!.trim() : (input as Record<string, unknown>)[key];
  const row = await getDatabase().updateTable('merchandising_campaigns').set(values).where('id', '=', id).returningAll().executeTakeFirst();
  if (!row) throw AppError.notFound('Campaign not found'); return mapCampaign(row);
}

export async function replaceCampaignCollections(campaignId: string, collectionIds: unknown) {
  if (!Array.isArray(collectionIds) || !collectionIds.every((id) => typeof id === 'string') || collectionIds.length > 100 || new Set(collectionIds).size !== collectionIds.length) throw AppError.badRequest('collectionIds must contain up to 100 unique IDs');
  return getDatabase().transaction().execute(async (trx) => {
    if (!await trx.selectFrom('merchandising_campaigns').select('id').where('id', '=', campaignId).executeTakeFirst()) throw AppError.notFound('Campaign not found');
    if (collectionIds.length && (await trx.selectFrom('merchandising_collections').select('id').where('id', 'in', collectionIds).execute()).length !== collectionIds.length) throw AppError.badRequest('One or more collections do not exist');
    await trx.deleteFrom('merchandising_campaign_collections').where('campaign_id', '=', campaignId).execute();
    if (collectionIds.length) await trx.insertInto('merchandising_campaign_collections').values(collectionIds.map((collectionId, position) => ({ campaign_id: campaignId, collection_id: collectionId, position, created_at: new Date().toISOString() }))).execute();
    return { campaignId, collectionIds };
  });
}

function validatePromotion(input: Partial<PromotionInput>, create = false) {
  validateSchedule({ name: input.name ?? '', slug: create ? 'promotion' : undefined, status: input.status, priority: input.priority, startsAt: input.startsAt, endsAt: input.endsAt }, create);
  if (create && !['percentage', 'fixed_amount'].includes(input.discountType ?? '')) throw AppError.badRequest('invalid discountType');
  if (input.discountType !== undefined && !['percentage', 'fixed_amount'].includes(input.discountType)) throw AppError.badRequest('invalid discountType');
  if (input.discountValue !== undefined && (!Number.isFinite(input.discountValue) || input.discountValue <= 0 || (input.discountType === 'percentage' && input.discountValue > 100))) throw AppError.badRequest('invalid discountValue');
  if (create && input.discountValue === undefined) throw AppError.badRequest('discountValue is required');
  if (input.code !== undefined && input.code !== null && !/^[A-Z0-9_-]{3,60}$/.test(input.code)) throw AppError.badRequest('invalid code');
  if (input.minimumOrderAmount !== undefined && input.minimumOrderAmount !== null && (!Number.isFinite(input.minimumOrderAmount) || input.minimumOrderAmount < 0)) throw AppError.badRequest('invalid minimumOrderAmount');
}

export async function listPromotions(admin: boolean, at = new Date()) {
  let query = getDatabase().selectFrom('promotions').select(['id', 'name', 'code', 'description', 'discount_type', sql<string>`CAST(discount_value AS TEXT)`.as('discount_value'), sql<string | null>`CAST(minimum_order_amount AS TEXT)`.as('minimum_order_amount'), 'collection_id', 'status', 'priority', 'stackable', 'starts_at', 'ends_at', 'created_at', 'updated_at']);
  if (!admin) query = query.where('status', '=', 'active').where((eb) => eb('starts_at', 'is', null).or('starts_at', '<=', at.toISOString())).where((eb) => eb('ends_at', 'is', null).or('ends_at', '>', at.toISOString()));
  return (await query.orderBy('priority', 'desc').orderBy('id').execute()).map((r) => ({ id: r.id, name: r.name, code: r.code, description: r.description, discountType: r.discount_type, discountValue: r.discount_value, minimumOrderAmount: r.minimum_order_amount, collectionId: r.collection_id, status: r.status, priority: r.priority, stackable: r.stackable, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at }));
}

export async function createPromotion(input: PromotionInput) {
  validatePromotion(input, true);
  try { return (await getDatabase().insertInto('promotions').values({ name: input.name.trim(), code: input.code ?? null, description: input.description ?? null, discount_type: input.discountType, discount_value: String(input.discountValue), minimum_order_amount: input.minimumOrderAmount === undefined || input.minimumOrderAmount === null ? null : String(input.minimumOrderAmount), collection_id: input.collectionId ?? null, status: input.status ?? 'draft', priority: input.priority ?? 0, stackable: input.stackable ?? false, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).returning('id').executeTakeFirstOrThrow()).id; }
  catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Promotion code already exists'); throw error; }
}

export async function updatePromotion(id: string, input: Partial<PromotionInput>) {
  const existing = await getDatabase().selectFrom('promotions').selectAll().where('id', '=', id).executeTakeFirst();
  if (!existing) throw AppError.notFound('Promotion not found');
  validatePromotion({ name: existing.name, discountType: existing.discount_type, discountValue: Number(existing.discount_value), minimumOrderAmount: existing.minimum_order_amount === null ? null : Number(existing.minimum_order_amount), startsAt: existing.starts_at, endsAt: existing.ends_at, ...input });
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const columns: Record<string, string> = { name: 'name', code: 'code', description: 'description', discountType: 'discount_type', discountValue: 'discount_value', minimumOrderAmount: 'minimum_order_amount', collectionId: 'collection_id', status: 'status', priority: 'priority', stackable: 'stackable', startsAt: 'starts_at', endsAt: 'ends_at' };
  for (const [key, column] of Object.entries(columns)) if ((input as Record<string, unknown>)[key] !== undefined) {
    const value = (input as Record<string, unknown>)[key]; values[column] = key === 'name' ? input.name!.trim() : ['discountValue', 'minimumOrderAmount'].includes(key) && typeof value === 'number' ? value.toString() : value;
  }
  try { await getDatabase().updateTable('promotions').set(values).where('id', '=', id).execute(); return (await listPromotions(true)).find((promotion) => promotion.id === id)!; }
  catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Promotion code already exists'); throw error; }
}
