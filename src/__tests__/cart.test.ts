import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let activeProductId: string;
let unpricedProductId: string;
let draftProductId: string;
let outOfStockProductId: string;
let userToken: string;
let user2Token: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
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
    VALUES ('Cart Category', 'cart-category', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Active product with price and stock
  const r1 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget A', 'widget-a', 'An active product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  activeProductId = r1.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${activeProductId}, 19.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${activeProductId}, 100)`.execute(db);

  // Active product without price
  const r2 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget B', 'widget-b', 'Unpriced product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  unpricedProductId = r2.rows[0]!.id;
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${unpricedProductId}, 50)`.execute(db);

  // Active product with zero stock
  const r3 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget C', 'widget-c', 'Out of stock product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  outOfStockProductId = r3.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${outOfStockProductId}, 9.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${outOfStockProductId}, 0)`.execute(db);

  // Draft product
  const r4 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Widget', 'draft-widget', 'Draft product', 'draft', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  draftProductId = r4.rows[0]!.id;

  // Create two users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('cart-user@example.com', ${pwHash}, now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('cart-user2@example.com', ${pwHash}, now(), now())`.execute(db);

  app = createApp();

  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'cart-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'cart-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
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

describe('GET /cart', () => {
  it('returns empty cart for a new user', async () => {
    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body).toEqual({ items: [], total: null });
  });

  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .get('/cart')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});

describe('POST /cart', () => {
  it('adds an active priced product to the cart', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProductId, quantity: 2 })
      .expect(200);

    const body = res.body as {
      id: string;
      productId: string;
      productSlug: string;
      productName: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
    };
    expect(body.productId).toBe(activeProductId);
    expect(body.productSlug).toBe('widget-a');
    expect(body.productName).toBe('Widget A');
    expect(body.quantity).toBe(2);
    expect(body.unitPrice).toBe('19.99');
    expect(body.lineTotal).toBe('39.98');
  });

  it('adding the same product again increments quantity (no duplicate row)', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProductId, quantity: 3 })
      .expect(200);

    expect((res.body as { quantity: number }).quantity).toBe(5);
  });

  it('adds an active unpriced product to the cart', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: unpricedProductId, quantity: 1 })
      .expect(200);

    const body = res.body as {
      productSlug: string;
      quantity: number;
      unitPrice: string | null;
      lineTotal: string | null;
    };
    expect(body.productSlug).toBe('widget-b');
    expect(body.quantity).toBe(1);
    expect(body.unitPrice).toBeNull();
    expect(body.lineTotal).toBeNull();
  });

  it('rejects adding an out-of-stock product', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: outOfStockProductId, quantity: 1 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Product is out of stock' },
    });
  });

  it('rejects adding a draft product', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: draftProductId, quantity: 1 })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('rejects adding an unknown product', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('returns 400 when quantity is missing', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProductId })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive integer' },
    });
  });

  it('returns 400 when productId is missing', async () => {
    const res = await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ quantity: 1 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'productId is required' },
    });
  });

  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .post('/cart')
      .send({ productId: activeProductId, quantity: 1 })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});

describe('PATCH /cart/:itemId', () => {
  it('updates quantity for an existing cart item', async () => {
    // Get the current cart to find the item id
    const cartRes = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const item = (cartRes.body as { items: Array<{ id: string; productSlug: string }> }).items.find(
      (i) => i.productSlug === 'widget-a',
    );
    expect(item).toBeDefined();

    const res = await supertest(app)
      .patch(`/cart/${item!.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ quantity: 3 })
      .expect(200);

    const body = res.body as { productSlug: string; quantity: number; lineTotal: string };
    expect(body.productSlug).toBe('widget-a');
    expect(body.quantity).toBe(3);
    expect(body.lineTotal).toBe('59.97');
  });

  it('returns 404 for non-existent item', async () => {
    const res = await supertest(app)
      .patch('/cart/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ quantity: 1 })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cart item not found' },
    });
  });

  it('returns 404 for another users item', async () => {
    const cartRes = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect((cartRes.body as { items: Array<unknown> }).items.length).toBe(0);

    // user2 has an empty cart — try user1's items
    await supertest(app)
      .patch('/cart/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ quantity: 1 })
      .expect(404);
  });

  it('returns 401 without authentication', async () => {
    await supertest(app)
      .patch('/cart/some-id')
      .send({ quantity: 1 })
      .expect(401);
  });
});

describe('GET /cart with items', () => {
  it('returns cart with items, prices, line totals, and total', async () => {
    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as {
      items: Array<{
        id: string;
        productId: string;
        productSlug: string;
        productName: string;
        quantity: number;
        unitPrice: string | null;
        lineTotal: string | null;
      }>;
      total: string | null;
    };

    expect(body.items.length).toBe(2);
    expect(body.total).toBe('59.97');

    const widgetA = body.items.find((i) => i.productSlug === 'widget-a')!;
    expect(widgetA.quantity).toBe(3);
    expect(widgetA.unitPrice).toBe('19.99');
    expect(widgetA.lineTotal).toBe('59.97');

    const widgetB = body.items.find((i) => i.productSlug === 'widget-b')!;
    expect(widgetB.quantity).toBe(1);
    expect(widgetB.unitPrice).toBeNull();
    expect(widgetB.lineTotal).toBeNull();
  });
});

describe('DELETE /cart/:itemId', () => {
  it('removes a single item from the cart', async () => {
    const cartRes = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const itemId = (cartRes.body as { items: Array<{ id: string }> }).items[0]!.id;

    await supertest(app)
      .delete(`/cart/${itemId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);

    // Verify item is gone
    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const remainingItems = (res.body as { items: Array<{ id: string }> }).items;
    expect(remainingItems.length).toBe(1);
    expect(remainingItems[0]!.id).not.toBe(itemId);
  });

  it('returns 404 for non-existent item', async () => {
    const res = await supertest(app)
      .delete('/cart/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cart item not found' },
    });
  });

  it('returns 401 without authentication', async () => {
    await supertest(app)
      .delete('/cart/some-id')
      .expect(401);
  });
});

describe('DELETE /cart (clear)', () => {
  it('clears all items from the cart', async () => {
    await supertest(app)
      .delete('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);

    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body).toEqual({ items: [], total: null });
  });

  it('clearing an already empty cart returns 204', async () => {
    await supertest(app)
      .delete('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);
  });

  it('does not affect other users carts', async () => {
    // Add item as user2
    await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ productId: activeProductId, quantity: 1 })
      .expect(200);

    // Clear as user1
    await supertest(app)
      .delete('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);

    // User2 cart should still have the item
    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect((res.body as { items: Array<unknown> }).items.length).toBe(1);
  });
});

describe('Cart concurrency', () => {
  it('handles concurrent POST to the same product for the same user without duplicates', async () => {
    // user2 adds the same product concurrently
    const adds = Array.from({ length: 5 }, (_) =>
      supertest(app)
        .post('/cart')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ productId: activeProductId, quantity: 1 }),
    );

    const results = await Promise.all(adds);
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);

    // There should be exactly 1 cart item for user2 with aggregated quantity
    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const items = (res.body as { items: Array<{ productId: string; quantity: number }> }).items;
    expect(items.length).toBe(1);
    expect(items[0]!.productId).toBe(activeProductId);
    // Each post adds 1, so after first POST + 5 concurrent = 6 total
    expect(items[0]!.quantity).toBe(6);
  });
});

describe('Cart does not affect other modules', () => {
  it('GET /health still works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('existing catalog endpoints still work', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});