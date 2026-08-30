import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { signAccessToken } from '../auth/tokens.js';
import { createDatabase, destroyDatabase, getDatabase } from '../db/database.js';
import { createPool, destroyPool } from '../db/pool.js';

let app: ReturnType<typeof createApp>; let readToken: string; let writeToken: string; let layoutId: string;
beforeAll(async () => {
  createDatabase(createPool()); const db = getDatabase();
  await sql`DELETE FROM homepage_sections`.execute(db); await sql`DELETE FROM homepage_layouts`.execute(db); await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db); await sql`DELETE FROM refresh_tokens`.execute(db); await sql`DELETE FROM users`.execute(db);
  const roles = await db.selectFrom('roles').selectAll().execute();
  const make = async (email: string, role: string) => { const user = await sql<{ id: string }>`INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (${email}, 'unused', now(), now()) RETURNING id`.execute(db); await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${user.rows[0]!.id}, ${roles.find((item) => item.name === role)!.id}, now())`.execute(db); return signAccessToken(user.rows[0]!.id, email); };
  readToken = await make('homepage-read@test.com', 'backend_read'); writeToken = await make('homepage-write@test.com', 'backend_write'); app = createApp();
});
afterAll(async () => {
  const db = getDatabase(); await sql`DELETE FROM homepage_sections`.execute(db); await sql`DELETE FROM homepage_layouts`.execute(db); await sql`DELETE FROM audit_log`.execute(db); await sql`DELETE FROM user_roles`.execute(db); await sql`DELETE FROM users`.execute(db); await destroyDatabase(); await destroyPool();
});

describe('homepage layouts', () => {
  it('enforces admin roles and validates layouts', async () => {
    await supertest(app).get('/admin/homepage-layouts').expect(401);
    await supertest(app).get('/admin/homepage-layouts').set('Authorization', `Bearer ${readToken}`).expect(200);
    await supertest(app).post('/admin/homepage-layouts').set('Authorization', `Bearer ${readToken}`).send({ name: 'Denied', slug: 'denied' }).expect(403);
    await supertest(app).post('/admin/homepage-layouts').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Bad', slug: 'Bad Slug' }).expect(400);
  });

  it('selects the highest-priority active scheduled layout deterministically', async () => {
    const create = (body: Record<string, unknown>) => supertest(app).post('/admin/homepage-layouts').set('Authorization', `Bearer ${writeToken}`).send({ status: 'active', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', ...body });
    const primary = await create({ name: 'Festival Home', slug: 'festival-home', priority: 50 }).expect(201); layoutId = (primary.body as { id: string }).id;
    await create({ name: 'Default Home', slug: 'default-home', priority: 10 }).expect(201);
    await create({ name: 'Future Home', slug: 'future-home', priority: 100, startsAt: '2026-10-01T00:00:00.000Z', endsAt: null }).expect(201);
    const response = await supertest(app).get('/homepage?at=2026-08-30T00:00:00.000Z').expect(200);
    expect((response.body as { layout: unknown }).layout).toEqual(expect.objectContaining({ slug: 'festival-home' }));
  });

  it('atomically validates, orders, and filters sections', async () => {
    const endpoint = `/admin/homepage-layouts/${layoutId}/sections`;
    const put = (sections: unknown) => supertest(app).put(endpoint).set('Authorization', `Bearer ${writeToken}`).send({ sections });
    await put([{ sectionKey: 'duplicate', sectionType: 'hero' }, { sectionKey: 'duplicate', sectionType: 'editorial' }]).expect(400);
    await put([{ sectionKey: 'bad-source', sectionType: 'hero', sourceType: 'collection' }]).expect(400);
    await put([
      { sectionKey: 'hero', sectionType: 'hero', sourceType: 'banner_placement', sourceKey: 'home.hero', config: { autoplay: false } },
      { sectionKey: 'story', sectionType: 'editorial', title: 'Our craft', enabled: false },
      { sectionKey: 'new', sectionType: 'product_carousel', title: 'New arrivals' },
    ]).expect(200);
    const response = await supertest(app).get('/homepage?at=2026-08-30T00:00:00.000Z').expect(200);
    const body = response.body as { sections: Array<{ sectionKey: string; position: number; config: Record<string, unknown> }> };
    expect(body.sections.map((item) => item.sectionKey)).toEqual(['hero', 'new']);
    expect(body.sections[0]).toEqual(expect.objectContaining({ position: 0, config: { autoplay: false } }));
  });

  it('audits layout and section mutations', async () => {
    const rows = await getDatabase().selectFrom('audit_log').select('action').where('resource_type', '=', 'homepage_layout').execute();
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(['homepage_layout.create', 'homepage_layout.sections.replace']));
  });
});
