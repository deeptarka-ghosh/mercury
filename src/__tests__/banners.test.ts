import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { signAccessToken } from '../auth/tokens.js';
import { createDatabase, destroyDatabase, getDatabase } from '../db/database.js';
import { createPool, destroyPool } from '../db/pool.js';

let app: ReturnType<typeof createApp>;
let readToken: string;
let writeToken: string;

beforeAll(async () => {
  createDatabase(createPool());
  const db = getDatabase();
  await sql`DELETE FROM merchandising_banners`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  const roles = await db.selectFrom('roles').selectAll().execute();
  const make = async (email: string, role: string) => {
    const user = await sql<{ id: string }>`INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (${email}, 'unused', now(), now()) RETURNING id`.execute(db);
    await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${user.rows[0]!.id}, ${roles.find((item) => item.name === role)!.id}, now())`.execute(db);
    return signAccessToken(user.rows[0]!.id, email);
  };
  readToken = await make('banner-read@test.com', 'backend_read');
  writeToken = await make('banner-write@test.com', 'backend_write');
  app = createApp();
});

afterAll(async () => {
  const db = getDatabase();
  await sql`DELETE FROM merchandising_banners`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('merchandising banners', () => {
  it('enforces admin read and write roles', async () => {
    await supertest(app).get('/admin/banners').expect(401);
    await supertest(app).get('/admin/banners').set('Authorization', `Bearer ${readToken}`).expect(200);
    await supertest(app).post('/admin/banners').set('Authorization', `Bearer ${readToken}`).send({}).expect(403);
  });

  it('validates required content, targets, and schedules', async () => {
    const create = (body: Record<string, unknown>) => supertest(app).post('/admin/banners').set('Authorization', `Bearer ${writeToken}`).send(body);
    await create({ name: 'Missing image', placement: 'home.hero', altText: 'Sale' }).expect(400);
    await create({ name: 'Missing alt', placement: 'home.hero', desktopImageUrl: '/hero.jpg' }).expect(400);
    await create({ name: 'Broken link', placement: 'home.hero', desktopImageUrl: '/hero.jpg', altText: 'Sale', targetType: 'url' }).expect(400);
    await create({ name: 'Broken schedule', placement: 'home.hero', desktopImageUrl: '/hero.jpg', altText: 'Sale', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-08-01T00:00:00.000Z' }).expect(400);
  });

  it('publishes active scheduled banners by placement and priority', async () => {
    const create = (body: Record<string, unknown>) => supertest(app).post('/admin/banners').set('Authorization', `Bearer ${writeToken}`).send({ placement: 'home.hero', desktopImageUrl: '/desktop.jpg', mobileImageUrl: '/mobile.jpg', altText: 'Seasonal edit', status: 'active', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', ...body });
    const primary = await create({ name: 'Primary', priority: 50, targetType: 'url', targetUrl: '/collections/puja' }).expect(201);
    await create({ name: 'Secondary', priority: 10 }).expect(201);
    await create({ name: 'Future', priority: 100, startsAt: '2026-10-01T00:00:00.000Z', endsAt: null }).expect(201);
    await create({ name: 'Other placement', placement: 'category.top', priority: 100 }).expect(201);
    const response = await supertest(app).get('/banners?placement=home.hero&at=2026-08-30T00:00:00.000Z').expect(200);
    const body = response.body as Array<{ name: string; mobileImageUrl: string | null; targetUrl: string | null }>;
    expect(body.map((item) => item.name)).toEqual(['Primary', 'Secondary']);
    expect(body[0]).toEqual(expect.objectContaining({ mobileImageUrl: '/mobile.jpg', targetUrl: '/collections/puja' }));

    await supertest(app).patch(`/admin/banners/${(primary.body as { id: string }).id}`).set('Authorization', `Bearer ${writeToken}`).send({ status: 'draft' }).expect(200);
    const disabled = await supertest(app).get('/banners?placement=home.hero&at=2026-08-30T00:00:00.000Z').expect(200);
    expect((disabled.body as Array<{ name: string }>).map((item) => item.name)).toEqual(['Secondary']);
  });

  it('audits banner mutations', async () => {
    const rows = await getDatabase().selectFrom('audit_log').select('action').where('resource_type', '=', 'banner').execute();
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(['banner.create', 'banner.update']));
  });
});
