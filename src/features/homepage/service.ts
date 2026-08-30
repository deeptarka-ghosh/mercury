import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';

const statuses = ['draft', 'active', 'archived'];
const sectionTypes = ['hero', 'banner_strip', 'collection_grid', 'product_carousel', 'category_grid', 'campaign_feature', 'promotion_callout', 'editorial'];
const sourceTypes = ['none', 'collection', 'category', 'campaign', 'promotion', 'banner_placement'];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HomepageLayoutInput { name: string; slug: string; status?: string; priority?: number; startsAt?: string | null; endsAt?: string | null }
export interface HomepageSectionInput { sectionKey: string; sectionType: string; title?: string | null; subtitle?: string | null; sourceType?: string; sourceId?: string | null; sourceKey?: string | null; config?: Record<string, unknown>; enabled?: boolean }

const mapLayout = (row: { id: string; name: string; slug: string; status: string; priority: number; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string | undefined }) => ({ id: row.id, name: row.name, slug: row.slug, status: row.status, priority: row.priority, startsAt: row.starts_at, endsAt: row.ends_at, createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at });
const mapSection = (row: { id: string; layout_id: string; section_key: string; section_type: string; title: string | null; subtitle: string | null; source_type: string; source_id: string | null; source_key: string | null; config: Record<string, unknown>; position: number; enabled: boolean }) => ({ id: row.id, layoutId: row.layout_id, sectionKey: row.section_key, sectionType: row.section_type, title: row.title, subtitle: row.subtitle, sourceType: row.source_type, sourceId: row.source_id, sourceKey: row.source_key, config: row.config, position: row.position, enabled: row.enabled });

function validateLayout(input: Partial<HomepageLayoutInput>, create = false) {
  if (create && (!input.name || !input.slug)) throw AppError.badRequest('name and slug are required');
  if (input.name !== undefined && (!input.name.trim() || input.name.length > 160)) throw AppError.badRequest('name must be 1 to 160 characters');
  if (input.slug !== undefined && !slugPattern.test(input.slug)) throw AppError.badRequest('invalid slug');
  if (input.status !== undefined && !statuses.includes(input.status)) throw AppError.badRequest('invalid status');
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 100000)) throw AppError.badRequest('invalid priority');
  const start = input.startsAt ? Date.parse(input.startsAt) : null; const end = input.endsAt ? Date.parse(input.endsAt) : null;
  if (input.startsAt && Number.isNaN(start)) throw AppError.badRequest('invalid startsAt');
  if (input.endsAt && Number.isNaN(end)) throw AppError.badRequest('invalid endsAt');
  if (start !== null && end !== null && end <= start) throw AppError.badRequest('endsAt must be after startsAt');
}

function validateSections(value: unknown): asserts value is HomepageSectionInput[] {
  if (!Array.isArray(value) || value.length > 50) throw AppError.badRequest('sections must be an array with at most 50 items');
  const keys = new Set<string>();
  for (const section of value as HomepageSectionInput[]) {
    if (!section || typeof section !== 'object' || !section.sectionKey?.trim() || section.sectionKey.length > 120 || keys.has(section.sectionKey)) throw AppError.badRequest('sectionKey values must be unique and non-empty');
    keys.add(section.sectionKey);
    if (!sectionTypes.includes(section.sectionType)) throw AppError.badRequest('invalid sectionType');
    const sourceType = section.sourceType ?? 'none';
    if (!sourceTypes.includes(sourceType)) throw AppError.badRequest('invalid sourceType');
    if (['collection', 'category', 'campaign', 'promotion'].includes(sourceType) && (!section.sourceId || !uuidPattern.test(section.sourceId))) throw AppError.badRequest('sourceId is required for entity sources');
    if (sourceType === 'banner_placement' && !section.sourceKey?.trim()) throw AppError.badRequest('sourceKey is required for banner placement sources');
    if (sourceType === 'none' && (section.sourceId || section.sourceKey)) throw AppError.badRequest('none sources cannot have a source reference');
    if (section.config !== undefined && (!section.config || typeof section.config !== 'object' || Array.isArray(section.config))) throw AppError.badRequest('config must be an object');
  }
}

export async function listAdminLayouts() { return (await getDatabase().selectFrom('homepage_layouts').selectAll().orderBy('priority', 'desc').orderBy('slug').orderBy('id').execute()).map(mapLayout); }

export async function getLayout(id: string) {
  const row = await getDatabase().selectFrom('homepage_layouts').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw AppError.notFound('Homepage layout not found');
  const sections = await getDatabase().selectFrom('homepage_sections').selectAll().where('layout_id', '=', id).orderBy('position').orderBy('id').execute();
  return { layout: mapLayout(row), sections: sections.map(mapSection) };
}

export async function getPublicHomepage(at = new Date()) {
  if (Number.isNaN(at.getTime())) throw AppError.badRequest('at must be a valid date');
  const instant = at.toISOString();
  const row = await getDatabase().selectFrom('homepage_layouts').selectAll().where('status', '=', 'active')
    .where((eb) => eb('starts_at', 'is', null).or('starts_at', '<=', instant)).where((eb) => eb('ends_at', 'is', null).or('ends_at', '>', instant))
    .orderBy('priority', 'desc').orderBy('slug').orderBy('id').executeTakeFirst();
  if (!row) return { layout: null, sections: [] };
  const sections = await getDatabase().selectFrom('homepage_sections').selectAll().where('layout_id', '=', row.id).where('enabled', '=', true).orderBy('position').orderBy('id').execute();
  return { layout: mapLayout(row), sections: sections.map(mapSection) };
}

export async function createLayout(input: HomepageLayoutInput) {
  validateLayout(input, true);
  try { return mapLayout(await getDatabase().insertInto('homepage_layouts').values({ name: input.name.trim(), slug: input.slug, status: input.status ?? 'draft', priority: input.priority ?? 0, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).returningAll().executeTakeFirstOrThrow()); }
  catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Homepage layout slug already exists'); throw error; }
}

export async function updateLayout(id: string, input: Partial<HomepageLayoutInput>) {
  const existing = await getDatabase().selectFrom('homepage_layouts').selectAll().where('id', '=', id).executeTakeFirst(); if (!existing) throw AppError.notFound('Homepage layout not found');
  validateLayout({ ...mapLayout(existing), ...input }); const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const columns: Record<string, string> = { name: 'name', slug: 'slug', status: 'status', priority: 'priority', startsAt: 'starts_at', endsAt: 'ends_at' };
  for (const [key, column] of Object.entries(columns)) if ((input as Record<string, unknown>)[key] !== undefined) values[column] = key === 'name' ? input.name!.trim() : (input as Record<string, unknown>)[key];
  try { return mapLayout((await getDatabase().updateTable('homepage_layouts').set(values).where('id', '=', id).returningAll().executeTakeFirst())!); }
  catch (error) { if ((error as { code?: string }).code === '23505') throw AppError.conflict('Homepage layout slug already exists'); throw error; }
}

export async function replaceSections(layoutId: string, sections: unknown) {
  validateSections(sections);
  await getDatabase().transaction().execute(async (trx) => {
    if (!await trx.selectFrom('homepage_layouts').select('id').where('id', '=', layoutId).executeTakeFirst()) throw AppError.notFound('Homepage layout not found');
    await trx.deleteFrom('homepage_sections').where('layout_id', '=', layoutId).execute();
    if (sections.length) await trx.insertInto('homepage_sections').values(sections.map((section, position) => ({ layout_id: layoutId, section_key: section.sectionKey.trim(), section_type: section.sectionType, title: section.title ?? null, subtitle: section.subtitle ?? null, source_type: section.sourceType ?? 'none', source_id: section.sourceId ?? null, source_key: section.sourceKey?.trim() ?? null, config: section.config ?? {}, position, enabled: section.enabled ?? true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }))).execute();
  });
  return getLayout(layoutId);
}
