import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

const testEmail = 'auth-test@example.com';
const testPassword = 'test-password-123';
const newEmail = 'register-test@example.com';
const newPassword = 'new-password-456';

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean up any leftover data from previous runs
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);

  // Seed a test user for login/refresh/logout tests
  const passwordHash = await hashPassword(testPassword);
  await sql`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES (${testEmail}, ${passwordHash}, now(), now())
  `.execute(db);

  app = createApp();
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM refresh_tokens`.execute(db);
  await sql`DELETE FROM users`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('POST /auth/register', () => {
  it('returns 201 with tokens for valid registration', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email: newEmail, password: newPassword })
      .expect(201);

    const body = res.body as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('id');
    expect(body.user.email).toBe(newEmail);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.user).not.toHaveProperty('password_hash');
  });

  it('returns 409 for duplicate email', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email: newEmail, password: newPassword })
      .expect(409);

    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'An account with this email already exists' },
    });
  });

  it('returns 400 when email is missing', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ password: newPassword })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
    });
  });

  it('returns 400 when password is missing', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email: newEmail })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
    });
  });

  it('returns 400 when email is not a string', async () => {
    const res = await supertest(app)
      .post('/auth/register')
      .send({ email: 123, password: newPassword })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password must be strings' },
    });
  });
});

describe('POST /auth/login', () => {
  it('returns 200 with tokens for valid credentials', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const body = res.body as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('id');
    expect(body.user.email).toBe(testEmail);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
  });

  it('returns 401 for unknown email', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'unknown@example.com', password: testPassword })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
    });
  });

  it('returns 401 for incorrect password', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: 'wrong-password' })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
    });
  });

  it('returns 400 when email is missing', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ password: testPassword })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
    });
  });

  it('returns 400 when password is missing', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
    });
  });

  it('returns 400 when email is not a string', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 123, password: testPassword })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password must be strings' },
    });
  });

  it('returns 400 when both fields are empty strings', async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: '', password: '' })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
    });
  });
});

describe('POST /auth/refresh', () => {
  it('returns 200 with new tokens for valid refresh token', async () => {
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const refreshToken = (loginRes.body as { refreshToken: string }).refreshToken;

    const res = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const body = res.body as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(testEmail);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('rejects reuse of an already-rotated refresh token', async () => {
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const refreshToken = (loginRes.body as { refreshToken: string }).refreshToken;

    await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const res = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' },
    });
  });

  it('prevents concurrent rotation of the same refresh token', async () => {
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const refreshToken = (loginRes.body as { refreshToken: string }).refreshToken;

    const [res1, res2] = await Promise.all([
      supertest(app).post('/auth/refresh').send({ refreshToken }),
      supertest(app).post('/auth/refresh').send({ refreshToken }),
    ]);

    const successCount = [res1, res2].filter((r) => r.status === 200).length;
    const failCount = [res1, res2].filter((r) => r.status === 401).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);
  });

  it('returns 401 for an invalid (garbage) token', async () => {
    const res = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-valid-refresh-token' })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' },
    });
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await supertest(app)
      .post('/auth/refresh')
      .send({})
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'refreshToken is required' },
    });
  });

  it('returns 400 when refreshToken is not a string', async () => {
    const res = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken: 123 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'refreshToken must be a string' },
    });
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 for successful logout', async () => {
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const refreshToken = (loginRes.body as { refreshToken: string }).refreshToken;

    const res = await supertest(app)
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(200);

    expect(res.body).toEqual({ message: 'Logged out successfully' });
  });

  it('rejects refresh after logout', async () => {
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const refreshToken = (loginRes.body as { refreshToken: string }).refreshToken;

    // Logout
    await supertest(app)
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(200);

    // Try to use the logged-out token
    const res = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' },
    });
  });

  it('is idempotent — logout with already-invalidated token returns 200', async () => {
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const refreshToken = (loginRes.body as { refreshToken: string }).refreshToken;

    // Logout twice
    await supertest(app)
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(200);

    const res = await supertest(app)
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(200);

    expect(res.body).toEqual({ message: 'Logged out successfully' });
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await supertest(app)
      .post('/auth/logout')
      .send({})
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'refreshToken is required' },
    });
  });

  it('returns 400 when refreshToken is not a string', async () => {
    const res = await supertest(app)
      .post('/auth/logout')
      .send({ refreshToken: 123 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'refreshToken must be a string' },
    });
  });
});

describe('full auth flow (register → login → refresh → logout)', () => {
  const flowEmail = 'flow-test@example.com';
  const flowPassword = 'flow-password';

  it('completes the full authentication lifecycle', async () => {
    // Register
    const regRes = await supertest(app)
      .post('/auth/register')
      .send({ email: flowEmail, password: flowPassword })
      .expect(201);

    const regBody = regRes.body as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
    expect(regBody.user.email).toBe(flowEmail);
    expect(regBody.accessToken).toBeDefined();
    expect(regBody.refreshToken).toBeDefined();

    // Login with same credentials
    const loginRes = await supertest(app)
      .post('/auth/login')
      .send({ email: flowEmail, password: flowPassword })
      .expect(200);

    const loginBody = loginRes.body as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
    expect(loginBody.user.id).toBe(regBody.user.id);
    expect(loginBody.user.email).toBe(flowEmail);
    expect(loginBody.refreshToken).toBeDefined();

    // Refresh
    const refreshRes = await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken: loginBody.refreshToken })
      .expect(200);

    const refreshBody = refreshRes.body as { accessToken: string; refreshToken: string };
    expect(refreshBody.accessToken).toBeDefined();
    expect(refreshBody.refreshToken).toBeDefined();

    // Logout
    const logoutRes = await supertest(app)
      .post('/auth/logout')
      .send({ refreshToken: refreshBody.refreshToken })
      .expect(200);

    expect(logoutRes.body).toEqual({ message: 'Logged out successfully' });

    // Refresh with logged-out token fails
    await supertest(app)
      .post('/auth/refresh')
      .send({ refreshToken: refreshBody.refreshToken })
      .expect(401);
  });
});