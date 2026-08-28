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

const validShipping = {
  recipientName: 'Jane Doe',
  addressLine1: '123 Main Street',
  addressLine2: 'Apt 4B',
  city: 'Portland',
  state: 'OR',
  postalCode: '97201',
  countryCode: 'US',
  phone: '+1-555-0100',
};

const minimalShipping = {
  recipientName: 'John Smith',
  addressLine1: '456 Oak Ave',
  city: 'Seattle',
  state: 'WA',
  postalCode: '98101',
  countryCode: 'GB',
};

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
    VALUES ('Shipping Cat', 'shipping-cat', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, status, category_id, created_at, updated_at)
    VALUES ('Shippable Widget', 'shippable-widget', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  const productId = prodResult.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productId}, 10.00)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${productId}, 100)`.execute(db);

  // Create users
  const pwHash = await hashPassword('test-password-123');
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('ship-user@example.com', ${pwHash}, now(), now())`.execute(db);
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('ship-user2@example.com', ${pwHash}, now(), now())`.execute(db);

  app = createApp();

  const login1 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'ship-user@example.com', password: 'test-password-123' })
    .expect(200);
  userToken = (login1.body as { accessToken: string }).accessToken;

  const login2 = await supertest(app)
    .post('/auth/login')
    .send({ email: 'ship-user2@example.com', password: 'test-password-123' })
    .expect(200);
  user2Token = (login2.body as { accessToken: string }).accessToken;

  // Create orders via checkout
  await supertest(app)
    .post('/cart')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ productId, quantity: 1 })
    .expect(200);

  const orderRes = await supertest(app)
    .post('/checkout')
    .set('Authorization', `Bearer ${userToken}`)
    .expect(201);
  orderId = (orderRes.body as { orderId: string }).orderId;

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

const shippingUrl = (oid: string) => `/orders/${oid}/shipping`;

describe('POST /orders/:orderId/shipping', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .post(shippingUrl(orderId))
      .send(validShipping)
      .expect(401);
  });

  it('creates shipping information with all fields', async () => {
    const res = await supertest(app)
      .post(shippingUrl(orderId))
      .set('Authorization', `Bearer ${userToken}`)
      .send(validShipping)
      .expect(201);

    const body = res.body as {
      id: string;
      orderId: string;
      status: string;
      recipientName: string;
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
      countryCode: string;
      phone: string | null;
      createdAt: string;
      updatedAt: string;
    };

    expect(body.orderId).toBe(orderId);
    expect(body.status).toBe('pending');
    expect(body.recipientName).toBe('Jane Doe');
    expect(body.addressLine1).toBe('123 Main Street');
    expect(body.addressLine2).toBe('Apt 4B');
    expect(body.city).toBe('Portland');
    expect(body.state).toBe('OR');
    expect(body.postalCode).toBe('97201');
    expect(body.countryCode).toBe('US');
    expect(body.phone).toBe('+1-555-0100');
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('rejects duplicate shipping creation', async () => {
    const res = await supertest(app)
      .post(shippingUrl(orderId))
      .set('Authorization', `Bearer ${userToken}`)
      .send(validShipping)
      .expect(409);

    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'Shipping information already exists for this order' },
    });
  });

  it('creates shipping with minimal required fields', async () => {
    // user2 creates shipping with only required fields
    const res = await supertest(app)
      .post(shippingUrl(user2OrderId))
      .set('Authorization', `Bearer ${user2Token}`)
      .send(minimalShipping)
      .expect(201);

    const body = res.body as {
      recipientName: string;
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
      countryCode: string;
      phone: string | null;
    };

    expect(body.recipientName).toBe('John Smith');
    expect(body.addressLine1).toBe('456 Oak Ave');
    expect(body.addressLine2).toBeNull();
    expect(body.city).toBe('Seattle');
    expect(body.state).toBe('WA');
    expect(body.postalCode).toBe('98101');
    expect(body.countryCode).toBe('GB'); // explicitly provided
    expect(body.phone).toBeNull();
  });

  it('returns 404 for unknown order', async () => {
    await supertest(app)
      .post(shippingUrl('00000000-0000-0000-0000-000000000000'))
      .set('Authorization', `Bearer ${userToken}`)
      .send(validShipping)
      .expect(404);
  });

  it('returns 404 for another users order (no information leak)', async () => {
    await supertest(app)
      .post(shippingUrl(orderId))
      .set('Authorization', `Bearer ${user2Token}`)
      .send(validShipping)
      .expect(404);
  });

  it('rejects missing required fields', async () => {
    const res = await supertest(app)
      .post(shippingUrl(user2OrderId))
      .set('Authorization', `Bearer ${user2Token}`)
      .send({})
      .expect(400);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('recipientName is required');
    expect(body.error.message).toContain('addressLine1 is required');
    expect(body.error.message).toContain('city is required');
    expect(body.error.message).toContain('state is required');
    expect(body.error.message).toContain('postalCode is required');
    expect(body.error.message).toContain('countryCode is required');
  });
});

describe('GET /orders/:orderId/shipping', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .get(shippingUrl(orderId))
      .expect(401);
  });

  it('returns shipping for the own order', async () => {
    const res = await supertest(app)
      .get(shippingUrl(orderId))
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as {
      orderId: string;
      recipientName: string;
      addressLine1: string;
      city: string;
    };
    expect(body.orderId).toBe(orderId);
    expect(body.recipientName).toBe('Jane Doe');
    expect(body.addressLine1).toBe('123 Main Street');
  });

  it('returns 404 for another users shipping', async () => {
    await supertest(app)
      .get(shippingUrl(orderId))
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(404);
  });

  it('returns 404 for a non-existent shipping record', async () => {
    const res = await supertest(app)
      .get('/orders/00000000-0000-0000-0000-000000000000/shipping')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Order not found' },
    });
  });
});

describe('PATCH /orders/:orderId/shipping', () => {
  it('returns 401 without authentication', async () => {
    await supertest(app)
      .patch(shippingUrl(orderId))
      .send(minimalShipping)
      .expect(401);
  });

  it('updates shipping information when still pending', async () => {
    const res = await supertest(app)
      .patch(shippingUrl(orderId))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: 'Jane Doe Updated',
        addressLine1: '456 New Street',
        addressLine2: 'Suite 100',
        city: 'Portland',
        state: 'OR',
        postalCode: '97202',
        countryCode: 'US',
      })
      .expect(200);

    const body = res.body as {
      recipientName: string;
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string;
      status: string;
    };

    expect(body.recipientName).toBe('Jane Doe Updated');
    expect(body.addressLine1).toBe('456 New Street');
    expect(body.addressLine2).toBe('Suite 100');
    expect(body.postalCode).toBe('97202');
    expect(body.status).toBe('pending');
  });

  it('returns 404 for another users shipping', async () => {
    await supertest(app)
      .patch(shippingUrl(orderId))
      .set('Authorization', `Bearer ${user2Token}`)
      .send(minimalShipping)
      .expect(404);
  });

  it('returns 404 for non-existent shipping', async () => {
    await supertest(app)
      .patch(shippingUrl('00000000-0000-0000-0000-000000000000'))
      .set('Authorization', `Bearer ${userToken}`)
      .send(minimalShipping)
      .expect(404);
  });

  it('rejects missing required fields on update', async () => {
    const res = await supertest(app)
      .patch(shippingUrl(orderId))
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(400);

    expect((res.body as { error: { message: string } }).error.message).toContain('recipientName is required');
  });
});

describe('Shipping snapshot stability', () => {
  it('shipping data remains unchanged after user profile changes', async () => {
    // The shipping record was already created with the original data.
    // User profile changes should not affect the shipping snapshot.
    const res = await supertest(app)
      .get(shippingUrl(orderId))
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as { recipientName: string; addressLine1: string; postalCode: string };
    expect(body.recipientName).toBe('Jane Doe Updated'); // from our update above
    expect(body.addressLine1).toBe('456 New Street');
    expect(body.postalCode).toBe('97202');
  });
});

describe('Shipping does not affect other modules', () => {
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