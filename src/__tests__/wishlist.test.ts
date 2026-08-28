import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let activeProductId: string;
let activeProduct2Id: string;
let draftProductId: string;
let archivedProductId: string;
let userToken: string;
let user2Token: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
  await sql`DELETE FROM wishlist_items`.execute(db);
  await sql`DELETE FROM reviews`.execute(db);
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM cart_items`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM inventory`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  // Seed a category
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Wishlist Category', 'wishlist-category', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Active products with prices
  const r1 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget X', 'widget-x', 'An active product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  activeProductId = r1.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${activeProductId}, 19.99)`.execute(db);

  const r2 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget Y', 'widget-y', 'Another active product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  activeProduct2Id = r2.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${activeProduct2Id}, 29.99)`.execute(db);

  // Draft product
  const r3 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Widget', 'draft-widget', 'Draft product', 'draft', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  draftProductId = r3.rows[0]!.id;

  // Archived product
  const r4 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Old Widget', 'old-widget', 'Archived product', 'archived', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  archivedProductId = r4.rows[0]!.id;

  // Create two users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('wishlist-user@example.com', ${pwHash}, now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('wishlist-user2@example.com', ${pwHash}, now(), now())`.execute(db);

  app = createApp();

  // Login user 1
  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'wishlist-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  // Login user 2
  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'wishlist-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM wishlist_items`.execute(db);
  await sql`DELETE FROM reviews`.execute(db);
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM cart_items`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM inventory`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('GET /wishlist', () => {
  it('returns empty wishlist for a new user (11)', async () => {
    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('returns 401 without authentication (1)', async () => {
    const res = await supertest(app)
      .get('/wishlist')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});

describe('POST /wishlist', () => {
  it('adds an active product to the wishlist (2)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProductId })
      .expect(200);

    const body = res.body as {
      id: string;
      productId: string;
      productSlug: string;
      productName: string;
      price: string | null;
      createdAt: string;
    };

    expect(body.productId).toBe(activeProductId);
    expect(body.productSlug).toBe('widget-x');
    expect(body.productName).toBe('Widget X');
    expect(body.price).toBe('19.99');
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('duplicate addition returns the same item without duplicate row (3)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProductId })
      .expect(200);

    expect(res.body).toMatchObject({
      productId: activeProductId,
      productSlug: 'widget-x',
      price: '19.99',
    });

    // Verify only one wishlist item
    const listRes = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const items = listRes.body as Array<{ productId: string }>;
    const matching = items.filter((i) => i.productId === activeProductId);
    expect(matching.length).toBe(1);
  });

  it('adds a second product to verify ordering (10)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProduct2Id })
      .expect(200);

    expect(res.body).toMatchObject({
      productId: activeProduct2Id,
      productSlug: 'widget-y',
      price: '29.99',
    });
  });

  it('rejects adding a draft product (7)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: draftProductId })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('rejects adding an archived product (7)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: archivedProductId })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('rejects adding a nonexistent product (7)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('rejects missing productId (7)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'productId is required' },
    });
  });

  it('returns 401 without authentication (1)', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .send({ productId: activeProductId })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});

describe('GET /wishlist with items', () => {
  it('returns wishlist items in descending created_at order (10)', async () => {
    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const items = res.body as Array<{
      id: string;
      productId: string;
      productSlug: string;
      productName: string;
      price: string | null;
      createdAt: string;
    }>;

    expect(items.length).toBe(2);
    // widget-y was added second, should be first (descending order)
    expect(items[0]!.productSlug).toBe('widget-y');
    expect(items[1]!.productSlug).toBe('widget-x');
  });

  it('includes price information (5, 6)', async () => {
    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const items = res.body as Array<{ productSlug: string; price: string | null }>;

    const widgetX = items.find((i) => i.productSlug === 'widget-x');
    const widgetY = items.find((i) => i.productSlug === 'widget-y');
    expect(widgetX!.price).toBe('19.99');
    expect(widgetY!.price).toBe('29.99');
  });
});

describe('DELETE /wishlist/:productId', () => {
  it('removes an item from the wishlist (8)', async () => {
    await supertest(app)
      .delete(`/wishlist/${activeProductId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);

    // Verify it's gone
    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const items = res.body as Array<{ productId: string }>;
    const removed = items.filter((i) => i.productId === activeProductId);
    expect(removed.length).toBe(0);
    expect(items.length).toBe(1); // only widget-y remains
  });

  it('returns 404 for non-existent item', async () => {
    const res = await supertest(app)
      .delete(`/wishlist/${activeProductId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Wishlist item not found' },
    });
  });

  it('returns 404 when trying to remove another user item (9)', async () => {
    // user2 tries to remove user1's item (widget-y)
    const res = await supertest(app)
      .delete(`/wishlist/${activeProduct2Id}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Wishlist item not found' },
    });
  });

  it('returns 401 without authentication (1)', async () => {
    await supertest(app)
      .delete(`/wishlist/${activeProduct2Id}`)
      .expect(401);
  });
});

describe('Ownership isolation', () => {
  it('user2 cannot see user1 wishlist items (9)', async () => {
    // user1 still has widget-y
    const resUser1 = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect((resUser1.body as Array<unknown>).length).toBe(1);

    // user2 sees empty
    const resUser2 = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect(resUser2.body).toEqual([]);
  });

  it('user2 can add and see their own items independently', async () => {
    await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ productId: activeProductId })
      .expect(200);

    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const items = res.body as Array<{ productId: string }>;
    expect(items.length).toBe(1);
    expect(items[0]!.productId).toBe(activeProductId);
  });
});

describe('Concurrent duplicate insertion (12)', () => {
  it('handles concurrent POST to the same product without duplicates', async () => {
    // user2 already has activeProductId in wishlist — add concurrently
    const adds = Array.from({ length: 5 }, (_) =>
      supertest(app)
        .post('/wishlist')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ productId: activeProductId }),
    );

    const results = await Promise.all(adds);
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);

    // There should be exactly 1 wishlist item for user2
    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const items = res.body as Array<{ productId: string }>;
    const matching = items.filter((i) => i.productId === activeProductId);
    expect(matching.length).toBe(1);
  });
});

describe('Existing modules remain intact (13)', () => {
  it('GET /health still works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /products still returns active products', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as Array<{ slug: string }>;
    expect(body.some((p) => p.slug === 'widget-x')).toBe(true);
  });

  it('GET /products/search still works', async () => {
    const res = await supertest(app)
      .get('/products/search?q=Widget')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /auth/login still works', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'wishlist-user@example.com', password: 'test-password-123' })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });
});