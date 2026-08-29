import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase, getDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';
import { createStorage, resetStorage } from '../features/media/storage.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

let app: ReturnType<typeof createApp>;
let adminToken: string;
let userToken: string;
let secondUserToken: string;
let productId: string;
const productSlug = 'media-test-product';
let reviewId: string;
const TEST_UPLOAD_DIR = join(process.cwd(), '.test-uploads');

interface MediaResponse {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  fileType: string;
  mimeType: string;
  originalName: string | null;
  storagePath: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  createdAt: string;
  url: string;
}

interface ErrorResponse {
  error: { code: string; message: string };
}

beforeAll(async () => {
  process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;
  await rm(TEST_UPLOAD_DIR, { recursive: true, force: true });
  await mkdir(TEST_UPLOAD_DIR, { recursive: true });

  const pool = createPool();
  createDatabase(pool);

  const db = getDatabase();

  await sql`DELETE FROM media_items`.execute(db);
  await sql`DELETE FROM product_media_sorts`.execute(db);
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
    VALUES ('Media Test Cat', 'media-test-cat', now(), now())
    RETURNING id
  `.execute(db);
  const categoryId = catResult.rows[0]!.id;

  // Seed a product
  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Media Test Product', 'media-test-product', 'Product for media tests', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  productId = prodResult.rows[0]!.id;

  await sql`INSERT INTO prices (product_id, amount) VALUES (${productId}, 19.99)`.execute(db);

  // Create admin user (with all backend roles via RBAC)
  const adminPwHash = await hashPassword('admin-password-123');
  const adminInsert = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('media-admin@test.com', ${adminPwHash}, now(), now())
    RETURNING id
  `.execute(db);
  const mediaAdminId = adminInsert.rows[0]!.id;
  const mediaRoles = await db.selectFrom('roles').selectAll().execute();
  for (const r of mediaRoles) {
    await sql`INSERT INTO user_roles (user_id, role_id, created_at) VALUES (${mediaAdminId}, ${r.id}, now())`.execute(db);
  }

  // Create regular user (no backend roles)
  const userPwHash = await hashPassword('user-password-123');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('media-user@test.com', ${userPwHash}, now(), now())
  `.execute(db);

  // Create second user (for authorization tests)
  const user2PwHash = await hashPassword('user2-password-123');
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES ('media-user2@test.com', ${user2PwHash}, now(), now())
  `.execute(db);

  // Create a review for the media-user
  const reviewResult = await sql<{ id: string }>`
    INSERT INTO reviews (user_id, product_id, rating, content, created_at, updated_at)
    VALUES (
      (SELECT id FROM users WHERE email = 'media-user@test.com'),
      ${productId}, 5, 'Great product!', now(), now()
    )
    RETURNING id
  `.execute(db);
  reviewId = reviewResult.rows[0]!.id;

  // Init storage
  resetStorage();
  createStorage();

  app = createApp();

  // Login users
  const adminLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'media-admin@test.com', password: 'admin-password-123' })
    .expect(200);
  adminToken = (adminLogin.body as { accessToken: string }).accessToken;

  const userLogin = await supertest(app)
    .post('/auth/login')
    .send({ email: 'media-user@test.com', password: 'user-password-123' })
    .expect(200);
  userToken = (userLogin.body as { accessToken: string }).accessToken;

  const user2Login = await supertest(app)
    .post('/auth/login')
    .send({ email: 'media-user2@test.com', password: 'user2-password-123' })
    .expect(200);
  secondUserToken = (user2Login.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = getDatabase();
  await sql`DELETE FROM media_items`.execute(db);
  await sql`DELETE FROM product_media_sorts`.execute(db);
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
  resetStorage();
  await rm(TEST_UPLOAD_DIR, { recursive: true, force: true });
});

// Helper: create test images using sharp
async function createTestImageBuffer(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();
}

async function createTestPngBuffer(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .png()
    .toBuffer();
}

async function createTestWebpBuffer(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .webp()
    .toBuffer();
}

// ---- Existing functionality intact ----

describe('Existing functionality remains intact', () => {
  it('health endpoint works', async () => {
    const res = await supertest(app).get('/health').expect(200);
    expect((res.body as { status: string }).status).toBe('ok');
  });
});

// ---- Product Media Tests ----

describe('Product Media — Admin Upload', () => {
  it('uploads a valid JPEG image', async () => {
    const imgBuf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', imgBuf, 'test-image.jpg')
      .expect(201);

    const body = res.body as MediaResponse;
    expect(body.id).toBeDefined();
    expect(body.fileType).toBe('image');
    expect(body.mimeType).toBe('image/jpeg');
    expect(body.entityId).toBe(productId);
    expect(body.entityType).toBe('product');
    expect(body.fileSize).toBeGreaterThan(0);
    expect(body.width).toBe(100);
    expect(body.height).toBe(100);
    expect(body.url).toBeDefined();
  });

  it('uploads a valid PNG image', async () => {
    const pngBuf = await createTestPngBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', pngBuf, 'test-image.png')
      .expect(201);

    const body = res.body as MediaResponse;
    expect(body.mimeType).toBe('image/png');
    expect(body.width).toBe(50);
    expect(body.height).toBe(50);
  });

  it('uploads a valid WebP image', async () => {
    const webpBuf = await createTestWebpBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', webpBuf, 'test-image.webp')
      .expect(201);

    const body = res.body as MediaResponse;
    expect(body.mimeType).toBe('image/webp');
  });

  it('rejects unauthenticated upload', async () => {
    const imgBuf = await createTestImageBuffer();
    await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .attach('file', imgBuf, 'test.jpg')
      .expect(401);
  });

  it('rejects non-admin upload', async () => {
    const imgBuf = await createTestImageBuffer();
    await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', imgBuf, 'test.jpg')
      .expect(403);
  });

  it('rejects spoofed extension (exe claiming to be jpg)', async () => {
    const imgBuf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', imgBuf, 'malware.exe')
      .expect(400);

    const body = res.body as ErrorResponse;
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects unsupported MIME type (text file)', async () => {
    const content = Buffer.from('fake image content');
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', content, 'test.txt')
      .expect(400);

    const body = res.body as ErrorResponse;
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects corrupt image', async () => {
    const corrupt = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', corrupt, 'corrupt.jpg')
      .expect(400);

    const body = res.body as ErrorResponse;
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized file', async () => {
    const large = Buffer.alloc(15 * 1024 * 1024, 0xff);
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', large, 'large.jpg')
      .expect(400);

    const body = res.body as ErrorResponse;
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

describe('Product Media — Attachment Limit', () => {
  const fillMediaIds: string[] = [];

  afterAll(async () => {
    // Clean up filler media so subsequent tests work
    const db = getDatabase();
    await db
      .deleteFrom('media_items')
      .where('id', 'in', fillMediaIds)
      .execute();
  });
  it('applies attachment limit', async () => {
    const db = getDatabase();

    // Count existing media
    const row = await db
      .selectFrom('media_items')
      .select(db.fn.countAll<number>().as('count'))
      .where('entity_type', '=', 'product')
      .where('entity_id', '=', productId)
      .executeTakeFirstOrThrow();

    const existingCount = row.count;
    const remaining = 10 - existingCount;
    for (let i = 0; i < remaining; i++) {
      const buf = await createTestImageBuffer();
      const res = await supertest(app)
        .post(`/admin/products/${productId}/media`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', buf, `fill-${i}.jpg`)
        .expect(201);
      fillMediaIds.push((res.body as MediaResponse).id);
    }

    // Next upload should fail
    const buf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buf, 'toomany.jpg')
      .expect(400);

    const body = res.body as ErrorResponse;
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/maximum 10 media items allowed/i);
  });
});

describe('Product Media — Public Listing', () => {
  it('lists media for a product by slug', async () => {
    const res = await supertest(app)
      .get(`/products/${productSlug}/media`)
      .expect(200);

    const body = res.body as MediaResponse[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]!.id).toBeDefined();
    expect(body[0]!.url).toBeDefined();
    expect(body[0]!.entityType).toBe('product');
  });
});

describe('Product Media — Admin Delete', () => {
  it('deletes product media', async () => {
    const buf = await createTestImageBuffer();
    const uploadRes = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buf, 'delete-test.jpg')
      .expect(201);

    const mediaId = (uploadRes.body as MediaResponse).id;

    await supertest(app)
      .delete(`/admin/products/${productId}/media/${mediaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // Verify gone from listing
    const listRes = await supertest(app)
      .get(`/products/${productSlug}/media`)
      .expect(200);

    const ids = (listRes.body as MediaResponse[]).map((m) => m.id);
    expect(ids).not.toContain(mediaId);
  });
});

// ---- Review Media Tests ----

describe('Review Media — User Upload', () => {
  it('uploads a valid image to own review', async () => {
    const buf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/account/reviews/${reviewId}/media`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', buf, 'review-image.jpg')
      .expect(201);

    const body = res.body as MediaResponse;
    expect(body.id).toBeDefined();
    expect(body.fileType).toBe('image');
    expect(body.entityType).toBe('review');
    expect(body.entityId).toBe(reviewId);
  });

  it('rejects upload to another users review', async () => {
    const buf = await createTestImageBuffer();
    await supertest(app)
      .post(`/account/reviews/${reviewId}/media`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .attach('file', buf, 'unauthorized.jpg')
      .expect(404);
  });
});

describe('Review Media — Public Listing', () => {
  it('lists media for a review', async () => {
    const res = await supertest(app)
      .get(`/products/${productSlug}/reviews/${reviewId}/media`)
      .expect(200);

    const body = res.body as MediaResponse[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Review Media — User Delete', () => {
  it('deletes own review media', async () => {
    const buf = await createTestImageBuffer();
    const uploadRes = await supertest(app)
      .post(`/account/reviews/${reviewId}/media`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', buf, 'own-delete.jpg')
      .expect(201);

    const mediaId = (uploadRes.body as MediaResponse).id;

    await supertest(app)
      .delete(`/account/reviews/${reviewId}/media/${mediaId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);
  });
});

// ---- Authorization Tests ----

describe('Authorization — Media Deletion', () => {
  let ownMediaId: string;

  beforeAll(async () => {
    const buf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/account/reviews/${reviewId}/media`)
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', buf, 'auth-test.jpg')
      .expect(201);

    ownMediaId = (res.body as MediaResponse).id;
  });

  it('user cannot delete another users media', async () => {
    await supertest(app)
      .delete(`/account/reviews/${reviewId}/media/${ownMediaId}`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .expect(403);
  });

  it('admin can delete any media', async () => {
    await supertest(app)
      .delete(`/admin/products/${productId}/media/${ownMediaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  it('unauthenticated delete returns 401', async () => {
    // Upload as admin
    const buf = await createTestImageBuffer();
    const uploadRes = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buf, 'unauth-del.jpg')
      .expect(201);

    const mediaId = (uploadRes.body as MediaResponse).id;

    await supertest(app)
      .delete(`/admin/products/${productId}/media/${mediaId}`)
      .expect(401);
  });
});

// ---- Validation ----

describe('File Validation — Edge Cases', () => {
  it('rejects file with invalid extension', async () => {
    const buf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buf, 'image.txt')
      .expect(400);

    const body = res.body as ErrorResponse;
    expect(body.error.message).toMatch(/extension/i);
  });
});

// ---- Video Testing (conditional) ----

describe('Video Media', () => {
  // Video testing requires ffprobe. For now, verify image handling works.
  it('accepts image files (video testing requires ffprobe)', async () => {
    const buf = await createTestImageBuffer();
    const res = await supertest(app)
      .post(`/admin/products/${productId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buf, 'video-fallback.jpg')
      .expect(201);

    expect((res.body as MediaResponse).fileType).toBe('image');
  });
});