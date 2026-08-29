import { createHash } from 'node:crypto';
import { getDatabase } from '../../db/database.js';
import { sql } from 'kysely';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { AppError } from '../../errors/AppError.js';
import { requestOtp, verifyOtp, clearOtp } from './otp.js';
import { verifyGoogleIdToken, verifyAppleIdToken, verifyFacebookToken } from './social.js';
import type { SocialProvider } from './social.js';

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
    mobileNumber: string | null;
    mobileVerified: boolean;
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

  const user = await db.selectFrom('users').select(['mobile_number', 'mobile_verified_at']).where('id', '=', userId).executeTakeFirst();

  return {
    accessToken,
    refreshToken,
    user: {
      id: userId,
      email,
      mobileNumber: user?.mobile_number ?? null,
      mobileVerified: user?.mobile_verified_at !== null && user?.mobile_number !== null,
    },
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
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw AppError.conflict('An account with this email already exists');
    }
    throw err;
  }

  // Link email identity
  await db.insertInto('user_identities').values({
    user_id: userId,
    provider: 'email',
    provider_subject: input.email,
    provider_email: input.email,
  }).execute();

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

/**
 * Normalize a mobile number to E.164 format.
 * Strips non-digits, adds + prefix if missing.
 */
export function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 0) {
    throw AppError.badRequest('Invalid mobile number');
  }
  // If it starts with country code without +, prepend +
  return `+${digits}`;
}

/**
 * Request an OTP for a mobile number.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function requestMobileOtp(mobileNumber: string): Promise<{ message: string; expiresInSeconds: number }> {
  const normalized = normalizeMobile(mobileNumber);

  const result = requestOtp(normalized);
  // In production, send SMS via configured provider
  // For now, log to stdout (dev log provider)

  return { message: 'OTP sent', expiresInSeconds: result.expiresInSeconds };
}

/**
 * Verify OTP and login/register the user.
 * If the mobile number is new, creates a user. If existing, logs in.
 */
export async function verifyMobileOtp(
  mobileNumber: string,
  otp: string,
): Promise<AuthResult> {
  const normalized = normalizeMobile(mobileNumber);
  verifyOtp(normalized, otp);

  const db = getDatabase();

  // Check if user with this verified mobile exists
  const existingUser = await db
    .selectFrom('users')
    .select(['id', 'email'])
    .where('mobile_number', '=', normalized)
    .where('mobile_verified_at', 'is not', null)
    .executeTakeFirst();

  if (existingUser) {
    clearOtp(normalized);
    return buildAuthResult(existingUser.id, existingUser.email);
  }

  // New user — create with mobile number
  const email = `mobile-${normalized.replace(/[^0-9]/g, '')}@mercury.local`;
  const result = await sql<{ id: string }>`
    INSERT INTO users (email, mobile_number, mobile_verified_at, created_at, updated_at)
    VALUES (${email}, ${normalized}, now(), now(), now())
    RETURNING id
  `.execute(db);

  const userId = result.rows[0]!.id;

  // Link mobile identity
  await db.insertInto('user_identities').values({
    user_id: userId,
    provider: 'mobile',
    provider_subject: normalized,
    provider_email: null,
  }).execute();

  clearOtp(normalized);
  return buildAuthResult(userId, email);
}

/**
 * Verify mobile for an already authenticated user (link mobile to existing account).
 */
export async function verifyMobileForUser(
  userId: string,
  mobileNumber: string,
  otp: string,
): Promise<{ mobileNumber: string; mobileVerified: boolean }> {
  const normalized = normalizeMobile(mobileNumber);
  verifyOtp(normalized, otp);

  const db = getDatabase();

  // Prevent another user from claiming this verified mobile
  const existing = await db
    .selectFrom('users')
    .select(['id'])
    .where('mobile_number', '=', normalized)
    .where('mobile_verified_at', 'is not', null)
    .executeTakeFirst();

  if (existing && existing.id !== userId) {
    throw AppError.conflict('This mobile number is already associated with another account');
  }

  await db
    .updateTable('users')
    .set({ mobile_number: normalized, mobile_verified_at: sql`now()`, updated_at: sql`now()` })
    .where('id', '=', userId)
    .execute();

  clearOtp(normalized);
  return { mobileNumber: normalized, mobileVerified: true };
}

/**
 * Social login handler — verify provider token, find or create user, return auth result.
 */
async function socialLogin(
  provider: SocialProvider,
  subject: string,
  email: string | null,
): Promise<AuthResult> {
  const db = getDatabase();

  // Look for existing identity
  const existingIdentity = await db
    .selectFrom('user_identities')
    .innerJoin('users', 'users.id', 'user_identities.user_id')
    .select(['user_identities.user_id', 'users.email'])
    .where('user_identities.provider', '=', provider)
    .where('user_identities.provider_subject', '=', subject)
    .executeTakeFirst();

  if (existingIdentity) {
    return buildAuthResult(existingIdentity.user_id, existingIdentity.email);
  }

  // Identity not found — create new user
  const userEmail = email ?? `social-${provider}-${subject.slice(0, 12)}@mercury.local`;
  const userResult = await sql<{ id: string }>`
    INSERT INTO users (email, created_at, updated_at)
    VALUES (${userEmail}, now(), now())
    RETURNING id
  `.execute(db);

  const userId = userResult.rows[0]!.id;

  // Link identity
  await db.insertInto('user_identities').values({
    user_id: userId,
    provider,
    provider_subject: subject,
    provider_email: email,
  }).execute();

  return buildAuthResult(userId, userEmail);
}

/**
 * Login with Google.
 */
export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  const identity = await verifyGoogleIdToken(idToken);
  return socialLogin('google', identity.subject, identity.email);
}

/**
 * Login with Apple.
 */
export async function loginWithApple(idToken: string): Promise<AuthResult> {
  const identity = await verifyAppleIdToken(idToken);
  return socialLogin('apple', identity.subject, identity.email);
}

/**
 * Login with Facebook.
 */
export async function loginWithFacebook(accessToken: string): Promise<AuthResult> {
  const identity = await verifyFacebookToken(accessToken);
  return socialLogin('facebook', identity.subject, identity.email);
}

export { refresh, logout } from './service_core.js';