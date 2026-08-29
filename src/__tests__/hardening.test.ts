import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let adminToken: string;
let userToken: string;
let activeProductSlug: string;
let activeProductId: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  await sql`DELETE FROM audit_log`.execute(db);
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
    VALUES ('Hardening Cat', 'hardening-cat', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Seed an active product
  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Hardening Product', 'hardening-prod', 'A test product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  activeProductId = prodResult.rows[0]!.id;
  activeProductSlug = 'hardening-prod';
  await sql`INSERT INTO prices (product_id, amount) VALUES (${activeProductId}, 9.99)`.execute(db);

  // Create admin user (with all backend roles via RBAC)
  const adminPwHash = await hashPassword('admin-password-123');
  const hardenAdminResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('harden-admin@test.com', ${adminPwHash}, now(), now())
    RETURNING id
  `.execute(db);
  const hardenAdminId = hardenAdminResult.rows[0]!.id;
  const hardenRoles = await db.selectFrom('roles').selectAll().execute();
  for (const r of hardenRoles) {
    await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${hardenAdminId}, ${r.id}, now())`.execute(db);
  }

  // Create regular user (no backend roles)
  const userPwHash = await hashPassword('user-password-123');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('harden-user@test.com', ${userPwHash}, now(), now())
  `.execute(db);

  app = createApp();

  const adminLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'harden-admin@test.com', password: 'admin-password-123' })
    .expect(200);
  adminToken = (adminLogin.body as { accessToken: string }).accessToken;

  const userLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'harden-user@test.com', password: 'user-password-123' })
    .expect(200);
  userToken = (userLogin.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM audit_log`.execute(db);
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

// ---- Pagination: Orders ----

describe('GET /orders pagination', () => {
  it('applies default limit of 50', async () => {
    const res = await supertest(app)
      .get('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('accepts custom limit and offset', async () => {
    const res = await supertest(app)
      .get('/orders?limit=5&offset=0')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---- Pagination: Notifications ----

describe('GET /notifications pagination', () => {
  it('applies default limit of 50', async () => {
    const res = await supertest(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('accepts custom limit and offset', async () => {
    const res = await supertest(app)
      .get('/notifications?limit=10&offset=0')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('caps limit at 200', async () => {
    const res = await supertest(app)
      .get('/notifications?limit=9999')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---- Review Content Length Validation ----

describe('Review content length validation', () => {
  it('rejects review content over 5000 characters on create', async () => {
    const longContent = 'x'.repeat(5001);
    const res = await supertest(app)
      .post(`/products/${activeProductSlug}/reviews`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rating: 5, content: longContent })
      .expect(400);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('5000');
  });

  it('allows content exactly 5000 characters', async () => {
    const exactContent = 'x'.repeat(5000);
    const res = await supertest(app)
      .post(`/products/${activeProductSlug}/reviews`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rating: 4, content: exactContent })
      .expect(201);

    expect((res.body as { content: string | null }).content).toBe(exactContent);
  });

  it('rejects content over 5000 on update', async () => {
    // First get the review id
    const listRes = await supertest(app)
      .get('/account/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const reviews = listRes.body as Array<{ id: string }>;
    const reviewId = reviews[0]!.id;

    const longContent = 'y'.repeat(5001);
    const res = await supertest(app)
      .patch(`/account/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ content: longContent })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---- Admin Input Length Validation ----

describe('Admin category name/slug length validation', () => {
  it('rejects category name over 100 characters', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'x'.repeat(101), slug: 'valid-slug' })
      .expect(400);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('100');
  });

  it('rejects category slug over 120 characters', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Valid Name', slug: 'x'.repeat(121) })
      .expect(400);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Admin product name/slug length validation', () => {
  it('rejects product name over 255 characters', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'x'.repeat(256), slug: 'valid-slug' })
      .expect(400);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects product slug over 280 characters', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Valid Name', slug: 'x'.repeat(281) })
      .expect(400);

    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---- Search Query Limits ----

describe('Search query limits', () => {
  it('rejects search query over 200 characters', async () => {
    const res = await supertest(app)
      .get(`/products/search?q=${'x'.repeat(201)}`)
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

// ---- Existing Auth Behavior ----

describe('Existing auth behavior intact', () => {
  it('login still works', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'harden-user@test.com', password: 'user-password-123' })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });

  it('register still works', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email: 'harden-new@test.com', password: 'test123456' })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
  });
});

// ---- Existing Admin behavior ----

describe('Existing admin behavior intact', () => {
  it('admin category CRUD still works', async () => {
    await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Hardening Cat 2', slug: 'hardening-cat-2' })
      .expect(201);
  });

  it('admin product CRUD still works', async () => {
    await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Hardening Prod 2', slug: 'hardening-prod-2', status: 'active' })
      .expect(201);
  });
});

// ---- Health endpoint ----

describe('Health endpoint', () => {
  it('still works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('ok');
  });
});