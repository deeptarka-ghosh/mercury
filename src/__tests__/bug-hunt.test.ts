import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase, getDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let userToken: string;
let adminToken: string;
let productId: string;

interface PaginatedResult {
  products: Array<{ slug: string; price: string | null }>;
  total: number;
  limit: number;
  offset: number;
}

interface ErrorBody {
  error: { code: string; message: string };
}

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);
  const db = getDatabase();

  await sql`DELETE FROM media_items`.execute(db);
  await sql`DELETE FROM product_media_sorts`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db);
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
  await sql`DELETE FROM product_variants`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Test Cat', 'test-cat', now(), now()) RETURNING id
  `.execute(db);
  const catId = catResult.rows[0]!.id;

  const p1 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Alpha Product', 'alpha', 'First product A', 'active', ${catId}, now(), now()) RETURNING id
  `.execute(db);
  productId = p1.rows[0]!.id;
  await sql`INSERT INTO prices (product_id, amount) VALUES (${p1.rows[0]!.id}, 10.00)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${p1.rows[0]!.id}, 5)`.execute(db);

  await sql`
    INSERT INTO product_variants (product_id, sku, size, colour_name, status, selling_price, mrp, quantity, created_at, updated_at)
    VALUES (${p1.rows[0]!.id}, 'alpha-var', 'Default', 'Default', 'active', 10.00, 10.00, 5, now(), now())
  `.execute(db);

  const p2 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Beta Product', 'beta', 'Second product B', 'active', ${catId}, now(), now()) RETURNING id
  `.execute(db);
  await sql`INSERT INTO prices (product_id, amount) VALUES (${p2.rows[0]!.id}, 20.00)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${p2.rows[0]!.id}, 0)`.execute(db);

  await sql`
    INSERT INTO product_variants (product_id, sku, size, colour_name, status, selling_price, mrp, quantity, created_at, updated_at)
    VALUES (${p2.rows[0]!.id}, 'beta-var', 'Default', 'Default', 'active', 20.00, 20.00, 0, now(), now())
  `.execute(db);

  const p3 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Gamma Product', 'gamma', 'Third product G', 'active', ${catId}, now(), now()) RETURNING id
  `.execute(db);
  await sql`INSERT INTO prices (product_id, amount) VALUES (${p3.rows[0]!.id}, 30.00)`.execute(db);

  await sql`INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at) VALUES ('Draft Product', 'draft-prod', 'Not active', 'draft', NULL, now(), now())`.execute(db);
  await sql`INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at) VALUES ('Archived Product', 'archived-prod', 'Old', 'archived', NULL, now(), now())`.execute(db);

  const adminPwHash = await hashPassword('admin-pw');
  const adminResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('bug-admin@test.com', ${adminPwHash}, now(), now()) RETURNING id
  `.execute(db);
  const adminId = adminResult.rows[0]!.id;
  const allRoles = await db.selectFrom('roles').selectAll().execute();
  for (const r of allRoles) await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${adminId}, ${r.id}, now())`.execute(db);

  const userPwHash = await hashPassword('user-pw');
  await sql`INSERT INTO users (email, password_hash, mobile_number, mobile_verified_at, created_at, updated_at) VALUES ('bug-user@test.com', ${userPwHash}, '+15559876543', now(), now(), now())`.execute(db);

  app = createApp();

  const adminLogin = await supertest(app).post('/auth/login').send({ email: 'bug-admin@test.com', password: 'admin-pw' }).expect(200);
  adminToken = (adminLogin.body as { accessToken: string }).accessToken;
  const userLogin = await supertest(app).post('/auth/login').send({ email: 'bug-user@test.com', password: 'user-pw' }).expect(200);
  userToken = (userLogin.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = getDatabase();
  await sql`DELETE FROM media_items`.execute(db);
  await sql`DELETE FROM product_media_sorts`.execute(db);
  await sql`DELETE FROM audit_log`.execute(db);
  await sql`DELETE FROM user_roles`.execute(db);
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
  await sql`DELETE FROM product_variants`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

// ===== 1. Catalog/Search edge cases =====

describe('Bug hunt: Catalog/search', () => {
  it('total matches filtered results for simple list', async () => {
    const body = (await supertest(app).get('/products').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(3);
    expect(body.total).toBe(3);
  });

  it('total matches for category filter', async () => {
    const body = (await supertest(app).get('/products?category=test-cat').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(3);
    expect(body.total).toBe(3);
  });

  it('total matches for inStock filter', async () => {
    const body = (await supertest(app).get('/products?inStock=true').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(2); // Alpha(5) + Gamma(null) are in stock; Beta(0) is not
    expect(body.total).toBe(2);
  });

  it('total matches for minPrice filter', async () => {
    const body = (await supertest(app).get('/products?minPrice=15').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(2); // Beta 20, Gamma 30
    expect(body.total).toBe(2);
  });

  it('total matches for maxPrice filter', async () => {
    const body = (await supertest(app).get('/products?maxPrice=15').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(1); // Alpha 10
    expect(body.total).toBe(1);
  });

  it('total matches for combined filters', async () => {
    const body = (await supertest(app).get('/products?minPrice=5&maxPrice=25&inStock=true').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(1);
    expect(body.total).toBe(1);
  });

  it('search total matches', async () => {
    const body = (await supertest(app).get('/products/search?q=product').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(3);
    expect(body.total).toBe(3);
  });

  it('search with inStock filter total matches', async () => {
    const body = (await supertest(app).get('/products/search?q=product&inStock=true').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(2);
    expect(body.total).toBe(2);
  });

  it('search with price filter total matches', async () => {
    const body = (await supertest(app).get('/products/search?q=product&minPrice=15').expect(200)).body as PaginatedResult;
    expect(body.products.length).toBe(2);
    expect(body.total).toBe(2);
  });

  it('pagination does not duplicate records', async () => {
    const all = (await supertest(app).get('/products?limit=50').expect(200)).body as PaginatedResult;
    const page1 = (await supertest(app).get('/products?limit=2&offset=0').expect(200)).body as PaginatedResult;
    const page2 = (await supertest(app).get('/products?limit=2&offset=2').expect(200)).body as PaginatedResult;
    const allSlugs = all.products.map((p) => p.slug);
    const p1Slugs = page1.products.map((p) => p.slug);
    const p2Slugs = page2.products.map((p) => p.slug);
    expect([...p1Slugs, ...p2Slugs]).toEqual(allSlugs);
  });

  it('deterministic ordering with name_asc', async () => {
    const body = (await supertest(app).get('/products?sort=name_asc').expect(200)).body as PaginatedResult;
    expect(body.products.map((p) => p.slug)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('price_asc sorting works', async () => {
    const body = (await supertest(app).get('/products?sort=price_asc').expect(200)).body as PaginatedResult;
    expect(body.products.map((p) => p.price)).toEqual(['10.00', '20.00', '30.00']);
  });

  it('price_desc sorting works', async () => {
    const body = (await supertest(app).get('/products?sort=price_desc').expect(200)).body as PaginatedResult;
    expect(body.products.map((p) => p.price)).toEqual(['30.00', '20.00', '10.00']);
  });

  it('validates sort parameter', async () => {
    const body = (await supertest(app).get('/products?sort=invalid').expect(400)).body as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates limit parameter', async () => {
    const body = (await supertest(app).get('/products?limit=-1').expect(400)).body as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates minPrice parameter', async () => {
    const body = (await supertest(app).get('/products?minPrice=-5').expect(400)).body as ErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('impossible minPrice > maxPrice returns empty', async () => {
    const body = (await supertest(app).get('/products?minPrice=50&maxPrice=10').expect(200)).body as PaginatedResult;
    expect(body.products).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('nonexistent category returns empty', async () => {
    const body = (await supertest(app).get('/products?category=nonexistent').expect(200)).body as PaginatedResult;
    expect(body.products).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('offset beyond total returns empty', async () => {
    const body = (await supertest(app).get('/products?offset=100').expect(200)).body as PaginatedResult;
    expect(body.products).toEqual([]);
    expect(body.total).toBe(3);
  });

  it('search SQL injection attempt', async () => {
    const body = (await supertest(app).get("/products/search?q=' OR 1=1--").expect(200)).body as PaginatedResult;
    expect(body.products).toEqual([]);
  });

  it('search empty q returns 400', async () => {
    await supertest(app).get('/products/search?q=').expect(400);
  });

  it('draft product not accessible by slug', async () => {
    await supertest(app).get('/products/draft-prod').expect(404);
  });
});

// ===== 2. Cart edge cases =====

describe('Bug hunt: Cart', () => {
  beforeEach(async () => {
    const db = getDatabase();
    await sql`DELETE FROM cart_items`.execute(db);
  });

  it('adds product to cart', async () => {
    const body = (await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 2 }).expect(200)).body as { quantity: number };
    expect(body.quantity).toBe(2);
  });

  it('rejects quantity zero', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 0 }).expect(400);
  });

  it('rejects negative quantity', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: -1 }).expect(400);
  });

  it('rejects non-integer quantity', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 1.5 }).expect(400);
  });

  it('rejects missing productId', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ quantity: 1 }).expect(400);
  });

  it('rejects inactive product', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }).expect(404);
  });

  it('rejects unauthenticated', async () => {
    await supertest(app).post('/cart').send({ productId, quantity: 1 }).expect(401);
  });

  it('ownership enforced on delete', async () => {
    const body = (await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 1 }).expect(200)).body as { id: string };
    // Other user cannot delete
    await supertest(app).delete(`/cart/${body.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });

  it('delete missing cart item returns 404', async () => {
    await supertest(app).delete('/cart/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${userToken}`).expect(404);
  });
});

// ===== 3. Auth/RBAC =====

describe('Bug hunt: Auth/RBAC', () => {
  it('customer cannot access admin routes', async () => {
    for (const route of ['/admin/products', '/admin/categories', '/admin/users', '/admin/audit', '/admin/analytics/summary']) {
      await supertest(app).get(route).set('Authorization', `Bearer ${userToken}`).expect(403);
    }
  });

  it('unauthenticated gets 401', async () => {
    await supertest(app).get('/admin/products').expect(401);
  });

  it('register does not create backend roles', async () => {
    const email = `norole-${Date.now()}@test.com`;
    await supertest(app).post('/auth/register').send({ email, password: 'test123456' }).expect(201);
    const db = getDatabase();
    const user = await db.selectFrom('users').where('email', '=', email).select('users.id').executeTakeFirst();
    if (!user) throw new Error('User not found');
    const roles = await db.selectFrom('user_roles').where('user_id', '=', user.id).execute();
    expect(roles.length).toBe(0);
  });

  it('malformed JWT returns 401', async () => {
    await supertest(app).get('/users/me').set('Authorization', 'Bearer invalid-token').expect(401);
  });
});

// ===== 4. Checkout edge cases =====

describe('Bug hunt: Checkout', () => {
  beforeEach(async () => {
    const db = getDatabase();
    await sql`DELETE FROM cart_items`.execute(db);
    await sql`DELETE FROM orders`.execute(db);
    await sql`DELETE FROM order_items`.execute(db);
    await sql`DELETE FROM payments`.execute(db);
    await sql`DELETE FROM order_shipping`.execute(db);
    await sql`DELETE FROM notifications`.execute(db);
  });

  it('rejects empty cart', async () => {
    await supertest(app).post('/checkout').set('Authorization', `Bearer ${userToken}`).expect(400);
  });

  it('completes checkout', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 2 }).expect(200);
    const body = (await supertest(app).post('/checkout').set('Authorization', `Bearer ${userToken}`).expect(201)).body as { orderId: string; status: string; total: string };
    expect(body.orderId).toBeDefined();
    expect(body.status).toBe('pending');
    expect(body.total).toBe('20.00');
  });

  it('clears cart after checkout', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 1 }).expect(200);
    await supertest(app).post('/checkout').set('Authorization', `Bearer ${userToken}`).expect(201);
    const cartBody = (await supertest(app).get('/cart').set('Authorization', `Bearer ${userToken}`).expect(200)).body as { items: unknown[] };
    expect(cartBody.items.length).toBe(0);
  });
});

// ===== 5. Orders edge cases =====

describe('Bug hunt: Orders', () => {
  it('rejects non-existent order', async () => {
    await supertest(app).get('/orders/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${userToken}`).expect(404);
  });

  it('ownership enforced', async () => {
    await supertest(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ productId, quantity: 1 }).expect(200);
    const orderBody = (await supertest(app).post('/checkout').set('Authorization', `Bearer ${userToken}`).expect(201)).body as { orderId: string };
    await supertest(app).get(`/orders/${orderBody.orderId}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });
});

// ===== 6. Wishlist edge cases =====

describe('Bug hunt: Wishlist', () => {
  it('rejects inactive product', async () => {
    await supertest(app).post('/wishlist').set('Authorization', `Bearer ${userToken}`).send({ productId: '00000000-0000-0000-0000-000000000000' }).expect(404);
  });

  it('wishlist only shows active products', async () => {
    const db = getDatabase();
    const draft = await db.selectFrom('products').select('id').where('slug', '=', 'draft-prod').executeTakeFirst();
    if (draft) {
      await sql`INSERT INTO wishlist_items (user_id, product_id, created_at) VALUES ((SELECT id FROM users WHERE email = 'bug-user@test.com'), ${draft.id}, now()) ON CONFLICT DO NOTHING`.execute(db);
    }
    const body = (await supertest(app).get('/wishlist').set('Authorization', `Bearer ${userToken}`).expect(200)).body as Array<{ productSlug: string }>;
    expect(body.map((i) => i.productSlug)).not.toContain('draft-prod');
  });

  it('duplicate add is idempotent', async () => {
    await supertest(app).post('/wishlist').set('Authorization', `Bearer ${userToken}`).send({ productId }).expect(200);
    await supertest(app).post('/wishlist').set('Authorization', `Bearer ${userToken}`).send({ productId }).expect(200);
    const body = (await supertest(app).get('/wishlist').set('Authorization', `Bearer ${userToken}`).expect(200)).body as Array<{ productId: string }>;
    expect(body.filter((i) => i.productId === productId).length).toBe(1);
  });

  it('delete missing item returns 404', async () => {
    await supertest(app).delete('/wishlist/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${userToken}`).expect(404);
  });
});

// ===== 7. Error response format =====

describe('Bug hunt: Error response format', () => {
  it('all errors have error.code and error.message', async () => {
    const endpoints: Array<{ method: 'get' | 'post'; url: string; code: number; body: Record<string, unknown> }> = [
      { method: 'get', url: '/admin/products', code: 401, body: {} },
      { method: 'get', url: '/products/nonexistent-slug', code: 404, body: {} },
      { method: 'post', url: '/auth/login', code: 400, body: {} },
    ];
    for (const ep of endpoints) {
      const res = await (ep.method === 'get' ? supertest(app).get(ep.url) : supertest(app).post(ep.url).send(ep.body));
      expect(res.status).toBe(ep.code);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    }
  });
});