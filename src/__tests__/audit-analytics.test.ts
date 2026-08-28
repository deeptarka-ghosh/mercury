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
let categoryId: string;
let productId: string;
let productSlug: string;

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
    INSERT INTO categories (name, slug, description, created_at, updated_at)
    VALUES ('Test Category', 'test-category', 'A test category', now(), now())
    RETURNING id
  `.execute(db);
  categoryId = catResult.rows[0]!.id;

  // Seed an active product
  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Test Product', 'test-product', 'A test product', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  productId = prodResult.rows[0]!.id;
  productSlug = 'test-product';
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productId}, 19.99)`.execute(db);

  // Draft product
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Item', 'draft-item', 'A draft product', 'draft', ${categoryId}, now(), now())
  `.execute(db);

  // Create admin user first (needed for order FK)
  const adminPwHash = await hashPassword('admin-password-123');
  const adminUserResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, role, created_at, updated_at)
    VALUES ('admin@test.com', ${adminPwHash}, 'admin', now(), now())
    RETURNING id
  `.execute(db);
  const adminUserId = adminUserResult.rows[0]!.id;

  // Create regular user
  const userPwHash = await hashPassword('user-password-123');
  await sql`
    INSERT INTO users (email, password_hash, role, created_at, updated_at)
    VALUES ('user@test.com', ${userPwHash}, 'user', now(), now())
  `.execute(db);

  // Seed an order with a completed payment for revenue analytics
  const orderResult = await sql<{ id: string }>`
    INSERT INTO orders (user_id, status, total, created_at, updated_at)
    VALUES (${adminUserId}, 'confirmed', 59.97, now(), now())
    RETURNING id
  `.execute(db);
  const orderId = orderResult.rows[0]!.id;

  // Seed order items
  await sql`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total, created_at)
    VALUES (${orderId}, ${productId}, 'Test Product', 3, 19.99, 59.97, now())
  `.execute(db);

  // Seed a completed payment
  await sql`
    INSERT INTO payments (order_id, amount, currency, status, created_at, updated_at)
    VALUES (${orderId}, 59.97, 'USD', 'completed', now(), now())
  `.execute(db);

  // Seed a pending payment for another order
  const order2Result = await sql<{ id: string }>`
    INSERT INTO orders (user_id, status, total, created_at, updated_at)
    VALUES (${adminUserId}, 'pending', 29.99, now(), now())
    RETURNING id
  `.execute(db);
  const order2Id = order2Result.rows[0]!.id;
  await sql`
    INSERT INTO payments (order_id, amount, currency, status, created_at, updated_at)
    VALUES (${order2Id}, 29.99, 'USD', 'pending', now(), now())
  `.execute(db);

  app = createApp();

  const adminLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'admin@test.com', password: 'admin-password-123' })
    .expect(200);
  adminToken = (adminLogin.body as { accessToken: string }).accessToken;

  const userLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'user@test.com', password: 'user-password-123' })
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

// ---- Audit Auth ----

describe('Audit log access (audit-1, audit-2, audit-3)', () => {
  it('rejects unauthenticated audit access', async () => {
    const res = await supertest(app)
      .get('/admin/audit')
      .expect(401);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects ordinary user audit access', async () => {
    const res = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('allows admin audit access', async () => {
    const res = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { entries: unknown[]; total: number };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe('number');
  });
});

// ---- Analytics Auth ----

describe('Analytics access (analytics-1, analytics-2, analytics-3)', () => {
  it('rejects unauthenticated analytics access', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .expect(401);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects ordinary user analytics access', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('allows admin analytics access', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { orders: unknown[]; payments: unknown[]; users: { total: number } };
    expect(Array.isArray(body.orders)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(body.users).toHaveProperty('total');
  });
});

// ---- Audit Recording ----

describe('Audit recording (audit-4 to audit-8)', () => {
  it('audits category creation (audit-4)', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Audited Cat', slug: 'audited-cat' })
      .expect(201);

    const createdId = (res.body as { id: string }).id;

    const auditRes = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ action: string; resourceId: string; metadata: Record<string, unknown> | null }> };
    const auditEntry = auditBody.entries.find((e) => e.resourceId === createdId);
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.action).toBe('category.create');
  });

  it('audits category update (audit-5)', async () => {
    await supertest(app)
      .patch(`/admin/categories/${categoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Category Name' })
      .expect(200);

    const auditRes = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ action: string; resourceId: string; metadata: { changes: Record<string, unknown> } }> };
    const auditEntry = auditBody.entries.find((e) => e.resourceId === categoryId && e.action === 'category.update');
    expect(auditEntry).toBeDefined();
  });

  it('audits product creation (audit-4)', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Audited Product', slug: 'audited-prod' })
      .expect(201);

    const createdId = (res.body as { id: string }).id;

    const auditRes = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ action: string; resourceId: string }> };
    const auditEntry = auditBody.entries.find((e) => e.resourceId === createdId);
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.action).toBe('product.create');
  });

  it('audits product status change (audit-4)', async () => {
    await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'archived' })
      .expect(200);

    // Restore
    await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' })
      .expect(200);

    const auditRes = await supertest(app)
      .get('/admin/audit?action=product.status_change')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ action: string; metadata: { newStatus: string } }> };
    expect(auditBody.entries.length).toBeGreaterThanOrEqual(2);
    expect(auditBody.entries.some((e) => e.metadata.newStatus === 'archived')).toBe(true);
  });

  it('audits inventory change (audit-4)', async () => {
    await supertest(app)
      .put(`/admin/products/${productSlug}/inventory`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantity: 100 })
      .expect(200);

    const auditRes = await supertest(app)
      .get('/admin/audit?action=inventory.set')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ metadata: { newQuantity: number } }> };
    expect(auditBody.entries.length).toBeGreaterThanOrEqual(1);
    expect(auditBody.entries[0]!.metadata.newQuantity).toBe(100);
  });

  it('audits price change (audit-4)', async () => {
    await supertest(app)
      .put(`/admin/products/${productSlug}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 39.99 })
      .expect(200);

    const auditRes = await supertest(app)
      .get('/admin/audit?action=price.set')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ metadata: { newAmount: string } }> };
    expect(auditBody.entries.length).toBeGreaterThanOrEqual(1);
    expect(auditBody.entries[0]!.metadata.newAmount).toBe('39.99');
  });

  it('audit records show actor identity (audit-5)', async () => {
    const auditRes = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { 
      entries: Array<{ 
        actorId: string | null; 
        actorEmail: string | null;
        action: string;
      }>;
    };

    const hasActor = auditBody.entries.some((e) => e.actorId && e.actorEmail);
    expect(hasActor).toBe(true);
  });

  it('audit log does not contain secrets (audit-6)', async () => {
    const auditRes = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditBody = auditRes.body as { entries: Array<{ metadata: unknown }> };

    for (const entry of auditBody.entries) {
      const metaString = JSON.stringify(entry.metadata).toLowerCase();
      expect(metaString).not.toContain('password');
      expect(metaString).not.toContain('token');
      expect(metaString).not.toContain('secret');
    }
  });

  it('audit pagination works', async () => {
    const resPage1 = await supertest(app)
      .get('/admin/audit?limit=3&offset=0')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body1 = resPage1.body as { entries: unknown[]; total: number; limit: number; offset: number };
    expect(body1.limit).toBe(3);
    expect(body1.offset).toBe(0);
    expect(body1.entries.length).toBeLessThanOrEqual(3);

    const resPage2 = await supertest(app)
      .get(`/admin/audit?limit=3&offset=3`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body2 = resPage2.body as { entries: unknown[] };
    // Page 2 should exist if we have more than 3 entries
    expect(body2.entries).toBeDefined();
  });

  it('audit filter by action works', async () => {
    const res = await supertest(app)
      .get('/admin/audit?action=category.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { entries: Array<{ action: string }>; total: number };
    expect(body.entries.every((e) => e.action === 'category.create')).toBe(true);
  });
});

// ---- Analytics Summary ----

describe('Summary analytics (analytics-4, analytics-5)', () => {
  it('returns order statistics', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { orders: Array<{ status: string; count: number }> };
    const pendingOrders = body.orders.find((o) => o.status === 'pending');
    const confirmedOrders = body.orders.find((o) => o.status === 'confirmed');
    expect(pendingOrders).toBeDefined();
    expect(confirmedOrders).toBeDefined();
    expect(pendingOrders!.count).toBe(1);
    expect(confirmedOrders!.count).toBe(1);
  });

  it('returns payment breakdown', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { payments: Array<{ status: string; count: number; total: string | null }> };
    const completedPayment = body.payments.find((p) => p.status === 'completed');
    const pendingPayment = body.payments.find((p) => p.status === 'pending');
    expect(completedPayment).toBeDefined();
    expect(pendingPayment).toBeDefined();
    expect(completedPayment!.count).toBe(1);
    expect(completedPayment!.total).toBe('59.97');
  });

  it('returns user counts', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { users: { total: number; admins: number } };
    expect(body.users.total).toBeGreaterThanOrEqual(2);
    expect(body.users.admins).toBeGreaterThanOrEqual(1);
  });

  it('returns product counts by status', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { products: Array<{ status: string; count: number }> };
    const active = body.products.find((p) => p.status === 'active');
    const draft = body.products.find((p) => p.status === 'draft');
    expect(active).toBeDefined();
    expect(draft).toBeDefined();
    expect(active!.count).toBeGreaterThanOrEqual(1);
    expect(draft!.count).toBeGreaterThanOrEqual(1);
  });

  it('returns revenue data (analytics-5)', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { 
      revenue: { 
        completedRevenue: string | null;
        totalPayments: string | null;
      };
      reviews: { total: number; averageRating: string | null };
    };

    // Completed revenue should be 59.97
    expect(body.revenue.completedRevenue).toBe('59.97');
    // Total payments (all statuses) should be 59.97 + 29.99
    expect(body.revenue.totalPayments).toBe('89.96');
    // Reviews should exist with zero count
    expect(body.reviews.total).toBe(0);
  });
});

// ---- Analytics Orders ----

describe('Order analytics (analytics-5)', () => {
  it('lists orders with pagination', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/orders?limit=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { 
      orders: Array<{ id: string; status: string; total: string | null }>;
      totals: Array<{ status: string; count: number; totalAmount: string | null }>;
      total: number;
    };

    expect(body.orders.length).toBe(2);
    expect(body.totals.length).toBeGreaterThanOrEqual(2);
    expect(body.total).toBe(2);
  });

  it('filters orders by status', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/orders?status=confirmed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { 
      orders: Array<{ id: string; status: string }>;
      total: number;
    };

    expect(body.orders.length).toBe(1);
    expect(body.orders[0]!.status).toBe('confirmed');
    expect(body.total).toBe(1);
  });
});

// ---- Analytics Revenue ----

describe('Revenue analytics (analytics-5)', () => {
  it('returns completed revenue and breakdown', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/revenue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as {
      completedRevenue: string | null;
      completedPaymentCount: number;
      breakdown: Array<{ status: string; count: number; total: string | null }>;
      byCurrency: Array<{ currency: string; completed: string | null; total: string | null }>;
    };

    expect(body.completedRevenue).toBe('59.97');
    expect(body.completedPaymentCount).toBe(1);
    expect(body.breakdown.length).toBeGreaterThanOrEqual(2);
    expect(body.byCurrency.length).toBeGreaterThanOrEqual(1);
    expect(body.byCurrency[0]!.currency).toBe('USD');
    expect(body.byCurrency[0]!.completed).toBe('59.97');
  });
});

// ---- Analytics Products ----

describe('Product sales analytics (analytics-5)', () => {
  it('returns top-selling products', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as {
      products: Array<{ productId: string; name: string; slug: string; totalSold: number; totalRevenue: string | null }>;
      total: number;
    };

    expect(body.products.length).toBe(1);
    expect(body.products[0]!.totalSold).toBe(3);
    expect(body.products[0]!.totalRevenue).toBe('59.97');
    expect(body.total).toBe(1);
  });
});

// ---- Existing functionality intact ----

describe('Existing admin functionality intact', () => {
  it('admin can still manage categories', async () => {
    const res = await supertest(app)
      .get('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Array<unknown>;
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('admin can still manage products', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Array<unknown>;
    expect(body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Existing user auth intact', () => {
  it('regular user can access own profile', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as { email: string };
    expect(body.email).toBe('user@test.com');
  });

  it('health works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('ok');
  });
});