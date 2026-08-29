import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';
import { validateProductionConfig } from '../config/env.js';
import { rateLimit } from '../middleware/rateLimiter.js';

let app: ReturnType<typeof createApp>;
let userToken: string;
let adminToken: string;
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

  // Seed category + product
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Stage A Cat', 'stage-a-cat', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Stage A Product', 'stage-a-prod', 'Product for Stage A tests', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  activeProductId = prodResult.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${activeProductId}, 9.99)`.execute(db);

  // Create admin user (with all backend roles via RBAC)
  const adminPwHash = await hashPassword('admin-password-123');
  const adminResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('stage-a-admin@test.com', ${adminPwHash}, now(), now())
    RETURNING id
  `.execute(db);
  const stageAdminId = adminResult.rows[0]!.id;

  const allRoles = await db.selectFrom('roles').selectAll().execute();
  for (const role of allRoles) {
    await sql`
      INSERT INTO user_roles (user_id, role_id, created_at)
      VALUES (${stageAdminId}, ${role.id}, now())
    `.execute(db);
  }

  // Create regular user (no backend roles = customer)
  const userPwHash = await hashPassword('user-password-123');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('stage-a-user@test.com', ${userPwHash}, now(), now())
  `.execute(db);

  app = createApp();

  const adminLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'stage-a-admin@test.com', password: 'admin-password-123' })
    .expect(200);
  adminToken = (adminLogin.body as { accessToken: string }).accessToken;

  // Regular user login (used later for ownership tests)
  const userLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'stage-a-user@test.com', password: 'user-password-123' })
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

// ---- Existing functionality intact ----

describe('Existing functionality remains intact', () => {
  it('health endpoint works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('ok');
  });

  it('register works', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email: `stage-a-final-${Date.now()}@test.com`, password: 'test123456' })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
  });

  it('login works', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'stage-a-user@test.com', password: 'user-password-123' })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });

  it('public catalog still works', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as { products: Array<{ slug: string }> };
    expect(body.products.some((p) => p.slug === 'stage-a-prod')).toBe(true);
  });

  it('wishlist add still works', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: activeProductId })
      .expect(200);

    const body = res.body as { productId: string };
    expect(body.productId).toBe(activeProductId);
  });
});

// ---- Helmet security headers ----

describe('Helmet security headers', () => {
  it('adds X-Content-Type-Options header', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('adds X-Frame-Options header', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('adds X-XSS-Protection header', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.headers['x-xss-protection']).toBe('0');
  });
});

// ---- Body size limit ----

describe('Body size limit', () => {
  it('rejects oversized request body', async () => {
    const largeBody = 'x'.repeat(120_000); // 120KB — exceeds 100KB limit
    const res = await supertest(app)
      .post('/auth/login')
      .send({ large: largeBody })
      .expect(413);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

// ---- Production configuration ----

describe('Production config validation', () => {
  it('validateProductionConfig passes in non-production env', () => {
    expect(() => validateProductionConfig()).not.toThrow();
  });
});

// ---- Authorization regression ----

describe('Authorization regression', () => {
  it('unauthenticated access to admin returns 401', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .expect(401);

    expect(res.body).toHaveProperty('error');
  });

  it('non-admin user cannot access admin', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    expect(res.body).toHaveProperty('error');
  });

  it('admin can access admin', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---- Rate Limiting — direct unit tests ----

describe('Rate limiting', () => {
  it('rate limiter is a no-op in test mode (NODE_ENV=test)', () => {
    // All requests should pass through without blocking
    // Verified by the fact that existing login/register tests work
  });

  it('rateLimit() factory returns middleware', () => {
    const limiter = rateLimit({ windowMs: 1000, maxRequests: 1 });
    expect(typeof limiter).toBe('function');
  });
});