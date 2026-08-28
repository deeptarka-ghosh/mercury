import { createHash } from 'node:crypto';
import { getDatabase } from '../../db/database.js';
import { sql } from 'kysely';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { AppError } from '../../errors/AppError.js';

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
  };
}

async function buildAuthResult(
  userId: string,
  email: string,
): Promise<AuthResult> {
  const db = getDatabase();
  const accessToken = signAccessToken(userId, email);
  const refreshToken = signRefreshToken(userId);

  await db
    .insertInto('refresh_tokens')
    .values({
      user_id: userId,
      token_hash: hashRefreshToken(refreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .execute();

  return {
    accessToken,
    refreshToken,
    user: { id: userId, email },
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const db = getDatabase();
  const passwordHash = await hashPassword(input.password);

  let userId: string;
  try {
    const result = await sql<{ id: string }>`
      INSERT INTO users (email, password_hash, created_at, updated_at)
      VALUES (${input.email}, ${passwordHash}, now(), now())
      RETURNING id
    `.execute(db);
    userId = result.rows[0]!.id;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw AppError.conflict('An account with this email already exists');
    }
    throw err;
  }

  return buildAuthResult(userId, input.email);
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const db = getDatabase();

  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'password_hash'])
    .where('email', '=', input.email)
    .executeTakeFirst();

  if (!user) {
    throw AppError.unauthorized('Invalid email or password');
  }

  const passwordValid = await verifyPassword(input.password, user.password_hash);
  if (!passwordValid) {
    throw AppError.unauthorized('Invalid email or password');
  }

  return buildAuthResult(user.id, user.email);
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const db = getDatabase();
  const tokenHash = hashRefreshToken(refreshToken);

  const result = await db.transaction().execute(async (trx) => {
    const row = await sql<{
      token_id: string;
      expires_at: string;
      user_id: string;
      email: string;
    }>`
      SELECT
        rt.id AS token_id,
        rt.expires_at,
        u.id AS user_id,
        u.email
      FROM refresh_tokens rt
      INNER JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ${tokenHash}
      FOR UPDATE
    `.execute(trx);

    if (row.rows.length === 0) {
      throw AppError.unauthorized('Invalid refresh token');
    }

    const token = row.rows[0]!;

    if (new Date(token.expires_at) < new Date()) {
      await sql`DELETE FROM refresh_tokens WHERE id = ${token.token_id}`.execute(trx);
      throw AppError.unauthorized('Refresh token expired');
    }

    await sql`DELETE FROM refresh_tokens WHERE id = ${token.token_id}`.execute(trx);

    const newAccessToken = signAccessToken(token.user_id, token.email);
    const newRefreshToken = signRefreshToken(token.user_id);

    await sql`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES (${token.user_id}, ${hashRefreshToken(newRefreshToken)}, ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()})
    `.execute(trx);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: { id: token.user_id, email: token.email },
    };
  });

  return result;
}

export async function logout(refreshToken: string): Promise<void> {
  const db = getDatabase();
  const tokenHash = hashRefreshToken(refreshToken);

  await db
    .deleteFrom('refresh_tokens')
    .where('token_hash', '=', tokenHash)
    .execute();
}