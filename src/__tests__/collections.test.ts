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
let customerToken: string;
let activeProductId: string;
let draftProductId: string;

beforeAll(async () => {
  createDatabase(createPool());
  const db = getDatabase();
  await sql`DELETE FROM merchandising_collection_products`.execute(db);
  await sql`DELETE FROM merchandising_collections`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db);
  await sql`DELETE FROM product_variants`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  const category = await sql<{ id: string }>`INSERT INTO categories (name, slug, created_at, updated_at) VALUES ('Collections', 'collections-test', now(), now()) RETURNING id`.execute(db);
  const active = await sql<{ id: string }>`INSERT INTO products (name, slug, status, category_id, created_at, updated_at) VALUES ('Active Tee', 'active-tee', 'active', ${category.rows[0]!.id}, now(), now()) RETURNING id`.execute(db);
  const draft = await sql<{ id: string }>`INSERT INTO products (name, slug, status, category_id, created_at, updated_at) VALUES ('Draft Tee', 'draft-tee', 'draft', ${category.rows[0]!.id}, now(), now()) RETURNING id`.execute(db);
  activeProductId = active.rows[0]!.id;
  draftProductId = draft.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${activeProductId}, 1490)`.execute(db);

  const roleRows = await db.selectFrom('roles').selectAll().execute();
  const makeUser = async (email: string, role?: string) => {
    const result = await sql<{ id: string }>`INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (${email}, 'not-used', now(), now()) RETURNING id`.execute(db);
    if (role) await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${result.rows[0]!.id}, ${roleRows.find((item) => item.name === role)!.id}, now())`.execute(db);
    return { id: result.rows[0]!.id, token: signAccessToken(result.rows[0]!.id, email) };
  };
  readToken = (await makeUser('collection-read@test.com', 'backend_read')).token;
  writeToken = (await makeUser('collection-write@test.com', 'backend_write')).token;
  customerToken = (await makeUser('collection-customer@test.com')).token;
  app = createApp();
});

afterAll(async () => {
  const db = getDatabase();
  await sql`DELETE FROM merchandising_collection_products`.execute(db);
  await sql`DELETE FROM merchandising_collections`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('merchandising collections', () => {
  it('enforces admin read/write roles', async () => {
    await supertest(app).get('/admin/collections').expect(401);
    await supertest(app).get('/admin/collections').set('Authorization', `Bearer ${customerToken}`).expect(403);
    await supertest(app).get('/admin/collections').set('Authorization', `Bearer ${readToken}`).expect(200);
    await supertest(app).post('/admin/collections').set('Authorization', `Bearer ${readToken}`).send({ name: 'Denied', slug: 'denied' }).expect(403);
  });

  it('validates inputs and rejects duplicate slugs', async () => {
    await supertest(app).post('/admin/collections').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Bad', slug: 'Bad Slug' }).expect(400);
    const body = { name: 'Festival Edit', slug: 'festival-edit', collectionType: 'seasonal', status: 'active', priority: 20, startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-30T00:00:00.000Z' };
    await supertest(app).post('/admin/collections').set('Authorization', `Bearer ${writeToken}`).send(body).expect(201);
    await supertest(app).post('/admin/collections').set('Authorization', `Bearer ${writeToken}`).send(body).expect(409);
  });

  it('resolves schedules and priority deterministically', async () => {
    await supertest(app).post('/admin/collections').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Always Featured', slug: 'always-featured', collectionType: 'featured', status: 'active', priority: 30 }).expect(201);
    await supertest(app).post('/admin/collections').set('Authorization', `Bearer ${writeToken}`).send({ name: 'Future', slug: 'future', status: 'active', priority: 100, startsAt: '2026-10-01T00:00:00.000Z' }).expect(201);
    const response = await supertest(app).get('/collections?at=2026-08-30T12:00:00.000Z').expect(200);
    expect((response.body as Array<{ slug: string }>).map((item) => item.slug)).toEqual(['always-featured', 'festival-edit']);
  });

  it('atomically assigns explicit product order and hides draft products publicly', async () => {
    const list = await supertest(app).get('/admin/collections').set('Authorization', `Bearer ${readToken}`).expect(200);
    const id = (list.body as Array<{ id: string; slug: string }>).find((item) => item.slug === 'festival-edit')!.id;
    await supertest(app).put(`/admin/collections/${id}/products`).set('Authorization', `Bearer ${writeToken}`).send({ productIds: [draftProductId, activeProductId] }).expect(200);
    const response = await supertest(app).get('/collections/festival-edit?at=2026-08-30T12:00:00.000Z').expect(200);
    expect((response.body as { products: Array<{ id: string; position: number }> }).products).toEqual([expect.objectContaining({ id: activeProductId, position: 1 })]);
    await supertest(app).put(`/admin/collections/${id}/products`).set('Authorization', `Bearer ${writeToken}`).send({ productIds: [activeProductId, activeProductId] }).expect(400);
  });

  it('records collection mutations in the audit log', async () => {
    const result = await getDatabase().selectFrom('audit_log').select(['action']).where('resource_type', '=', 'collection').orderBy('created_at').execute();
    expect(result.map((item) => item.action)).toEqual(expect.arrayContaining(['collection.create', 'collection.products.replace']));
  });
});
