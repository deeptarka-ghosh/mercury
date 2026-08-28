import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let productId: string;
let accessToken: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM inventory`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  // Seed a category
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Test Category', 'test-category', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Seed an active product
  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Test Widget', 'test-widget', 'A test product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  productId = prodResult.rows[0]!.id;

  // Seed a draft product
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Widget', 'draft-widget', 'Not yet active', 'draft', ${categoryId}, now(), now())
  `.execute(db);

  // Create a user for authenticated requests
  const passwordHash = await hashPassword('test-password-123');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('inventory-test@example.com', ${passwordHash}, now(), now())
  `.execute(db);

  app = createApp();

  // Login to get access token
  const loginRes = await supertest(app)
    .post('/auth/login')
    .send({ email: 'inventory-test@example.com', password: 'test-password-123' })
    .expect(200);

  accessToken = (loginRes.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM inventory`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('GET /products/:slug/inventory', () => {
  it('returns out-of-stock for product with no inventory record', async () => {
    const res = await supertest(app)
      .get('/products/test-widget/inventory')
      .expect(200);

    expect(res.body).toEqual({
      inStock: false,
      quantity: 0,
    });
  });

  it('returns inventory after stock is set', async () => {
    // Set stock first
    await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 10 })
      .expect(200);

    const res = await supertest(app)
      .get('/products/test-widget/inventory')
      .expect(200);

    expect(res.body).toEqual({
      inStock: true,
      quantity: 10,
    });
  });

  it('returns 404 for unknown product slug', async () => {
    const res = await supertest(app)
      .get('/products/unknown-product/inventory')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('returns 404 for draft product', async () => {
    const res = await supertest(app)
      .get('/products/draft-widget/inventory')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('works without authentication', async () => {
    const res = await supertest(app)
      .get('/products/test-widget/inventory')
      .expect(200);

    expect(res.body).toHaveProperty('inStock');
    expect(res.body).toHaveProperty('quantity');
  });
});

describe('PUT /products/:slug/inventory', () => {
  it('sets stock quantity for a product', async () => {
    const res = await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 25 })
      .expect(200);

    expect(res.body).toEqual({
      productId: productId,
      productSlug: 'test-widget',
      productName: 'Test Widget',
      quantity: 25,
    });
  });

  it('sets stock to zero', async () => {
    await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 5 })
      .expect(200);

    const res = await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 0 })
      .expect(200);

    expect((res.body as { quantity: number }).quantity).toBe(0);

    // Verify stock is reflected on public endpoint
    const getRes = await supertest(app)
      .get('/products/test-widget/inventory')
      .expect(200);

    expect(getRes.body).toEqual({
      inStock: false,
      quantity: 0,
    });
  });

  it('returns 400 for negative quantity', async () => {
    const res = await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: -5 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Quantity must be a non-negative integer' },
    });
  });

  it('returns 400 for non-integer quantity', async () => {
    const res = await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 3.14 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'quantity must be an integer' },
    });
  });

  it('returns 400 when quantity is missing', async () => {
    const res = await supertest(app)
      .put('/products/test-widget/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'quantity is required' },
    });
  });

  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .put('/products/test-widget/inventory')
      .send({ quantity: 10 })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns 404 for unknown product slug', async () => {
    const res = await supertest(app)
      .put('/products/unknown-product/inventory')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 10 })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('handles concurrent stock updates correctly', async () => {
    // The SET is an absolute operation, so concurrent PUTs with
    // the same target are not conflicting — each transaction completes
    // atomically. This test verifies no deadlock or error.
    const updates = [10, 20, 30, 40, 50].map((qty) =>
      supertest(app)
        .put('/products/test-widget/inventory')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ quantity: qty }),
    );

    const results = await Promise.all(updates);
    const statuses = results.map((r) => r.status);
    const allSettled = statuses.every((s) => s === 200);
    expect(allSettled).toBe(true);

    // The final value should be one of the concurrent updates
    const finalRes = await supertest(app)
      .get('/products/test-widget/inventory')
      .expect(200);

    const finalQuantity = (finalRes.body as { quantity: number }).quantity;
    expect([10, 20, 30, 40, 50]).toContain(finalQuantity);
  });
});

describe('Inventory does not affect other modules', () => {
  it('GET /products still returns only active products', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as Array<{ slug: string }>;
    const slugs = body.map((p) => p.slug);
    expect(slugs).toContain('test-widget');
    expect(slugs).not.toContain('draft-widget');
  });

  it('existing auth endpoints still work', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'inventory-test@example.com', password: 'test-password-123' })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });
});