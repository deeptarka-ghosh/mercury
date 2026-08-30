import { sql } from 'kysely';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';

const strategies = ['manual', 'collection', 'category', 'new_arrivals', 'best_sellers', 'personalized'];
const statuses = ['draft', 'active', 'archived'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface RecommendationRuleInput { name: string; placement: string; strategy: string; sourceId?: string | null; explanation: string; resultLimit?: number; status?: string; priority?: number; startsAt?: string | null; endsAt?: string | null }
interface RuleRow { id: string; name: string; placement: string; strategy: string; source_id: string | null; explanation: string; result_limit: number; status: string; priority: number; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string | undefined }
interface ProductRow { id: string; name: string; slug: string; description: string | null; category_id: string | null; price: string | null; rank: string | number }
const mapRule = (r: RuleRow) => ({ id: r.id, name: r.name, placement: r.placement, strategy: r.strategy, sourceId: r.source_id, explanation: r.explanation, resultLimit: r.result_limit, status: r.status, priority: r.priority, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at });
const mapProduct = (r: ProductRow, explanation: string) => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, categoryId: r.category_id, price: r.price, rank: Number(r.rank), explanation });

function validate(input: Partial<RecommendationRuleInput>, create = false) {
  for (const key of create ? ['name', 'placement', 'strategy', 'explanation'] as const : [] as const) if (!input[key]?.trim()) throw AppError.badRequest(`${key} is required`);
  if (input.name !== undefined && (!input.name.trim() || input.name.length > 160)) throw AppError.badRequest('invalid name');
  if (input.placement !== undefined && (!input.placement.trim() || input.placement.length > 80)) throw AppError.badRequest('invalid placement');
  if (input.strategy !== undefined && !strategies.includes(input.strategy)) throw AppError.badRequest('invalid strategy');
  if (input.explanation !== undefined && (!input.explanation.trim() || input.explanation.length > 300)) throw AppError.badRequest('invalid explanation');
  if (input.status !== undefined && !statuses.includes(input.status)) throw AppError.badRequest('invalid status');
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 100000)) throw AppError.badRequest('invalid priority');
  if (input.resultLimit !== undefined && (!Number.isInteger(input.resultLimit) || input.resultLimit < 1 || input.resultLimit > 100)) throw AppError.badRequest('invalid resultLimit');
  if (input.strategy && ['collection', 'category'].includes(input.strategy) && (!input.sourceId || !uuid.test(input.sourceId))) throw AppError.badRequest('sourceId is required for this strategy');
  if (input.strategy && !['collection', 'category'].includes(input.strategy) && input.sourceId) throw AppError.badRequest('sourceId is not allowed for this strategy');
  const start = input.startsAt ? Date.parse(input.startsAt) : null; const end = input.endsAt ? Date.parse(input.endsAt) : null;
  if (input.startsAt && Number.isNaN(start)) throw AppError.badRequest('invalid startsAt'); if (input.endsAt && Number.isNaN(end)) throw AppError.badRequest('invalid endsAt');
  if (start !== null && end !== null && end <= start) throw AppError.badRequest('endsAt must be after startsAt');
}

export async function listRules() { return (await getDatabase().selectFrom('recommendation_rules').selectAll().orderBy('placement').orderBy('priority', 'desc').orderBy('id').execute()).map(mapRule); }
export async function createRule(input: RecommendationRuleInput) { validate(input, true); return mapRule(await getDatabase().insertInto('recommendation_rules').values({ name: input.name.trim(), placement: input.placement.trim(), strategy: input.strategy, source_id: input.sourceId ?? null, explanation: input.explanation.trim(), result_limit: input.resultLimit ?? 12, status: input.status ?? 'draft', priority: input.priority ?? 0, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).returningAll().executeTakeFirstOrThrow()); }
export async function updateRule(id: string, input: Partial<RecommendationRuleInput>) {
  const existing = await getDatabase().selectFrom('recommendation_rules').selectAll().where('id', '=', id).executeTakeFirst(); if (!existing) throw AppError.notFound('Recommendation rule not found'); validate({ ...mapRule(existing), ...input });
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() }; const columns: Record<string, string> = { name: 'name', placement: 'placement', strategy: 'strategy', sourceId: 'source_id', explanation: 'explanation', resultLimit: 'result_limit', status: 'status', priority: 'priority', startsAt: 'starts_at', endsAt: 'ends_at' };
  for (const [key, column] of Object.entries(columns)) if ((input as Record<string, unknown>)[key] !== undefined) values[column] = ['name', 'placement', 'explanation'].includes(key) ? String((input as Record<string, unknown>)[key]).trim() : (input as Record<string, unknown>)[key];
  return mapRule((await getDatabase().updateTable('recommendation_rules').set(values).where('id', '=', id).returningAll().executeTakeFirst())!);
}
export async function replaceRuleProducts(ruleId: string, productIds: unknown) {
  if (!Array.isArray(productIds) || productIds.length > 100 || !productIds.every((id) => typeof id === 'string' && uuid.test(id)) || new Set(productIds).size !== productIds.length) throw AppError.badRequest('productIds must contain up to 100 unique product IDs');
  const ids = productIds.filter((id): id is string => typeof id === 'string');
  return getDatabase().transaction().execute(async (trx) => { const rule = await trx.selectFrom('recommendation_rules').select(['id', 'strategy']).where('id', '=', ruleId).executeTakeFirst(); if (!rule) throw AppError.notFound('Recommendation rule not found'); if (rule.strategy !== 'manual') throw AppError.badRequest('products can only be assigned to manual rules'); if (ids.length && (await trx.selectFrom('products').select('id').where('id', 'in', ids).execute()).length !== ids.length) throw AppError.badRequest('One or more products do not exist'); await trx.deleteFrom('recommendation_rule_products').where('rule_id', '=', ruleId).execute(); if (ids.length) await trx.insertInto('recommendation_rule_products').values(ids.map((productId, position) => ({ rule_id: ruleId, product_id: productId, position, created_at: new Date().toISOString() }))).execute(); return { ruleId, productIds: ids }; });
}

export async function resolveRecommendations(placement: string, at = new Date()) {
  if (!placement.trim()) throw AppError.badRequest('placement is required'); if (Number.isNaN(at.getTime())) throw AppError.badRequest('at must be a valid date'); const instant = at.toISOString();
  const rule = await getDatabase().selectFrom('recommendation_rules').selectAll().where('placement', '=', placement).where('status', '=', 'active').where((eb) => eb('starts_at', 'is', null).or('starts_at', '<=', instant)).where((eb) => eb('ends_at', 'is', null).or('ends_at', '>', instant)).orderBy('priority', 'desc').orderBy('id').executeTakeFirst();
  if (!rule) return { rule: null, products: [] }; const limit = rule.result_limit; let result;
  if (rule.strategy === 'manual') result = await sql<ProductRow>`SELECT p.id,p.name,p.slug,p.description,p.category_id,CAST(pr.amount AS TEXT) price,rp.position rank FROM recommendation_rule_products rp JOIN products p ON p.id=rp.product_id LEFT JOIN prices pr ON pr.product_id=p.id WHERE rp.rule_id=${rule.id} AND p.status='active' ORDER BY rp.position,p.id LIMIT ${limit}`.execute(getDatabase());
  else if (rule.strategy === 'collection') result = await sql<ProductRow>`SELECT p.id,p.name,p.slug,p.description,p.category_id,CAST(pr.amount AS TEXT) price,cp.position rank FROM merchandising_collection_products cp JOIN products p ON p.id=cp.product_id LEFT JOIN prices pr ON pr.product_id=p.id WHERE cp.collection_id=${rule.source_id} AND p.status='active' ORDER BY cp.position,p.id LIMIT ${limit}`.execute(getDatabase());
  else if (rule.strategy === 'category') result = await sql<ProductRow>`SELECT p.id,p.name,p.slug,p.description,p.category_id,CAST(pr.amount AS TEXT) price,ROW_NUMBER() OVER (ORDER BY p.name,p.id)-1 rank FROM products p LEFT JOIN prices pr ON pr.product_id=p.id WHERE p.category_id=${rule.source_id} AND p.status='active' ORDER BY p.name,p.id LIMIT ${limit}`.execute(getDatabase());
  else if (rule.strategy === 'best_sellers') result = await sql<ProductRow>`SELECT p.id,p.name,p.slug,p.description,p.category_id,CAST(pr.amount AS TEXT) price,COALESCE(SUM(oi.quantity),0) rank FROM products p JOIN order_items oi ON oi.product_id=p.id JOIN orders o ON o.id=oi.order_id LEFT JOIN prices pr ON pr.product_id=p.id WHERE p.status='active' AND o.status <> 'cancelled' GROUP BY p.id,pr.amount ORDER BY rank DESC,p.id LIMIT ${limit}`.execute(getDatabase());
  else result = await sql<ProductRow>`SELECT p.id,p.name,p.slug,p.description,p.category_id,CAST(pr.amount AS TEXT) price,ROW_NUMBER() OVER (ORDER BY p.created_at DESC,p.id)-1 rank FROM products p LEFT JOIN prices pr ON pr.product_id=p.id WHERE p.status='active' ORDER BY p.created_at DESC,p.id LIMIT ${limit}`.execute(getDatabase());
  return { rule: mapRule(rule), products: result.rows.map((product) => mapProduct(product, rule.explanation)) };
}

export async function resolvePersonalizedRecommendations(userId: string, placement: string, at = new Date()) {
  const base = await resolveRecommendations(placement, at); if (!base.rule || base.rule.strategy !== 'personalized') return base;
  const preferences = await getDatabase().selectFrom('customer_preferences').selectAll().where('user_id', '=', userId).executeTakeFirst();
  const consent = preferences?.personalization_consent === true; const audiences = consent ? preferences.audiences : []; const categoryIds = consent ? preferences.category_ids : [];
  const rows = await sql<ProductRow & { preference_score:string; behavior_score:string }>`SELECT p.id,p.name,p.slug,p.description,p.category_id,CAST(pr.amount AS TEXT) price,p.merchandising_priority rank, (CASE WHEN p.audience=ANY(${sql.val(audiences)}::text[]) THEN 30 ELSE 0 END + CASE WHEN p.category_id=ANY(${sql.val(categoryIds)}::uuid[]) THEN 25 ELSE 0 END)::text preference_score, (CASE WHEN ${consent} THEN COALESCE((SELECT COUNT(*)*5 FROM customer_behavior_events e WHERE e.user_id=${userId} AND (e.product_id=p.id OR e.category_id=p.category_id)),0) ELSE 0 END)::text behavior_score FROM products p LEFT JOIN prices pr ON pr.product_id=p.id WHERE p.status='active' ORDER BY (CASE WHEN p.audience=ANY(${sql.val(audiences)}::text[]) THEN 30 ELSE 0 END + CASE WHEN p.category_id=ANY(${sql.val(categoryIds)}::uuid[]) THEN 25 ELSE 0 END + CASE WHEN ${consent} THEN COALESCE((SELECT COUNT(*)*5 FROM customer_behavior_events e WHERE e.user_id=${userId} AND (e.product_id=p.id OR e.category_id=p.category_id)),0) ELSE 0 END) DESC,p.merchandising_priority DESC,p.id LIMIT ${base.rule.resultLimit}`.execute(getDatabase());
  return { rule: base.rule, products: rows.rows.map((r,index)=>({ ...mapProduct({...r,rank:index}, Number(r.preference_score)+Number(r.behavior_score)>0 ? `Matches your saved preferences and shopping activity (score ${Number(r.preference_score)+Number(r.behavior_score)})` : 'Popular in our current merchandising edit'), score:Number(r.preference_score)+Number(r.behavior_score) })) };
}
