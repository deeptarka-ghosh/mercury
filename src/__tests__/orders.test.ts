import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let userToken: string;
let user2Token: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM cart_items`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM inventory`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  // Seed category
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Orders Category', 'orders-category', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Product A — priced
  const rA = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Original Widget', 'original-widget', 'Will be renamed/repriced later', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  const productAId = rA.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productAId}, 19.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${productAId}, 100)`.execute(db);

  // Product B — will be archived after checkout
  const rB = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Perishable Widget', 'perishable-widget', 'Will be archived', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  const productBId = rB.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productBId}, 9.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${productBId}, 50)`.execute(db);

  // Create users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('orders-user@example.com', ${pwHash}, now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('orders-user2@example.com', ${pwHash}, now(), now())`.execute(db);

  app = createApp();

  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'orders-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'orders-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;

  // Create orders via checkout
  // Order 1: single product A
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ productId: productAId, quantity: 2 })
    .expect(200);

  await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${userToken}`)
    .expect(201);

  // Order 2: product A + product B
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ productId: productAId, quantity: 1 })
    .expect(200);

  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ productId: productBId, quantity: 3 })
    .expect(200);

  await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${userToken}`)
    .expect(201);

  // User 2 creates one order
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${user2Token}`)
    .send({ productId: productAId, quantity: 1 })
    .expect(200);

  await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${user2Token}`)
    .expect(201);

  // Now modify product A after all checkouts
  await sql`
    UPDATE products SET name = 'Renamed Widget', status = 'archived', updated_at = now()
    WHERE id = ${productAId}
  `.execute(db);

  // Archive product B too
  await sql`
    UPDATE products SET status = 'archived', updated_at = now()
    WHERE id = ${productBId}
  `.execute(db);
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM order_items`.execute(db);
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

describe('GET /orders', () => {
  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .get('/orders')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns the authenticated users orders, most recent first', async () => {
    const res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as Array<{ id: string; status: string; total: string | null; createdAt: string }>;
    expect(body.length).toBe(2);

    // Most recent first
    expect(body[0]!.status).toBe('pending');
    expect(body[0]!.total).toBe('49.96'); // 1*19.99 + 3*9.99
    expect(body[0]!.createdAt).toBeDefined();

    expect(body[1]!.total).toBe('39.98'); // 2*19.99
  });

  it('does not include another users orders', async () => {
    const user1Res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const user2Res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const user1Orders = user1Res.body as Array<{ id: string }>;
    const user2Orders = user2Res.body as Array<{ id: string }>;

    // Each user has their own orders
    expect(user1Orders.length).toBe(2);
    expect(user2Orders.length).toBe(1);

    // No overlap
    const user1Ids = new Set(user1Orders.map((o) => o.id));
    const user2Ids = new Set(user2Orders.map((o) => o.id));
    for (const id of user1Ids) {
      expect(user2Ids.has(id)).toBe(false);
    }
  });

  it('returns empty list for a user with no orders', async () => {
    // Create a fresh user with empty order history
    const pwHash = await hashPassword('fresh-password');
    const db = (await import('../db/database.js')).getDatabase();
    await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
      VALUES ('fresh-user@example.com', ${pwHash}, now(), now())`.execute(db);

    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: 'fresh-user@example.com', password: 'fresh-password' })
      .expect(200);
    const freshToken = (loginRes.body as { accessToken: string }).accessToken;

    const res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });
});

describe('GET /orders/:orderId', () => {
  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .get('/orders/some-id')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns order with items from stored snapshots', async () => {
    const listRes = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const orderId = (listRes.body as Array<{ id: string }>)[0]!.id;

    const res = await supertest(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as {
      id: string;
      status: string;
      total: string;
      createdAt: string;
      updatedAt: string;
      items: Array<{
        id: string;
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: string | null;
        lineTotal: string | null;
      }>;
    };

    expect(body.id).toBe(orderId);
    expect(body.status).toBe('pending');
    expect(body.total).toBe('49.96');
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();

    // Two items
    expect(body.items.length).toBe(2);

    // First item (alphabetical by created_at)
    const itemA = body.items.find((i) => i.productName === 'Original Widget')!;
    const itemB = body.items.find((i) => i.productName === 'Perishable Widget')!;

    expect(itemA).toBeDefined();
    expect(itemA.quantity).toBe(1);
    expect(itemA.unitPrice).toBe('19.99');
    expect(itemA.lineTotal).toBe('19.99');

    expect(itemB).toBeDefined();
    expect(itemB.quantity).toBe(3);
    expect(itemB.unitPrice).toBe('9.99');
    expect(itemB.lineTotal).toBe('29.97');
  });

  it('uses historical snapshots — not current product state', async () => {
    const listRes = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Order 0 is the multi-item order, Order 1 is the single-item order
    const orders = listRes.body as Array<{ id: string; total: string }>;

    // The first order (most recent) is the multi-item one
    const orderId = orders[0]!.id;

    const res = await supertest(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as {
      items: Array<{ productName: string; unitPrice: string | null; lineTotal: string | null }>;
    };

    // Product A was renamed to "Renamed Widget" and archived,
    // but snapshots still show original name
    const itemA = body.items.find((i) => i.productName === 'Original Widget')!;
    expect(itemA).toBeDefined();
    expect(itemA.productName).not.toBe('Renamed Widget');
    expect(itemA.unitPrice).toBe('19.99'); // Original price, not changed
  });

  it('returns 404 for unknown order ID', async () => {
    const res = await supertest(app)
      .get('/orders/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Order not found' },
    });
  });

  it('returns 404 for another users order (no information leak)', async () => {
    // Get user2's order IDs
    const user2Res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const user2Orders = user2Res.body as Array<{ id: string }>;
    expect(user2Orders.length).toBeGreaterThan(0);
    const user2OrderId = user2Orders[0]!.id;

    // Try to access it as user 1
    const res = await supertest(app)
      .get(`/orders/${user2OrderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Order not found' },
    });
  });
});

describe('Checkout still works with Orders module', () => {
  it('can checkout and then see the new order', async () => {
    const db = (await import('../db/database.js')).getDatabase();

    // Get a fresh active product
    const catResult = await sql<{ id: string }>`
      INSERT INTO categories (name, slug, created_at, updated_at)
      VALUES ('Fresh Cat', 'fresh-cat', now(), now())
      RETURNING id
    `.execute(db);
    const catId = catResult.rows[0]!.id;

    const prodResult = await sql<{ id: string }>`
      INSERT INTO products (name, slug, status, category_id, created_at, updated_at)
      VALUES ('Fresh Product', 'fresh-product', 'active', ${catId}, now(), now())
      RETURNING id
    `.execute(db);
    const freshProdId = prodResult.rows[0]!.id;
    await sql`INSERT INTO prices (product_id, amount) VALUES (${freshProdId}, 15.00)`.execute(db);
    await sql`INSERT INTO inventory (product_id, quantity) VALUES (${freshProdId}, 10)`.execute(db);

    // Add to cart and checkout
    await supertest(app)
      .post('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: freshProdId, quantity: 2 })
      .expect(200);

    const checkoutRes = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(201);

    const checkoutBody = checkoutRes.body as { orderId: string; status: string; total: string };
    expect(checkoutBody.total).toBe('30.00');

    // Verify it appears in orders
    const listRes = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const orderIds = (listRes.body as Array<{ id: string }>).map((o) => o.id);
    expect(orderIds).toContain(checkoutBody.orderId);
  });
});