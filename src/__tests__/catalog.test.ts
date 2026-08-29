import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';

let app: ReturnType<typeof createApp>;
let categoryId: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean slate
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);

  // Seed categories
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, description, created_at, updated_at)
    VALUES ('Electronics', 'electronics', 'Electronic items', now(), now())
    RETURNING id
  `.execute(db);
  categoryId = catResult.rows[0]!.id;

  await sql`
    INSERT INTO categories (name, slug, description, created_at, updated_at)
    VALUES ('Books', 'books', 'Books and publications', now(), now())
  `.execute(db);

  // Seed products
  // Capture a product id to set a price on it
  const prodResult = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Smartphone', 'smartphone', 'A mobile phone', 'active', ${categoryId}, now(), now())
    RETURNING id
  `.execute(db);
  const smartphoneId = prodResult.rows[0]!.id;

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Laptop', 'laptop', 'A portable computer', 'active', ${categoryId}, now(), now())
  `.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Novel', 'novel', 'A fiction book', 'active', NULL, now(), now())
  `.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Item', 'draft-item', 'Not yet published', 'draft', NULL, now(), now())
  `.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Old Product', 'old-product', 'Archived', 'archived', NULL, now(), now())
  `.execute(db);

  // Set a price on the smartphone to verify catalog integration
  await sql`
    INSERT INTO prices (product_id, amount, created_at, updated_at)
    VALUES (${smartphoneId}, 29.99, now(), now())
  `.execute(db);

  app = createApp();
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM notifications`.execute(db);
  await sql`DELETE FROM order_shipping`.execute(db);
  await sql`DELETE FROM order_items`.execute(db);
  await sql`DELETE FROM payments`.execute(db);
  await sql`DELETE FROM orders`.execute(db);
  await sql`DELETE FROM prices`.execute(db);
  await sql`DELETE FROM products`.execute(db);
  await sql`DELETE FROM categories`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('GET /categories', () => {
  it('returns all categories', async () => {
    const res = await supertest(app)
      .get('/categories')
      .expect(200);

    const body = res.body as Array<{ name: string; slug: string }>;
    expect(body.length).toBe(2);
    expect(body[0]!.slug).toBe('books'); // alphabetical
    expect(body[1]!.slug).toBe('electronics');
  });
});

describe('GET /categories/:slug', () => {
  it('returns category with its active products', async () => {
    const res = await supertest(app)
      .get('/categories/electronics')
      .expect(200);

    const body = res.body as {
      category: { name: string; slug: string };
      products: Array<{ name: string; slug: string; price: string | null }>;
    };

    expect(body.category.name).toBe('Electronics');
    expect(body.products.length).toBe(2);
    expect(body.products[0]!.slug).toBe('laptop');
    expect(body.products[1]!.slug).toBe('smartphone');
    expect(body.products[0]!.price).toBeNull();
    expect(body.products[1]!.price).toBe('29.99');
  });

  it('returns 404 for unknown category', async () => {
    const res = await supertest(app)
      .get('/categories/unknown')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Category not found' },
    });
  });
});

describe('GET /products', () => {
  it('returns only active products (paginated)', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as { products: Array<{ slug: string; status: string }>; total: number; limit: number; offset: number };
    expect(body.products.length).toBe(3);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    const drafts = body.products.filter((p) => p.slug === 'draft-item');
    expect(drafts.length).toBe(0);
  });

  it('includes category name on products', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as { products: Array<{ slug: string; category: string | null; price: string | null }> };
    const smartphone = body.products.find((p) => p.slug === 'smartphone');
    const novel = body.products.find((p) => p.slug === 'novel');
    expect(smartphone!.category).toBe('Electronics');
    expect(novel!.category).toBeNull();
    expect(smartphone!.price).toBe('29.99');
    expect(novel!.price).toBeNull();
  });

  it('filters by category slug', async () => {
    const res = await supertest(app)
      .get('/products?category=electronics')
      .expect(200);

    const body = res.body as { products: Array<{ slug: string }> };
    expect(body.products.length).toBe(2);
    expect(body.products[0]!.slug).toBe('laptop');
    expect(body.products[1]!.slug).toBe('smartphone');
  });

  it('returns empty for category with no products', async () => {
    const res = await supertest(app)
      .get('/products?category=books')
      .expect(200);

    const body = res.body as { products: Array<unknown> };
    expect(body.products.length).toBe(0);
  });
});

describe('GET /products/:slug', () => {
  it('returns a single active product by slug', async () => {
    const res = await supertest(app)
      .get('/products/smartphone')
      .expect(200);

    const body = res.body as {
      id: string;
      name: string;
      slug: string;
      description: string;
      status: string;
      categoryId: string;
      category: string;
      price: string | null;
    };

    expect(body.name).toBe('Smartphone');
    expect(body.slug).toBe('smartphone');
    expect(body.status).toBe('active');
    expect(body.category).toBe('Electronics');
    expect(body.categoryId).toBe(categoryId);
    expect(body.price).toBe('29.99');
  });

  it('returns 404 for draft product', async () => {
    const res = await supertest(app)
      .get('/products/draft-item')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('returns 404 for archived product', async () => {
    const res = await supertest(app)
      .get('/products/old-product')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });

  it('returns 404 for unknown slug', async () => {
    const res = await supertest(app)
      .get('/products/unknown')
      .expect(404);

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Product not found' },
    });
  });
});

describe('Catalog does not require authentication', () => {
  it('products endpoint works without auth header', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    expect((res.body as Record<string, unknown>)).toHaveProperty('products');
    expect(Array.isArray((res.body as { products: unknown[] }).products)).toBe(true);
  });

  it('categories endpoint works without auth header', async () => {
    const res = await supertest(app)
      .get('/categories')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});