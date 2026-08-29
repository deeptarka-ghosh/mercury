import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase, getDatabase } from '../db/database.js';
import { sql } from 'kysely';
import { hashPassword } from '../auth/password.js';

let app: ReturnType<typeof createApp>;
let userToken: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);
  const db = getDatabase();

  await sql`DELETE FROM user_roles`.execute(db);
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

  const userPwHash = await hashPassword('test-pw');
  await sql`INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('cors-user@test.com', ${userPwHash}, now(), now())`.execute(db);

  app = createApp();

  const login = await supertest(app).post('/auth/login').send({ email: 'cors-user@test.com', password: 'test-pw' }).expect(200);
  userToken = (login.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = getDatabase();
  await sql`DELETE FROM user_roles`.execute(db);
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

const ALLOWED_ORIGIN_1 = 'http://localhost:3000';
const ALLOWED_ORIGIN_2 = 'http://localhost:3001';
const UNKNOWN_ORIGIN = 'https://evil.example.com';

describe('CORS — Allowed origins', () => {
  it('allows Store-front origin', async () => {
    const res = await supertest(app)
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN_1)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN_1);
  });

  it('allows Back-office origin', async () => {
    const res = await supertest(app)
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN_2)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN_2);
  });

  it('rejects unknown origin (no ACAO header)', async () => {
    const res = await supertest(app)
      .get('/health')
      .set('Origin', UNKNOWN_ORIGIN)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS — OPTIONS preflight', () => {
  it('preflight succeeds for allowed origin', async () => {
    const res = await supertest(app)
      .options('/health')
      .set('Origin', ALLOWED_ORIGIN_1)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization, content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN_1);
    // Should include Authorization and Content-Type
    const acah = (res.headers['access-control-allow-headers'] as string ?? '').toLowerCase();
    expect(acah).toContain('authorization');
    expect(acah).toContain('content-type');
    // Should include the methods we use
    const acam = (res.headers['access-control-allow-methods'] as string ?? '').toUpperCase();
    expect(acam).toContain('GET');
    expect(acam).toContain('POST');
    expect(acam).toContain('OPTIONS');
  });

  it('preflight for unknown origin returns no ACAO headers', async () => {
    const res = await supertest(app)
      .options('/health')
      .set('Origin', UNKNOWN_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    // cors middleware handles all OPTIONS requests; denied origins
    // still get a response but without CORS headers. The browser
    // sees no ACAO header and blocks the actual request.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });
});

describe('CORS — Normal API requests still work', () => {
  it('health endpoint works with allowed origin', async () => {
    await supertest(app)
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN_1)
      .expect(200);
  });

  it('auth endpoint works with allowed origin', async () => {
    await supertest(app)
      .post('/auth/login')
      .set('Origin', ALLOWED_ORIGIN_1)
      .send({ email: 'cors-user@test.com', password: 'test-pw' })
      .expect(200);
  });

  it('request without Origin header works (server-to-server)', async () => {
    await supertest(app)
      .get('/health')
      .expect(200);
  });

  it('authenticated request works with allowed origin', async () => {
    await supertest(app)
      .get('/users/me')
      .set('Origin', ALLOWED_ORIGIN_1)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });
});

describe('CORS does not weaken auth/RBAC', () => {
  it('unknown origin + private endpoint still returns 401', async () => {
    await supertest(app)
      .get('/users/me')
      .set('Origin', UNKNOWN_ORIGIN)
      .expect(401);
  });

  it('unknown origin + admin endpoint still returns 401', async () => {
    await supertest(app)
      .get('/admin/products')
      .set('Origin', UNKNOWN_ORIGIN)
      .expect(401);
  });

  it('allowed origin + no token still returns 401', async () => {
    await supertest(app)
      .get('/users/me')
      .set('Origin', ALLOWED_ORIGIN_1)
      .expect(401);
  });
});