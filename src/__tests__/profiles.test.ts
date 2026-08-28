import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { sql } from 'kysely';
import { createApp } from '../app.js';
import { createPool, destroyPool } from '../db/pool.js';
import { createDatabase, destroyDatabase } from '../db/database.js';
import { hashPassword } from '../auth/password.js';

const testEmail = 'profiles-test@example.com';
const testPassword = 'test-password-123';

let app: ReturnType<typeof createApp>;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  const pool = createPool();
  createDatabase(pool);

  const db = (await import('../db/database.js')).getDatabase();

  // Clean up any leftover test data only
  await sql`DELETE FROM profiles WHERE user_id IN (SELECT id FROM users WHERE email = ${testEmail})`.execute(db);
  await sql`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ${testEmail})`.execute(db);
  await sql`DELETE FROM users WHERE email = ${testEmail}`.execute(db);

  // Seed user
  const passwordHash = await hashPassword(testPassword);
  const result = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES (${testEmail}, ${passwordHash}, now(), now())
    RETURNING id
  `.execute(db);
  userId = result.rows[0]!.id;

  app = createApp();

  // Login to get tokens
  const loginRes = await supertest(app)
    .post('/auth/login')
    .send({ email: testEmail, password: testPassword })
    .expect(200);

  accessToken = (loginRes.body as { accessToken: string }).accessToken;
});

afterAll(async () => {
  const db = (await import('../db/database.js')).getDatabase();
  await sql`DELETE FROM profiles WHERE user_id IN (SELECT id FROM users WHERE email = ${testEmail})`.execute(db);
  await sql`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ${testEmail})`.execute(db);
  await sql`DELETE FROM users WHERE email = ${testEmail}`.execute(db);
  await destroyDatabase();
  await destroyPool();
});

describe('GET /users/me', () => {
  it('returns profile for authenticated user', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      id: string;
      email: string;
      displayName: string | null;
      bio: string | null;
      avatarUrl: string | null;
      createdAt: string;
      updatedAt: string;
    };

    expect(body.id).toBe(userId);
    expect(body.email).toBe(testEmail);
    expect(body.displayName).toBeNull();
    expect(body.bio).toBeNull();
    expect(body.avatarUrl).toBeNull();
    expect(body.createdAt).toEqual(expect.any(String));
    expect(body.updatedAt).toEqual(expect.any(String));
  });

  it('returns 401 without auth header', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns 401 with invalid token', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
    });
  });

  it('returns 401 with malformed auth header', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', 'NotBearer something')
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid authorization header' },
    });
  });
});

describe('PATCH /users/me', () => {
  it('updates display name', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Test User' })
      .expect(200);

    const body = res.body as { displayName: string | null };
    expect(body.displayName).toBe('Test User');
  });

  it('updates bio', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bio: 'A short bio' })
      .expect(200);

    const body = res.body as { bio: string | null };
    expect(body.bio).toBe('A short bio');
  });

  it('updates avatar URL', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ avatarUrl: 'https://example.com/avatar.png' })
      .expect(200);

    const body = res.body as { avatarUrl: string | null };
    expect(body.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('clears display name by setting it to null', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: null })
      .expect(200);

    const body = res.body as { displayName: string | null };
    expect(body.displayName).toBeNull();
  });

  it('returns updated profile after multiple field change', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Full Profile', bio: 'Updated bio', avatarUrl: 'https://example.com/new-avatar.png' })
      .expect(200);

    const body = res.body as {
      displayName: string | null;
      bio: string | null;
      avatarUrl: string | null;
    };

    expect(body.displayName).toBe('Full Profile');
    expect(body.bio).toBe('Updated bio');
    expect(body.avatarUrl).toBe('https://example.com/new-avatar.png');
  });

  it('returns 401 without auth header', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .send({ displayName: 'Test' })
      .expect(401);

    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('returns 400 for non-string displayName', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 123 })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'displayName must be a string or null' },
    });
  });

  it('returns 400 for non-string bio', async () => {
    const res = await supertest(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bio: true })
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'bio must be a string or null' },
    });
  });
});

describe('GET /users/me after profile update', () => {
  it('returns saved profile data', async () => {
    const res = await supertest(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      displayName: string | null;
      bio: string | null;
      avatarUrl: string | null;
    };

    expect(body.displayName).toBe('Full Profile');
    expect(body.bio).toBe('Updated bio');
    expect(body.avatarUrl).toBe('https://example.com/new-avatar.png');
  });
});