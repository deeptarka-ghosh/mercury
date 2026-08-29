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
let orderId: string;
let user2OrderId: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
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
    VALUES ('Payments Category', 'payments-category', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Product
  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, status, category_id, created_at, updated_at)
    VALUES ('Payable Widget', 'payable-widget', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  const productId = prodResult.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productId}, 25.00)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${productId}, 100)`.execute(db);
  await sql`
    INSERT INTO product_variants (product_id, sku, size, colour_name, status, selling_price, mrp, quantity, created_at, updated_at)
    VALUES (${productId}, 'payments-var', 'Default', 'Default', 'active', 25.00, 25.00, 100, now(), now())
  `.execute(db);

  // Create users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES ('pay-user@example.com', ${pwHash}, '+15551111111', now(), now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES ('pay-user2@example.com', ${pwHash}, '+15552222222', now(), now(), now())`.execute(db);

  app = createApp();

  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'pay-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'pay-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;

  // Create orders via checkout
  // User 1 order: 2 * 25.00 = 50.00
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ productId, quantity: 2 })
    .expect(200);

  const orderRes = await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${userToken}`)
    .expect(201);
  orderId = (orderRes.body as { orderId: string }).orderId;

  // User 2 order: 1 * 25.00 = 25.00
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${user2Token}`)
    .send({ productId, quantity: 1 })
    .expect(200);

  const order2Res = await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${user2Token}`)
    .expect(201);
  user2OrderId = (order2Res.body as { orderId: string }).orderId;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
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

describe('POST /orders/:orderId/payments', () => {
  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .post(`/orders/${orderId}/payments`)
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('creates a payment with amount from the persisted order total', async () => {
    const res = await supertest(app)
      .post(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(201);

    const body = res.body as {
      id: string;
      orderId: string;
      amount: string;
      currency: string;
      status: string;
      provider: string | null;
      providerRef: string | null;
      createdAt: string;
    };

    expect(body.orderId).toBe(orderId);
    expect(body.amount).toBe('50.00'); // 2 * 25.00
    expect(body.currency).toBe('USD');
    expect(body.status).toBe('pending');
    expect(body.provider).toBeNull();
    expect(body.providerRef).toBeNull();
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('rejects duplicate payment creation (idempotency)', async () => {
    const res = await supertest(app)
      .post(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(409);

    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'A payment already exists for this order' },
    });
  });

  it('returns 404 for unknown order ID', async () => {
    const res = await supertest(app)
      .post('/orders/00000000-0000-0000-0000-000000000000/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Order not found' },
    });
  });

  it('returns 404 for another users order (no information leak)', async () => {
    const res = await supertest(app)
      .post(`/orders/${user2OrderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Order not found' },
    });
  });
});

describe('GET /orders/:orderId/payments', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .get(`/orders/${orderId}/payments`)
      .expect(401);
  });

  it('returns the payment record for the authenticated users order', async () => {
    const res = await supertest(app)
      .get(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as {
      id: string;
      orderId: string;
      amount: string;
      currency: string;
      status: string;
    };

    expect(body.orderId).toBe(orderId);
    expect(body.amount).toBe('50.00');
    expect(body.currency).toBe('USD');
    expect(body.status).toBe('pending');
  });

  it('returns 404 for another users payment', async () => {
    await supertest(app)
      .get(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(404);
  });

  it('returns 404 for an order with no payment', async () => {
    const res = await supertest(app)
      .get(`/orders/${user2OrderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Payment not found' },
    });
  });
});

describe('PATCH /orders/:orderId/payments', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .patch(`/orders/${orderId}/payments`)
      .send({ status: 'completed' })
      .expect(401);
  });

  it('transitions payment from pending to completed', async () => {
    const res = await supertest(app)
      .patch(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ status: 'completed' })
      .expect(200);

    const body = res.body as { status: string; amount: string };
    expect(body.status).toBe('completed');
    expect(body.amount).toBe('50.00');
  });

  it('rejects invalid transition from completed to failed', async () => {
    const res = await supertest(app)
      .patch(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ status: 'failed' })
      .expect(400);

    const body = res.body as { error: { message: string } };
    expect(body.error.message).toMatch(
      /Cannot transition payment from "completed" to "failed"/,
    );
  });

  it('rejects unknown status value', async () => {
    const res = await supertest(app)
      .patch(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ status: 'refunded' })
      .expect(400);

    const body = res.body as { error: { message: string } };
    expect(body.error.message).toMatch(
      /Invalid payment status "refunded"/,
    );
  });

  it('returns 404 for another users payment', async () => {
    await supertest(app)
      .patch(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ status: 'completed' })
      .expect(404);
  });

  it('returns 404 for an order with no payment', async () => {
    const res = await supertest(app)
      .patch(`/orders/${user2OrderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ status: 'completed' })
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Payment not found' },
    });
  });

  it('transitions a new payment from pending to failed', async () => {
    // Create payment for user2's order
    const createRes = await supertest(app)
      .post(`/orders/${user2OrderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(201);

    expect((createRes.body as { status: string }).status).toBe('pending');

    // Transition to failed
    const patchRes = await supertest(app)
      .patch(`/orders/${user2OrderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ status: 'failed' })
      .expect(200);

    expect((patchRes.body as { status: string }).status).toBe('failed');

    // Verify via GET
    const getRes = await supertest(app)
      .get(`/orders/${user2OrderId}/payments`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect((getRes.body as { status: string }).status).toBe('failed');
  });
});

describe('Payment amount is authoritative (not client-controlled)', () => {
  it('uses the persisted order total, not a request body amount', async () => {
    // The POST endpoint doesn't accept an amount in the body
    // It reads from the order total

    // Verify the order total from the order endpoint
    const orderRes = await supertest(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect((orderRes.body as { total: string }).total).toBe('50.00');
  });
});

describe('Payments does not affect other modules', () => {
  it('GET /health still works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('existing orders endpoint still works', async () => {
    const res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});