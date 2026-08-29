import { createHash } from 'node:crypto';
import { getDatabase } from '../../db/database.js';
import { sql } from 'kysely';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { AppError } from '../../errors/AppError.js';

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Refresh an access token using a refresh token.
 * Returns full auth result with mobile info.
 */
export async function refresh(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; mobileNumber: string | null; mobileVerified: boolean };
}> {
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

    // Fetch mobile info
    const user = await db.selectFrom('users').select(['mobile_number', 'mobile_verified_at']).where('id', '=', token.user_id).executeTakeFirst();

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: token.user_id,
        email: token.email,
        mobileNumber: user?.mobile_number ?? null,
        mobileVerified: user?.mobile_verified_at !== null && user?.mobile_number !== null,
      },
    };
  });

  return result;
}

/**
 * Logout: invalidate a refresh token.
 */
export async function logout(refreshToken: string): Promise<void> {
  const db = getDatabase();
  const tokenHash = hashRefreshToken(refreshToken);

  await db
    .deleteFrom('refresh_tokens')
    .where('token_hash', '=', tokenHash)
    .execute();
}