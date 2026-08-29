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
let orderId2: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM cart_items`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM inventory`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  // Seed category + product
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Notify Cat', 'notify-cat', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, status, category_id, created_at, updated_at)
    VALUES ('Notifiable Widget', 'notifiable-widget', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  const productId = prodResult.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productId}, 15.00)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${productId}, 100)`.execute(db);

  await sql`
    INSERT INTO product_variants (product_id, sku, size, colour_name, status, selling_price, mrp, quantity, created_at, updated_at)
    VALUES (${productId}, 'notify-var', 'Default', 'Default', 'active', 15.00, 15.00, 100, now(), now())
  `.execute(db);

  // Create users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES ('notify-user@example.com', ${pwHash}, '+15551111111', now(), now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES ('notify-user2@example.com', ${pwHash}, '+15552222222', now(), now(), now())`.execute(db);

  app = createApp();

  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'notify-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'notify-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;

  // Create an order via checkout (triggers 'order_created' notification)
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

  // Create payment for the order (triggers 'payment_completed' notification)
  await supertest(app)
    .post(`/orders/${orderId}/payments`)
    .set('Authorization', `Bearer ${userToken}`)
    .expect(201);

  await supertest(app)
    .patch(`/orders/${orderId}/payments`)
    .set('Authorization', `Bearer ${userToken}`)
    .send({ status: 'completed' })
    .expect(200);

  // User 2: create an order and fail the payment
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${user2Token}`)
    .send({ productId, quantity: 1 })
    .expect(200);

  const order2Res = await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${user2Token}`)
    .expect(201);
  orderId2 = (order2Res.body as { orderId: string }).orderId;

  await supertest(app)
    .post(`/orders/${orderId2}/payments`)
    .set('Authorization', `Bearer ${user2Token}`)
    .expect(201);

  await supertest(app)
    .patch(`/orders/${orderId2}/payments`)
    .set('Authorization', `Bearer ${user2Token}`)
    .send({ status: 'failed' })
    .expect(200);
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
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

describe('GET /notifications', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .get('/notifications')
      .expect(401);
  });

  it('returns notifications for the authenticated user, most recent first', async () => {
    const res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      isRead: boolean;
      readAt: string | null;
      createdAt: string;
    }>;

    // User 1: order_created + payment_completed = 2 notifications
    expect(body.length).toBe(2);

    // Most recent first — payment completed
    expect(body[0]!.type).toBe('payment_completed');
    expect(body[0]!.title).toBe('Payment Completed');
    expect(body[0]!.message).toContain('30.00');
    expect(body[0]!.isRead).toBe(false);
    expect(body[0]!.readAt).toBeNull();

    // Second — order created
    expect(body[1]!.type).toBe('order_created');
    expect(body[1]!.title).toBe('Order Created');
    expect(body[1]!.message).toContain('30.00');
  });

  it('does not include another users notifications', async () => {
    const user1Res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const user2Res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const user1Ids = (user1Res.body as Array<{ id: string }>).map((n) => n.id);
    const user2Ids = (user2Res.body as Array<{ id: string }>).map((n) => n.id);

    // User 2 has order_created + payment_failed = 2
    expect(user2Ids.length).toBe(2);
    const user2Body = user2Res.body as Array<{ type: string }>;
    expect(user2Body[0]!.type).toBe('payment_failed');
    expect(user2Body[1]!.type).toBe('order_created');

    // No overlap
    for (const id of user1Ids) {
      expect(user2Ids.includes(id)).toBe(false);
    }
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .patch('/notifications/some-id/read')
      .expect(401);
  });

  it('marks a notification as read', async () => {
    const listRes = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const notifId = (listRes.body as Array<{ id: string; isRead: boolean }>)[0]!.id;

    const res = await supertest(app)
      .patch(`/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as { isRead: boolean; readAt: string | null };
    expect(body.isRead).toBe(true);
    expect(body.readAt).toBeTruthy();

    // Verify via GET
    const getRes = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const updated = (getRes.body as Array<{ id: string; isRead: boolean }>).find(
      (n) => n.id === notifId,
    )!;
    expect(updated.isRead).toBe(true);
  });

  it('is idempotent — marking already read returns 200', async () => {
    const listRes = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const notifId = (listRes.body as Array<{ id: string; isRead: boolean }>)[0]!.id;

    const res = await supertest(app)
      .patch(`/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect((res.body as { isRead: boolean }).isRead).toBe(true);
  });

  it('returns 404 for another users notification', async () => {
    const listRes = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const notifId = (listRes.body as Array<{ id: string }>)[0]!.id;

    await supertest(app)
      .patch(`/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(404);
  });

  it('returns 404 for unknown notification', async () => {
    await supertest(app)
      .patch('/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);
  });
});

describe('Notifications created atomically by checkout and payments', () => {
  it('checkout creates an order_created notification', async () => {
    // Already verified above — verify the specific content
    const res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const orderCreated = (res.body as Array<{ type: string; message: string }>).find(
      (n) => n.type === 'order_created',
    );
    expect(orderCreated).toBeDefined();
    expect(orderCreated!.message).toContain('30.00');
  });

  it('payment completed creates a payment_completed notification', async () => {
    const res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const paymentCompleted = (res.body as Array<{ type: string; title: string; message: string }>).find(
      (n) => n.type === 'payment_completed',
    );
    expect(paymentCompleted).toBeDefined();
    expect(paymentCompleted!.title).toBe('Payment Completed');
    expect(paymentCompleted!.message).toContain('30.00');
  });

  it('payment failed creates a payment_failed notification', async () => {
    const res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    const paymentFailed = (res.body as Array<{ type: string; title: string; message: string }>).find(
      (n) => n.type === 'payment_failed',
    );
    expect(paymentFailed).toBeDefined();
    expect(paymentFailed!.title).toBe('Payment Failed');
    expect(paymentFailed!.message).toContain('15.00');
  });
});

describe('Notifications does not affect other modules', () => {
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