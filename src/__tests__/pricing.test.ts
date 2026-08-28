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
    VALUES ('Priced Widget', 'priced-widget', 'A product with price', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  productId = prodResult.rows[0]!.id;

  // Seed an unpriced product
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Unpriced Widget', 'unpriced-widget', 'A product without price', 'active', ${categoryId}, now(), now())
  `.execute(db);

  // Seed a draft product
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Widget', 'draft-widget', 'Not yet active', 'draft', ${categoryId}, now(), now())
  `.execute(db);

  // Set a price on one product
  await sql`
    INSERT INTO prices (product_id, amount, created_at, updated_at)
    VALUES (${productId}, 19.99, now(), now())
  `.execute(db);

  // Create a user for authenticated requests
  const passwordHash = await hashPassword('test-password-123');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('pricing-test@example.com', ${passwordHash}, now(), now())
  `.execute(db);

  app = createApp();

  // Login to get access token
  const loginRes = await supertest(app)
    .post('/auth/login')
    .send({ email: 'pricing-test@example.com', password: 'test-password-123' })
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

describe('GET /products/:slug/price', () => {
  it('returns price for a product with price set', async () => {
    const res = await supertest(app)
      .get('/products/priced-widget/price')
      .expect(200);

    expect(res.body).toEqual({
      amount: '19.99',
    });
  });

  it('returns amount null for product with no price set', async () => {
    const res = await supertest(app)
      .get('/products/unpriced-widget/price')
      .expect(200);

    expect(res.body).toEqual({
      amount: null,
    });
  });

  it('returns 404 for unknown product slug', async () => {
    const res = await supertest(app)
      .get('/products/unknown-product/price')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('returns 404 for draft product', async () => {
    const res = await supertest(app)
      .get('/products/draft-widget/price')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('works without authentication', async () => {
    const res = await supertest(app)
      .get('/products/priced-widget/price')
      .expect(200);

    expect(res.body).toHaveProperty('amount');
  });
});

describe('PUT /products/:slug/price', () => {
  it('sets price on a product with no existing price', async () => {
    const res = await supertest(app)
      .put('/products/unpriced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 49.99 })
      .expect(200);

    const body = res.body as { productId: string; productSlug: string; productName: string; amount: string };
    expect(body).toEqual({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      productId: expect.any(String),
      productSlug: 'unpriced-widget',
      productName: 'Unpriced Widget',
      amount: '49.99',
    });
  });

  it('updates price on an already-priced product', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 39.99 })
      .expect(200);

    expect((res.body as { amount: string }).amount).toBe('39.99');
  });

  it('sets price to zero', async () => {
    await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 5.00 })
      .expect(200);

    const setRes = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 0 })
      .expect(200);

    expect((setRes.body as { amount: string }).amount).toBe('0.00');

    // Verify price is reflected on public endpoint
    const getRes = await supertest(app)
      .get('/products/priced-widget/price')
      .expect(200);

    expect(getRes.body).toEqual({
      amount: '0.00',
    });
  });

  it('accepts integer amounts and formats with 2 decimal places', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 10 })
      .expect(200);

    expect((res.body as { amount: string }).amount).toBe('10.00');
  });

  it('accepts prices with 1 decimal place', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 9.5 })
      .expect(200);

    expect((res.body as { amount: string }).amount).toBe('9.50');
  });

  it('returns 400 for negative amount', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: -5 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Amount must be a non-negative number' },
    });
  });

  it('returns 400 when amount is missing', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'amount is required' },
    });
  });

  it('returns 400 when amount is not a number', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 'not-a-number' })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'amount must be a number' },
    });
  });

  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .put('/products/priced-widget/price')
      .send({ amount: 10 })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns 404 for unknown product slug', async () => {
    const res = await supertest(app)
      .put('/products/unknown-product/price')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 10 })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('handles concurrent price updates correctly', async () => {
    const updates = [100.00, 200.00, 300.00, 400.00, 500.00].map((amount) =>
      supertest(app)
        .put('/products/priced-widget/price')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ amount }),
    );

    const results = await Promise.all(updates);
    const statuses = results.map((r) => r.status);
    const allSettled = statuses.every((s) => s === 200);
    expect(allSettled).toBe(true);

    // The final value should be one of the concurrent updates
    const finalRes = await supertest(app)
      .get('/products/priced-widget/price')
      .expect(200);

    const finalAmount = (finalRes.body as { amount: string }).amount;
    expect(['100.00', '200.00', '300.00', '400.00', '500.00']).toContain(finalAmount);
  });
});

describe('Pricing integration with catalog', () => {
  it('GET /products/:slug includes price field for all products', async () => {
    // priced-widget was seeded with price 19.99
    const pricedRes = await supertest(app)
      .get('/products/priced-widget')
      .expect(200);

    const pricedBody = pricedRes.body as { price: string | null };
    expect(pricedBody).toHaveProperty('price');
    expect(typeof pricedBody.price).toBe('string');

    // unpriced-widget was seeded without a price — may have been
    // updated by PUT tests above, but price field always exists
    const unpricedRes = await supertest(app)
      .get('/products/unpriced-widget')
      .expect(200);

    expect(unpricedRes.body).toHaveProperty('price');
  });

  it('GET /products includes price field on all items', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as Array<{ slug: string; price: string | null }>;
    expect(body.length).toBeGreaterThan(0);
    for (const product of body) {
      expect(product).toHaveProperty('price');
    }
  });
});

describe('Pricing does not affect other modules', () => {
  it('GET /products still returns only active products', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as Array<{ slug: string }>;
    const slugs = body.map((p) => p.slug);
    expect(slugs).toContain('priced-widget');
    expect(slugs).toContain('unpriced-widget');
    expect(slugs).not.toContain('draft-widget');
  });

  it('existing auth endpoints still work', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'pricing-test@example.com', password: 'test-password-123' })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });
});