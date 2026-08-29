import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let pricedProductId: string;
let unpricedProductId: string;
let limitedStockProductId: string;
let noInventoryProductId: string;
let draftProductId: string;
let userToken: string;
let user2Token: string;

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
    VALUES ('Checkout Category', 'checkout-category', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Priced product with ample stock
  const r1 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget Alpha', 'widget-alpha', 'Priced product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  pricedProductId = r1.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${pricedProductId}, 29.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${pricedProductId}, 50)`.execute(db);

  // Unpriced active product with stock
  const r2 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget Beta', 'widget-beta', 'Unpriced product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  unpricedProductId = r2.rows[0]!.id;
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${unpricedProductId}, 10)`.execute(db);

  // Product with limited stock (1 unit)
  const r3 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget Gamma', 'widget-gamma', 'Limited stock product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  limitedStockProductId = r3.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${limitedStockProductId}, 9.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${limitedStockProductId}, 5)`.execute(db);

  // Active product with NO inventory row — should be treated as out of stock
  const r4 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Widget Delta', 'widget-delta', 'No inventory tracked', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  noInventoryProductId = r4.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${noInventoryProductId}, 14.99)`.execute(db);
  // Deliberately no inventory row

  // Draft product
  const r5 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Widget', 'draft-widget', 'Draft', 'draft', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  draftProductId = r5.rows[0]!.id;

  // Create users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES ('checkout-user@example.com', ${pwHash}, '+15551111111', now(), now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES ('checkout-user2@example.com', ${pwHash}, '+15552222222', now(), now(), now())`.execute(db);

  app = createApp();

  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'checkout-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'checkout-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
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

async function addToCart(token: string, productId: string, quantity: number): Promise<void> {
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, quantity })
    .expect(200);
}

describe('POST /checkout', () => {
  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .post('/checkout')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('rejects empty cart', async () => {
    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Cart is empty' },
    });
  });

  it('rejects if product is no longer active', async () => {
    // Add draft product (should fail at cart-add time too, but test via direct DB)
    const db = (await import('../db/database.js')).getDatabase();
    await sql`INSERT INTO cart_items (user_id, product_id, quantity) VALUES (
      (SELECT id FROM users WHERE email = 'checkout-user@example.com'),
      ${draftProductId},
      1
    )`.execute(db);

    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Product "Draft Widget" is no longer available' },
    });

    // Clean up the stale cart item
    await sql`DELETE FROM cart_items`.execute(db);
  });

  it('rejects if stock is insufficient', async () => {
    await addToCart(userToken, limitedStockProductId, 100);

    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(409);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toMatch(/Insufficient stock for "Widget Gamma"/);

    // Clean up
    const db = (await import('../db/database.js')).getDatabase();
    await sql`DELETE FROM cart_items`.execute(db);
  });

  it('rejects a product with no inventory row (treated as out of stock)', async () => {
    await addToCart(userToken, noInventoryProductId, 1);

    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(409);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('Product "Widget Delta" is out of stock');

    // Cart and inventory remain unchanged
    const db = (await import('../db/database.js')).getDatabase();
    const cartRes = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect((cartRes.body as { items: Array<unknown> }).items.length).toBe(1);

    // No inventory row was created as a side effect
    const invCheck = await sql<{ count: number }>`
      SELECT COUNT(*)::int AS count FROM inventory WHERE product_id = ${noInventoryProductId}
    `.execute(db);
    expect(invCheck.rows[0]!.count).toBe(0);

    await sql`DELETE FROM cart_items`.execute(db);
  });

  it('rolls back entire transaction if one of multiple cart items has no inventory', async () => {
    // Add a valid inventoried product AND a no-inventory product
    await addToCart(userToken, pricedProductId, 1);
    await addToCart(userToken, noInventoryProductId, 1);

    const preCheckoutStock = await sql<{ quantity: number }>`
      SELECT quantity FROM inventory WHERE product_id = ${pricedProductId}
    `.execute(await import('../db/database.js').then((m) => m.getDatabase()));
    const beforeQty = preCheckoutStock.rows[0]!.quantity;

    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(409);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');

    // Inventory of the valid product must NOT have been decremented (rollback)
    const postCheckoutStock = await sql<{ quantity: number }>`
      SELECT quantity FROM inventory WHERE product_id = ${pricedProductId}
    `.execute(await import('../db/database.js').then((m) => m.getDatabase()));
    expect(postCheckoutStock.rows[0]!.quantity).toBe(beforeQty);

    // Cart must NOT have been cleared (rollback)
    const cartRes = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect((cartRes.body as { items: Array<unknown> }).items.length).toBe(2);

    // Clean up
    const db = (await import('../db/database.js')).getDatabase();
    await sql`DELETE FROM cart_items`.execute(db);
  });

  it('succeeds with a single priced product', async () => {
    await addToCart(userToken, pricedProductId, 2);

    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(201);

    const body = res.body as { orderId: string; status: string; total: string | null };
    expect(body).toHaveProperty('orderId');
    expect(body.status).toBe('pending');
    expect(body.total).toBe('59.98'); // 2 * 29.99

    // Cart is cleared
    const cartRes = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(cartRes.body).toEqual({ items: [], total: null });

    // Inventory was decremented
    const invResult = await sql<{ quantity: number }>`
      SELECT quantity FROM inventory WHERE product_id = ${pricedProductId}
    `.execute(await import('../db/database.js').then((m) => m.getDatabase()));
    expect(invResult.rows[0]!.quantity).toBe(48); // 50 - 2
  });

  it('succeeds with multiple products including unpriced', async () => {
    await addToCart(userToken, pricedProductId, 1);
    await addToCart(userToken, unpricedProductId, 3);

    const res = await supertest(app)
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(201);

    const body = res.body as { orderId: string; status: string; total: string | null };
    expect(body.total).toBe('29.99'); // Only priced item counted

    // Verify order_items exist
    const db = (await import('../db/database.js')).getDatabase();
    const items = await db
      .selectFrom('order_items')
      .select(['product_name', 'quantity', 'unit_price', 'line_total'])
      .where('order_items.order_id', '=', body.orderId)
      .orderBy('product_name')
      .execute();

    expect(items.length).toBe(2);

    const pricedItem = items.find((i) => i.product_name === 'Widget Alpha')!;
    expect(pricedItem.quantity).toBe(1);
    expect(pricedItem.unit_price).toBe('29.99');
    expect(pricedItem.line_total).toBe('29.99');

    const unpricedItem = items.find((i) => i.product_name === 'Widget Beta')!;
    expect(unpricedItem.quantity).toBe(3);
    expect(unpricedItem.unit_price).toBeNull();
    expect(unpricedItem.line_total).toBeNull();

    // Inventory decremented for both
    const invResult = await sql<{ quantity: number }>`
      SELECT quantity FROM inventory WHERE product_id = ${pricedProductId}
    `.execute(db);
    expect(invResult.rows[0]!.quantity).toBe(47);
  });
});

describe('Checkout concurrency', () => {
  it('handles concurrent checkout for the same limited stock product correctly', async () => {
    const db = (await import('../db/database.js')).getDatabase();

    // Restock to exactly 2 units
    await sql`
      UPDATE inventory SET quantity = 2, updated_at = now()
      WHERE product_id = ${limitedStockProductId}
    `.execute(db);
    await sql`DELETE FROM cart_items`.execute(db);

    // User 1: add 2 units of limited stock product
    await addToCart(userToken, limitedStockProductId, 2);

    // User 2: directly insert a cart item for the same product
    await sql`INSERT INTO cart_items (user_id, product_id, quantity) VALUES (
      (SELECT id FROM users WHERE email = 'checkout-user2@example.com'),
      ${limitedStockProductId},
      2
    )`.execute(db);

    // Attempt concurrent checkout
    const [res1, res2] = await Promise.all([
      supertest(app)
        .post('/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .timeout(5000),
      supertest(app)
        .post('/checkout')
        .set('Authorization', `Bearer ${user2Token}`)
        .timeout(5000),
    ]);

    // Exactly one should succeed
    const successCount = [res1, res2].filter((r) => r.status === 201).length;
    const failCount = [res1, res2].filter((r) => r.status === 409 || r.status === 400).length;
    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // Inventory should be 0 (2 - 2 = 0)
    const invResult = await sql<{ quantity: number }>`
      SELECT quantity FROM inventory WHERE product_id = ${limitedStockProductId}
    `.execute(db);
    expect(invResult.rows[0]!.quantity).toBe(0);

    // Clean up remaining cart items
    await sql`DELETE FROM cart_items`.execute(db);
  });
});

describe('Checkout does not affect other modules', () => {
  it('GET /products still works', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    expect((res.body as Record<string, unknown>)).toHaveProperty("products");
    expect(Array.isArray((res.body as { products: unknown[] }).products)).toBe(true);
  });

  it('GET /health still works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });
});