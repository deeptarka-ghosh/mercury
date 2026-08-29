import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';

let app: ReturnType<typeof createApp>;

interface PaginatedProducts {
  products: Array<{ slug: string; name: string; price: string | null }>;
  total: number;
  limit: number;
  offset: number;
}

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

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

  // Seed categories
  const catResult = await sql<{ id: string }>`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Electronics', 'electronics', now(), now())
    RETURNING id
  `.execute(db);
  const electronicsId = catResult.rows[0]!.id;

  await sql`
    INSERT INTO categories (name, slug, created_at, updated_at)
    VALUES ('Books', 'books', now(), now())
  `.execute(db);

  // Seed active products
  const r1 = await sql<{ id: string }>`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Smartphone', 'smartphone', 'A high-end mobile phone with advanced features', 'active', ${electronicsId}, now(), now())
    RETURNING id
  `.execute(db);
  await sql`INSERT INTO prices (product_id, amount) VALUES (${r1.rows[0]!.id}, 29.99)`.execute(db);
  await sql`INSERT INTO inventory (product_id, quantity) VALUES (${r1.rows[0]!.id}, 100)`.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Laptop', 'laptop', 'A portable computer for work and gaming', 'active', ${electronicsId}, now(), now())
  `.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Wireless Mouse', 'wireless-mouse', 'Ergonomic wireless mouse with long battery life', 'active', ${electronicsId}, now(), now())
  `.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Fiction Novel', 'fiction-novel', 'A bestselling fiction book', 'active', NULL, now(), now())
  `.execute(db);

  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('History Book', 'history-book', 'An in-depth history of ancient civilizations', 'active', NULL, now(), now())
  `.execute(db);

  // Draft product — should not appear in search
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Draft Gadget', 'draft-gadget', 'Not yet published gadget', 'draft', NULL, now(), now())
  `.execute(db);

  // Archived product — should not appear in search
  await sql`
    INSERT INTO products (name, slug, description, status, category_id, created_at, updated_at)
    VALUES ('Old Product', 'old-product', 'Archived', 'archived', NULL, now(), now())
  `.execute(db);

  app = createApp();
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

describe('GET /products/search', () => {
  it('finds products by name (case-insensitive)', async () => {
    const res = await supertest(app)
      .get('/products/search?q=smartphone')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products.length).toBe(1);
    expect(body.products[0]!.slug).toBe('smartphone');
    expect(body.total).toBe(1);
  });

  it('finds products by name with different case', async () => {
    const res = await supertest(app)
      .get('/products/search?q=SMARTPHONE')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products.length).toBe(1);
    expect(body.products[0]!.slug).toBe('smartphone');
  });

  it('finds products by partial name match', async () => {
    const res = await supertest(app)
      .get('/products/search?q=phone')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products.length).toBe(1);
    expect(body.products[0]!.slug).toBe('smartphone');
  });

  it('finds multiple matching products with pagination info', async () => {
    const res = await supertest(app)
      .get('/products/search?q=book')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products.length).toBe(2);
    const slugs = body.products.map((p) => p.slug).sort();
    expect(slugs).toEqual(['fiction-novel', 'history-book']);
    expect(body.total).toBe(2);
  });

  it('includes price information in results', async () => {
    const res = await supertest(app)
      .get('/products/search?q=smartphone')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products[0]!.price).toBe('29.99');
  });

  it('returns empty results for no match', async () => {
    const res = await supertest(app)
      .get('/products/search?q=zzzznotfound')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('does not include draft products', async () => {
    const res = await supertest(app)
      .get('/products/search?q=draft')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('does not include archived products', async () => {
    const res = await supertest(app)
      .get('/products/search?q=old')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(body.products).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('works without authentication (public)', async () => {
    const res = await supertest(app)
      .get('/products/search?q=phone')
      .expect(200);

    const body = res.body as PaginatedProducts;
    expect(Array.isArray(body.products)).toBe(true);
  });
});

describe('Search does not affect existing catalog endpoints', () => {
  it('GET /products still returns only active products', async () => {
    const res = await supertest(app)
      .get('/products')
      .expect(200);

    const body = res.body as PaginatedProducts;
    const slugs = body.products.map((p) => p.slug);
    expect(slugs).toContain('smartphone');
    expect(slugs).toContain('laptop');
    expect(slugs).not.toContain('draft-gadget');
    expect(slugs).not.toContain('old-product');
  });

  it('GET /products/:slug still works', async () => {
    const res = await supertest(app)
      .get('/products/smartphone')
      .expect(200);

    expect(res.body).toHaveProperty('price');
  });

  it('GET /categories still works', async () => {
    const res = await supertest(app)
      .get('/categories')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /health still works', async () => {
    const res = await supertest(app)
      .get('/health')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });
});