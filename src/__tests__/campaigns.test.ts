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
let collectionId: string;

beforeAll(async () => {
  createDatabase(createPool()); const db = getDatabase();
  await sql`DELETE FROM promotions`.execute(db); await sql`DELETE FROM merchandising_campaign_collections`.execute(db);
  await sql`DELETE FROM merchandising_campaigns`.execute(db); await sql`DELETE FROM merchandising_collection_products`.execute(db);
  await sql`DELETE FROM merchandising_collections`.execute(db); await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db); await sql`DELETE FROM refresh_tokens`.execute(db); await sql`DELETE FROM users`.execute(db);
  const collection = await sql<{ id: string }>`INSERT INTO merchandising_collections (name, slug, collection_type, status, priority) VALUES ('Puja Edit', 'puja-edit', 'seasonal', 'active', 20) RETURNING id`.execute(db);
  collectionId = collection.rows[0]!.id;
  const roles = await db.selectFrom('roles').selectAll().execute();
  const make = async (email: string, role: string) => { const user = await sql<{ id: string }>`INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (${email}, 'unused', now(), now()) RETURNING id`.execute(db); await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${user.rows[0]!.id}, ${roles.find((item) => item.name === role)!.id}, now())`.execute(db); return signAccessToken(user.rows[0]!.id, email); };
  readToken = await make('campaign-read@test.com', 'backend_read'); writeToken = await make('campaign-write@test.com', 'backend_write'); app = createApp();
});

afterAll(async () => {
  const db = getDatabase(); await sql`DELETE FROM promotions`.execute(db); await sql`DELETE FROM merchandising_campaign_collections`.execute(db);
  await sql`DELETE FROM merchandising_campaigns`.execute(db); await sql`DELETE FROM merchandising_collections`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db); await sql`DELETE FROM user_roles`.execute(db); await sql`DELETE FROM users`.execute(db);
  await destroyDatabase(); await destroyPool();
});

describe('campaigns and promotions', () => {
  it('enforces read and write roles', async () => {
    await supertest(app).get('/admin/campaigns').expect(401);
    await supertest(app).get('/admin/campaigns').set('Authorization', `Bearer ${readToken}`).expect(200);
    await supertest(app).post('/admin/campaigns').set('Authorization', `Bearer ${readToken}`).send({ name: 'Denied', slug: 'denied' }).expect(403);
  });

  it('publishes scheduled campaigns in deterministic order', async () => {
    const festival = await supertest(app).post('/admin/campaigns').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Durga Puja', slug: 'durga-puja', status: 'active', priority: 50, startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' }).expect(201);
    await supertest(app).post('/admin/campaigns').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Future Diwali', slug: 'future-diwali', status: 'active', priority: 100, startsAt: '2026-10-01T00:00:00.000Z' }).expect(201);
    await supertest(app).put(`/admin/campaigns/${(festival.body as { id: string }).id}/collections`).set('Authorization', `Bearer ${writeToken}`).send({ collectionIds: [collectionId] }).expect(200);
    const list = await supertest(app).get('/campaigns?at=2026-08-30T00:00:00.000Z').expect(200);
    expect((list.body as Array<{ slug: string }>).map((item) => item.slug)).toEqual(['durga-puja']);
    const detail = await supertest(app).get('/campaigns/durga-puja?at=2026-08-30T00:00:00.000Z').expect(200);
    expect((detail.body as { collections: Array<{ slug: string; position: number }> }).collections).toEqual([expect.objectContaining({ slug: 'puja-edit', position: 0 })]);
  });

  it('validates and schedules promotions without exposing drafts', async () => {
    await supertest(app).post('/admin/promotions').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Invalid', discountType: 'percentage', discountValue: 101 }).expect(400);
    const promotion = await supertest(app).post('/admin/promotions').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Puja 15', code: 'PUJA15', discountType: 'percentage', discountValue: 15, collectionId, status: 'active', priority: 30, startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' }).expect(201);
    await supertest(app).patch(`/admin/promotions/${(promotion.body as { id: string }).id}`).set('Authorization', `Bearer ${writeToken}`).send({ discountValue: 20 }).expect(200);
    await supertest(app).patch(`/admin/promotions/${(promotion.body as { id: string }).id}`).set('Authorization', `Bearer ${writeToken}`).send({ discountValue: 101 }).expect(400);
    await supertest(app).post('/admin/promotions').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Draft deal', discountType: 'fixed_amount', discountValue: 500 }).expect(201);
    const response = await supertest(app).get('/promotions?at=2026-08-30T00:00:00.000Z').expect(200);
    expect((response.body as Array<{ code: string | null; discountValue: string }>)).toEqual([expect.objectContaining({ code: 'PUJA15', discountValue: '20.00' })]);
  });

  it('audits campaign and promotion mutations', async () => {
    const rows = await getDatabase().selectFrom('audit_log').select('action').where('resource_type', 'in', ['campaign', 'promotion']).execute();
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(['campaign.create', 'campaign.collections.replace', 'promotion.create']));
  });
});
