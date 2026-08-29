import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase, getDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let fullAdminToken: string;
let backendReadToken: string;
let backendWriteToken: string;
let userToken: string;
let categoryId: string;
let productId: string;
const productSlug = 'test-product';

interface ErrResp {
  error: { code: string; message: string };
}

interface UserListEntry {
  id: string;
  email: string;
  roles: string[];
  createdAt: string;
}

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = getDatabase();

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
  await sql`INSERT INTO prices (product_id, amount) VALUES (${productId}, 19.99)`.execute(db);

  // Create a default variant for the test product (required for activation)
  await sql`
    INSERT INTO product_variants (product_id, sku, size, colour_name, status, selling_price, mrp, quantity, created_at, updated_at)
    VALUES (${productId}, 'test-product-default', 'Default', 'Default', 'active', 19.99, 19.99, 100, now(), now())
  `.execute(db);

  // Draft product for status filter testing
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Item', 'draft-item', 'A draft product', 'draft', ${categoryId}, now(), now())
  `.execute(db);

  // Fetch role IDs
  const roles = await db.selectFrom('roles').selectAll().execute();
  const roleId = (name: string) => roles.find((r) => r.name === name)!.id;

  // --- Create Full Admin (all 4 roles) ---
  const adminPwHash = await hashPassword('fulladmin-pw');
  const adminResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('fulladmin@test.com', ${adminPwHash}, now(), now())
    RETURNING id
  `.execute(db);
  const fullAdminId = adminResult.rows[0]!.id;
  for (const rn of ['backend_read', 'backend_write', 'backend_admin', 'user_management']) {
    await sql`
      INSERT INTO user_roles (user_id, role_id, created_at)
      VALUES (${fullAdminId}, ${roleId(rn)}, now())
    `.execute(db);
  }

  // --- Create backend_read only user ---
  const readPwHash = await hashPassword('read-pw');
  const readResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('backendread@test.com', ${readPwHash}, now(), now())
    RETURNING id
  `.execute(db);
  const readUserId = readResult.rows[0]!.id;
  await sql`
    INSERT INTO user_roles (user_id, role_id, created_at)
    VALUES (${readUserId}, ${roleId('backend_read')}, now())
  `.execute(db);

  // --- Create backend_write only user ---
  const writePwHash = await hashPassword('write-pw');
  const writeResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('backendwrite@test.com', ${writePwHash}, now(), now())
    RETURNING id
  `.execute(db);
  const writeUserId = writeResult.rows[0]!.id;
  await sql`
    INSERT INTO user_roles (user_id, role_id, created_at)
    VALUES (${writeUserId}, ${roleId('backend_write')}, now())
  `.execute(db);

  // --- Create regular customer (no backend roles) ---
  const userPwHash = await hashPassword('user-pw');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('customer@test.com', ${userPwHash}, now(), now())
  `.execute(db);

  app = createApp();

  // Login all users
  const adminLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'fulladmin@test.com', password: 'fulladmin-pw' })
    .expect(200);
  fullAdminToken = (adminLogin.body as { accessToken: string }).accessToken;

  const readLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'backendread@test.com', password: 'read-pw' })
    .expect(200);
  backendReadToken = (readLogin.body as { accessToken: string }).accessToken;

  const writeLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'backendwrite@test.com', password: 'write-pw' })
    .expect(200);
  backendWriteToken = (writeLogin.body as { accessToken: string }).accessToken;

  const userLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'customer@test.com', password: 'user-pw' })
    .expect(200);
  userToken = (userLogin.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = getDatabase();
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

describe('GET /admin/me', () => {
  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .get('/admin/me')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns 401 with an invalid token', async () => {
    const res = await supertest(app)
      .get('/admin/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
    });
  });

  it('returns 403 for a customer with no backend roles', async () => {
    await supertest(app)
      .get('/admin/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('returns identity + roles for a user with backend_read', async () => {
    const res = await supertest(app)
      .get('/admin/me')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    const body = res.body as {
      id: string;
      email: string;
      mobileNumber: string | null;
      mobileVerified: boolean;
      roles: string[];
    };
    expect(body).toHaveProperty('id');
    expect(body.email).toBe('backendread@test.com');
    expect(body.roles).toContain('backend_read');
    expect(body.mobileNumber).toBeNull();
    expect(body.mobileVerified).toBe(false);
  });

  it('returns identity + all roles for full admin', async () => {
    const res = await supertest(app)
      .get('/admin/me')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    const body = res.body as { roles: string[] };
    expect(body.roles).toContain('backend_read');
    expect(body.roles).toContain('backend_write');
    expect(body.roles).toContain('backend_admin');
    expect(body.roles).toContain('user_management');
  });

  it('returns roles for backend_write user', async () => {
    const res = await supertest(app)
      .get('/admin/me')
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .expect(200);

    const body = res.body as { roles: string[] };
    expect(body.roles).toContain('backend_write');
  });
});

describe('RBAC — Customer (no backend roles)', () => {
  it('customer cannot access /admin/products', async () => {
    await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('customer cannot access /admin/categories', async () => {
    await supertest(app)
      .get('/admin/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('unauthenticated access returns 401', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .expect(401);

    const body = res.body as ErrResp;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('RBAC — backend_read', () => {
  it('can GET /admin/products', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('can GET /admin/categories', async () => {
    const res = await supertest(app)
      .get('/admin/categories')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as Array<unknown>).length).toBeGreaterThanOrEqual(1);
  });

  it('can GET /admin/categories/:id', async () => {
    const res = await supertest(app)
      .get(`/admin/categories/${categoryId}`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as { name: string }).name).toBe('Test Category');
  });

  it('can GET /admin/products/:id', async () => {
    const res = await supertest(app)
      .get(`/admin/products/${productId}`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as { name: string }).name).toBe('Test Product');
  });

  it('can GET /admin/products/:slug/inventory', async () => {
    const res = await supertest(app)
      .get(`/admin/products/${productSlug}/inventory`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as { productSlug: string }).productSlug).toBe(productSlug);
  });

  it('can GET /admin/products/:slug/price', async () => {
    const res = await supertest(app)
      .get(`/admin/products/${productSlug}/price`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as { amount: string | null }).amount).toBe('19.99');
  });

  it('can GET /admin/audit', async () => {
    const res = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as { entries: unknown[] }).entries).toBeDefined();
  });

  it('can GET /admin/analytics/summary', async () => {
    const res = await supertest(app)
      .get('/admin/analytics/summary')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .expect(200);

    expect((res.body as { products: unknown }).products).toBeDefined();
  });

  it('cannot CREATE a category (backend_read only)', async () => {
    await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .send({ name: 'Should Fail', slug: 'should-fail' })
      .expect(403);
  });

  it('cannot CREATE a product (backend_read only)', async () => {
    await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${backendReadToken}`)
      .send({ name: 'Fail', slug: 'fail-prod' })
      .expect(403);
  });

  it('cannot UPDATE a product (backend_read only)', async () => {
    await supertest(app)
      .patch(`/admin/products/${productId}`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .send({ name: 'Hack' })
      .expect(403);
  });

  it('cannot change product status', async () => {
    await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .send({ status: 'archived' })
      .expect(403);
  });

  it('cannot set inventory', async () => {
    await supertest(app)
      .put(`/admin/products/${productSlug}/inventory`)
      .set('Authorization', `Bearer ${backendReadToken}`)
      .send({ quantity: 10 })
      .expect(403);
  });
});

describe('RBAC — backend_write', () => {
  let createdCategoryId: string;
  let createdProductId: string;

  it('can CREATE a category', async () => {
    const res = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ name: 'Write Cat', slug: 'write-cat', description: 'Created by write user' })
      .expect(201);

    const body = res.body as { name: string; slug: string; id: string };
    expect(body.name).toBe('Write Cat');
    expect(body.slug).toBe('write-cat');
    createdCategoryId = body.id;
  });

  it('can UPDATE a category', async () => {
    const res = await supertest(app)
      .patch(`/admin/categories/${createdCategoryId}`)
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ name: 'Updated Write Cat' })
      .expect(200);

    expect((res.body as { name: string }).name).toBe('Updated Write Cat');
  });

  it('can CREATE a product', async () => {
    const res = await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({
        name: 'Write Created Product',
        slug: 'write-created-prod',
        description: 'Created by write user',
        status: 'active',
        categoryId,
      })
      .expect(201);

    const body = res.body as { name: string; status: string; id: string };
    expect(body.name).toBe('Write Created Product');
    expect(body.status).toBe('active');
    createdProductId = body.id;
  });

  it('can UPDATE a product', async () => {
    const res = await supertest(app)
      .patch(`/admin/products/${createdProductId}`)
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ name: 'Updated Write Product' })
      .expect(200);

    expect((res.body as { name: string }).name).toBe('Updated Write Product');
  });

  it('can publish/unpublish product status', async () => {
    const res1 = await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ status: 'archived' })
      .expect(200);

    expect((res1.body as { status: string }).status).toBe('archived');

    const res2 = await supertest(app)
      .patch(`/admin/products/${productId}/status`)
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ status: 'active' })
      .expect(200);

    expect((res2.body as { status: string }).status).toBe('active');
  });

  it('can set inventory', async () => {
    const res = await supertest(app)
      .put(`/admin/products/${productSlug}/inventory`)
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ quantity: 100 })
      .expect(200);

    expect((res.body as { quantity: number }).quantity).toBe(100);
  });

  it('can set price', async () => {
    const res = await supertest(app)
      .put(`/admin/products/${productSlug}/price`)
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .send({ amount: 29.99 })
      .expect(200);

    expect((res.body as { amount: string }).amount).toBe('29.99');
  });

  it('cannot access user management', async () => {
    await supertest(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .expect(403);
  });

  it('cannot view backend user details', async () => {
    await supertest(app)
      .get('/admin/users/some-id')
      .set('Authorization', `Bearer ${backendWriteToken}`)
      .expect(403);
  });
});

describe('RBAC — Product/Category hard-delete unavailable', () => {
  it('DELETE /admin/products/:id returns 404 (route removed)', async () => {
    await supertest(app)
      .delete(`/admin/products/${productId}`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(404);
  });

  it('DELETE /admin/categories/:id returns 404 (route removed)', async () => {
    await supertest(app)
      .delete(`/admin/categories/${categoryId}`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(404);
  });
});

describe('RBAC — user_management', () => {
  let createdBackendUserId: string;

  it('full admin can list backend users', async () => {
    const res = await supertest(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    const body = res.body as UserListEntry[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);
  });

  it('can filter users by role', async () => {
    const res = await supertest(app)
      .get('/admin/users?role=backend_read')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    const body = res.body as UserListEntry[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]!.roles).toContain('backend_read');
  });

  it('rejects invalid role filter', async () => {
    await supertest(app)
      .get('/admin/users?role=nonexistent')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(400);
  });

  it('can view backend user details', async () => {
    const listRes = await supertest(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    const firstUserId = (listRes.body as UserListEntry[])[0]!.id;

    const res = await supertest(app)
      .get(`/admin/users/${firstUserId}`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    const body = res.body as { id: string; roles: string[] };
    expect(body.id).toBe(firstUserId);
    expect(Array.isArray(body.roles)).toBe(true);
  });

  it('can create a backend user with roles', async () => {
    const res = await supertest(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({
        email: `newbackend-${Date.now()}@test.com`,
        password: 'secure-password-123',
        roles: ['backend_read', 'backend_write'],
      })
      .expect(201);

    const body = res.body as { email: string; roles: string[]; id: string };
    expect(body.email).toBeDefined();
    expect(body.roles).toEqual(['backend_read', 'backend_write']);
    createdBackendUserId = body.id;
  });

  it('rejects creating user with unknown role', async () => {
    await supertest(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({
        email: `unknown-role-${Date.now()}@test.com`,
        password: 'pw123',
        roles: ['fake_role'],
      })
      .expect(400);
  });

  it('rejects creating user without roles', async () => {
    await supertest(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({
        email: `noroles-${Date.now()}@test.com`,
        password: 'pw123',
        roles: [],
      })
      .expect(400);
  });

  it('can assign/change roles', async () => {
    const res = await supertest(app)
      .put(`/admin/users/${createdBackendUserId}/roles`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({ roles: ['backend_read', 'backend_write', 'backend_admin'] })
      .expect(200);

    expect((res.body as { roles: string[] }).roles).toEqual(['backend_read', 'backend_write', 'backend_admin']);
  });

  it('role changes take effect immediately', async () => {
    const db = getDatabase();
    const pwHash = await hashPassword('temp-pw');
    const userResult = await sql<{ id: string }>`
      INSERT INTO users (email, password_hash, created_at, updated_at)
      VALUES ('rolechange-test@test.com', ${pwHash}, now(), now())
      RETURNING id
    `.execute(db);
    const targetId = userResult.rows[0]!.id;

    const roles = await db.selectFrom('roles').selectAll().execute();
    await sql`
      INSERT INTO user_roles (user_id, role_id, created_at)
      VALUES (${targetId}, ${roles.find((r) => r.name === 'backend_read')!.id}, now())
    `.execute(db);

    const tempLogin = await supertest(app)
      .post('/auth/login')
      .send({ email: 'rolechange-test@test.com', password: 'temp-pw' })
      .expect(200);
    const tempToken = (tempLogin.body as { accessToken: string }).accessToken;

    // Can read
    await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${tempToken}`)
      .expect(200);

    // Cannot write
    await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ name: 'Should Fail', slug: 'should-fail' })
      .expect(403);

    // Assign backend_write (roles change immediately, same token still works)
    await supertest(app)
      .put(`/admin/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({ roles: ['backend_read', 'backend_write'] })
      .expect(200);

    // Now the same token can write (server-authoritative)
    await supertest(app)
      .post('/admin/products')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ name: 'After Role Change', slug: `after-change-${Date.now()}` })
      .expect(201);
  });

  it('prevents removing last user_management role', async () => {
    const listRes = await supertest(app)
      .get('/admin/users?role=user_management')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    const users = listRes.body as UserListEntry[];
    const adminUserId = users[0]!.id;

    const res = await supertest(app)
      .put(`/admin/users/${adminUserId}/roles`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({ roles: ['backend_read', 'backend_write', 'backend_admin'] })
      .expect(400);

    expect((res.body as ErrResp).error.message).toMatch(/last user_management/i);
  });
});

describe('RBAC — Public registration cannot self-elevate', () => {
  it('register creates a normal customer (no roles)', async () => {
    const email = `selfreg-${Date.now()}@test.com`;
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);

    expect((res.body as { accessToken: string }).accessToken).toBeDefined();

    const db = getDatabase();
    const userRows = await db
      .selectFrom('users')
      .leftJoin('user_roles', 'user_roles.user_id', 'users.id')
      .select([sql<number>`COUNT(user_roles.role_id)::int`.as('roleCount')])
      .where('users.email', '=', email)
      .groupBy('users.id')
      .execute();

    // User should have 0 backend roles (empty result set means no rows)
    // If no rows returned, that means the user has no user_roles
    // (LEFT JOIN with no matching rows means roleCount = 0, grouped by users.id)
    if (userRows.length > 0) {
      expect(userRows[0]!.roleCount).toBe(0);
    }
  });
});

describe('RBAC — Full admin can access all endpoints', () => {
  it('can GET /admin/products', async () => {
    const res = await supertest(app)
      .get('/admin/products')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('can create and read categories', async () => {
    const createRes = await supertest(app)
      .post('/admin/categories')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .send({ name: 'Admin Cat', slug: 'admin-cat' })
      .expect(201);

    const createBody = createRes.body as { id: string };
    const getRes = await supertest(app)
      .get(`/admin/categories/${createBody.id}`)
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    expect((getRes.body as { name: string }).name).toBe('Admin Cat');
  });

  it('can read audit log', async () => {
    const res = await supertest(app)
      .get('/admin/audit')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);

    expect((res.body as { entries: unknown[]; total: number }).entries).toBeDefined();
  });
});

describe('RBAC — Customer APIs still work for all users', () => {
  it('customer can access own profile', async () => {
    await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  it('customer can access public catalog', async () => {
    await supertest(app)
      .get('/products')
      .expect(200);
  });

  it('full admin can still use customer APIs', async () => {
    await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${fullAdminToken}`)
      .expect(200);
  });
});