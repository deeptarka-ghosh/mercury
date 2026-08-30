import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';

const statuses = ['draft', 'active', 'archived'];
const targets = ['product', 'category', 'collection', 'campaign', 'promotion', 'url', 'none'];
export interface BannerInput { name: string; placement: string; headline?: string | null; body?: string | null; desktopImageUrl: string; mobileImageUrl?: string | null; altText: string; targetType?: string; targetId?: string | null; targetUrl?: string | null; status?: string; priority?: number; startsAt?: string | null; endsAt?: string | null }

function validate(input: Partial<BannerInput>, create = false) {
  for (const key of create ? ['name', 'placement', 'desktopImageUrl', 'altText'] as const : [] as const) if (!input[key]?.trim()) throw AppError.badRequest(`${key} is required`);
  for (const key of ['name', 'placement', 'desktopImageUrl', 'altText'] as const) if (input[key] !== undefined && !input[key]?.trim()) throw AppError.badRequest(`${key} cannot be empty`);
  if (input.status !== undefined && !statuses.includes(input.status)) throw AppError.badRequest('invalid status');
  if (input.targetType !== undefined && !targets.includes(input.targetType)) throw AppError.badRequest('invalid targetType');
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 100000)) throw AppError.badRequest('invalid priority');
  const type = input.targetType ?? (create ? 'none' : undefined);
  if (type === 'url' && !input.targetUrl) throw AppError.badRequest('targetUrl is required for url banners');
  if (type && !['none', 'url'].includes(type) && !input.targetId) throw AppError.badRequest('targetId is required for entity banners');
  const start = input.startsAt ? Date.parse(input.startsAt) : null; const end = input.endsAt ? Date.parse(input.endsAt) : null;
  if (input.startsAt && Number.isNaN(start)) throw AppError.badRequest('invalid startsAt');
  if (input.endsAt && Number.isNaN(end)) throw AppError.badRequest('invalid endsAt');
  if (start !== null && end !== null && end <= start) throw AppError.badRequest('endsAt must be after startsAt');
}

const map = (r: { id: string; name: string; placement: string; headline: string | null; body: string | null; desktop_image_url: string; mobile_image_url: string | null; alt_text: string; target_type: string; target_id: string | null; target_url: string | null; status: string; priority: number; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string | undefined }) => ({ id: r.id, name: r.name, placement: r.placement, headline: r.headline, body: r.body, desktopImageUrl: r.desktop_image_url, mobileImageUrl: r.mobile_image_url, altText: r.alt_text, targetType: r.target_type, targetId: r.target_id, targetUrl: r.target_url, status: r.status, priority: r.priority, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at });

export async function listBanners(admin: boolean, placement?: string, at = new Date()) {
  if (Number.isNaN(at.getTime())) throw AppError.badRequest('at must be a valid date');
  let q = getDatabase().selectFrom('merchandising_banners').selectAll();
  if (placement) q = q.where('placement', '=', placement);
  if (!admin) q = q.where('status', '=', 'active').where((eb) => eb('starts_at', 'is', null).or('starts_at', '<=', at.toISOString())).where((eb) => eb('ends_at', 'is', null).or('ends_at', '>', at.toISOString()));
  return (await q.orderBy('placement').orderBy('priority', 'desc').orderBy('id').execute()).map(map);
}

export async function createBanner(input: BannerInput) {
  validate(input, true);
  return map(await getDatabase().insertInto('merchandising_banners').values({ name: input.name.trim(), placement: input.placement.trim(), headline: input.headline ?? null, body: input.body ?? null, desktop_image_url: input.desktopImageUrl, mobile_image_url: input.mobileImageUrl ?? null, alt_text: input.altText.trim(), target_type: input.targetType ?? 'none', target_id: input.targetId ?? null, target_url: input.targetUrl ?? null, status: input.status ?? 'draft', priority: input.priority ?? 0, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).returningAll().executeTakeFirstOrThrow());
}

export async function updateBanner(id: string, input: Partial<BannerInput>) {
  const existing = await getDatabase().selectFrom('merchandising_banners').selectAll().where('id', '=', id).executeTakeFirst();
  if (!existing) throw AppError.notFound('Banner not found');
  validate({ ...map(existing), ...input }); const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const columns: Record<string, string> = { name: 'name', placement: 'placement', headline: 'headline', body: 'body', desktopImageUrl: 'desktop_image_url', mobileImageUrl: 'mobile_image_url', altText: 'alt_text', targetType: 'target_type', targetId: 'target_id', targetUrl: 'target_url', status: 'status', priority: 'priority', startsAt: 'starts_at', endsAt: 'ends_at' };
  for (const [key, column] of Object.entries(columns)) if ((input as Record<string, unknown>)[key] !== undefined) values[column] = (input as Record<string, unknown>)[key];
  const row = await getDatabase().updateTable('merchandising_banners').set(values).where('id', '=', id).returningAll().executeTakeFirst();
  return map(row!);
}
