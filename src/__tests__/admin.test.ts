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

  // Draft product for status filter testing
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Item', 'draft-item', 'A draft product', 'draft', ${categoryId}, now(), now())
  `.execute(db);

  // Create admin user
  const adminPwHash = await hashPassword('admin-password-123');
  await sql`
    INSERT INTO users (email, password_hash, role, created_at, updated_at)
    VALUES ('admin@test.com', ${adminPwHash}, 'admin', now(), now())
  `.execute(db);

  // Create regular user
  const userPwHash = await hashPassword('user-password-123');
  await sql`
    INSERT INTO users (email, password_hash, role, created_at, updated_at)
    VALUES ('user@test.com', ${userPwHash}, 'user', now(), now())
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

describe('Admin authorization', () => {
  it('rejects unauthenticated admin access (1)', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .expect(401);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects ordinary user admin access (2)', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('allows authorized admin access (3)', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('admin cannot be bypassed by manipulating request input', async () => {
    // Even with a role hint in the body, a regular user is still forbidden
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ role: 'admin' })
      .expect(403);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('Admin category management (4)', () => {
  let createdCategoryId: string;

  it('lists all categories', async () => {
    const res = await supertest(app)
      .get('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Array<{ id: string; name: string; slug: string }>;
    expect(body.length).toBe(1);
    expect(body[0]!.slug).toBe('test-category');
  });

  it('creates a category', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'New Category', slug: 'new-category', description: 'Brand new' })
      .expect(201);

    const body = res.body as { id: string; name: string; slug: string; description: string | null };
    expect(body.name).toBe('New Category');
    expect(body.slug).toBe('new-category');
    expect(body.description).toBe('Brand new');
    createdCategoryId = body.id;
  });

  it('gets a category by id', async () => {
    const res = await supertest(app)
      .get(`/admin/categories/${createdCategoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { name: string };
    expect(body.name).toBe('New Category');
  });

  it('updates a category', async () => {
    const res = await supertest(app)
      .patch(`/admin/categories/${createdCategoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Category', description: null })
      .expect(200);

    const body = res.body as { name: string; description: string | null };
    expect(body.name).toBe('Updated Category');
    expect(body.description).toBeNull();
  });

  it('rejects duplicate slug on category create', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', slug: 'test-category' })
      .expect(409);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('deletes a category', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delete Me', slug: 'delete-me' })
      .expect(201);

    const delId = (res.body as { id: string }).id;

    await supertest(app)
      .delete(`/admin/categories/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await supertest(app)
      .get(`/admin/categories/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('validates name is required on category create (10)', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: 'no-name' })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Admin product management (5, 6)', () => {
  let createdProductId: string;

  it('lists all products including draft (5)', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Array<{ slug: string; status: string }>;
    expect(body.some((p) => p.slug === 'test-product' && p.status === 'active')).toBe(true);
    expect(body.some((p) => p.slug === 'draft-item' && p.status === 'draft')).toBe(true);
  });

  it('lists products filtered by status', async () => {
    const res = await supertest(app)
      .get('/admin/products?status=draft')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Array<{ status: string }>;
    expect(body.length).toBe(1);
    expect(body[0]!.status).toBe('draft');
  });

  it('creates a product', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Admin Created',
        slug: 'admin-created',
        description: 'Created via admin',
        status: 'active',
        categoryId,
      })
      .expect(201);

    const body = res.body as {
      id: string; name: string; slug: string; status: string; categoryId: string | null;
    };
    expect(body.name).toBe('Admin Created');
    expect(body.slug).toBe('admin-created');
    expect(body.status).toBe('active');
    expect(body.categoryId).toBe(categoryId);
    createdProductId = body.id;
  });

  it('defaults to draft status for new products', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Default Draft', slug: 'default-draft' })
      .expect(201);

    const body = res.body as { status: string };
    expect(body.status).toBe('draft');
  });

  it('gets a product by ID (any status)', async () => {
    const res = await supertest(app)
      .get(`/admin/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { id: string; name: string };
    expect(body.id).toBe(createdProductId);
    expect(body.name).toBe('Admin Created');
  });

  it('updates a product', async () => {
    const res = await supertest(app)
      .patch(`/admin/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Admin Product', description: 'Updated desc' })
      .expect(200);

    const body = res.body as { name: string; description: string | null };
    expect(body.name).toBe('Updated Admin Product');
    expect(body.description).toBe('Updated desc');
  });

  it('changes product status (6)', async () => {
    const res = await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'archived' })
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('archived');

    // Restore to active so remaining tests see it publicly
    await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' })
      .expect(200);
  });

  it('deletes a product', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delete Me', slug: 'delete-me-prod' })
      .expect(201);

    const delId = (res.body as { id: string }).id;

    await supertest(app)
      .delete(`/admin/products/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await supertest(app)
      .get(`/admin/products/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('validates required fields on product create (10)', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'No Slug' })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate product slug (11)', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', slug: 'test-product' })
      .expect(409);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('Admin inventory management (8)', () => {
  it('gets inventory for a draft product (admin sees all statuses)', async () => {
    const res = await supertest(app)
      .get('/admin/products/draft-item/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { productSlug: string; quantity: number; inStock: boolean };
    expect(body.productSlug).toBe('draft-item');
    expect(body.quantity).toBe(0);
    expect(body.inStock).toBe(false);
  });

  it('sets inventory for a product (8)', async () => {
    const res = await supertest(app)
      .put(`/admin/products/${productSlug}/inventory`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantity: 50 })
      .expect(200);

    const body = res.body as { productSlug: string; quantity: number };
    expect(body.productSlug).toBe(productSlug);
    expect(body.quantity).toBe(50);
  });

  it('rejects negative inventory (11)', async () => {
    const res = await supertest(app)
      .put(`/admin/products/${productSlug}/inventory`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantity: -1 })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

describe('Admin pricing management (9)', () => {
  it('gets price for a product', async () => {
    const res = await supertest(app)
      .get(`/admin/products/${productSlug}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { productSlug: string; amount: string | null };
    expect(body.productSlug).toBe(productSlug);
    expect(body.amount).toBe('19.99');
  });

  it('sets price for a product (9)', async () => {
    const res = await supertest(app)
      .put(`/admin/products/${productSlug}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 24.99 })
      .expect(200);

    const body = res.body as { productSlug: string; amount: string };
    expect(body.productSlug).toBe(productSlug);
    expect(body.amount).toBe('24.99');
  });

  it('rejects negative price (11)', async () => {
    const res = await supertest(app)
      .put(`/admin/products/${productSlug}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: -5 })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

describe('Database constraints (11)', () => {
  it('rejects invalid product status value', async () => {
    const res = await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'invalid-status' })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects invalid category parent reference', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bad Parent',
        slug: 'bad-parent',
        parentId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(400);

    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects non-existent product on admin get', async () => {
    await supertest(app)
      .get('/admin/products/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});

describe('Regular user auth behavior intact (12)', () => {
  it('regular user can access own profile', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as { email: string };
    expect(body.email).toBe('user@test.com');
  });

  it('regular user can access cart', async () => {
    const res = await supertest(app)
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const body = res.body as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('admin user can access own user endpoints', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as { email: string };
    expect(body.email).toBe('admin@test.com');
  });
});

describe('Existing public catalog behavior intact (13, 14)', () => {
  it('public products only show active products (13)', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as Array<{ slug: string }>;
    expect(body.some((p) => p.slug === 'test-product')).toBe(true);
    expect(body.some((p) => p.slug === 'draft-item')).toBe(false);
  });

  it('public categories still work (13)', async () => {
    const res = await supertest(app)
      .get('/categories')
      .expect(200);

    const body = res.body as Array<{ slug: string }>;
    expect(body.some((c) => c.slug === 'test-category')).toBe(true);
  });

  it('search still works (14)', async () => {
    const res = await supertest(app)
      .get('/products/search?q=Test')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('health works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('ok');
  });
});

describe('Existing ecommerce behavior intact (15)', () => {
  it('auth login still works', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'user@test.com', password: 'user-password-123' })
      .expect(200);

    const body = res.body as { accessToken: string };
    expect(body.accessToken).toBeDefined();
  });
});

describe('Existing reviews behavior intact (16)', () => {
  it('product reviews read still public', async () => {
    const res = await supertest(app)
      .get(`/products/${productSlug}/reviews`)
      .expect(200);

    const body = res.body as { reviews: unknown[]; reviewCount: number };
    expect(Array.isArray(body.reviews)).toBe(true);
  });

  it('my reviews still work for regular user', async () => {
    const res = await supertest(app)
      .get('/account/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Existing wishlist behavior intact (17)', () => {
  it('wishlist works for regular user', async () => {
    const res = await supertest(app)
      .get('/wishlist')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('wishlist add works for admin user too', async () => {
    const res = await supertest(app)
      .post('/wishlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId })
      .expect(200);

    const body = res.body as { productId: string };
    expect(body.productId).toBe(productId);
  });
});