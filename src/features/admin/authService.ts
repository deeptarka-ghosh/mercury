import crypto from 'node:crypto';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { verifyPassword } from '../../auth/password.js';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { getUserRoles, hasAnyBackendRole } from '../../auth/middleware.js';
import { smsProvider } from '../../integrations/sms.js';
import { env } from '../../config/env.js';

// ===== Constants =====
const CHALLENGE_EXPIRY_SECONDS = 300; // 5 minutes
const OTP_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const OTP_RATE_LIMIT_MAX = 3; // 3 login attempts per minute per user

// ===== Helpers =====

function generateOtp(): string {
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % 900000;
  return String(num + 100000);
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

// ===== Admin Login (Step 1) =====

export interface AdminLoginChallengeResult {
  challengeId: string;
  requiresOtp: true;
  maskedMobile: string;
  expiresInSeconds: number;
  developmentOtp?: string;
}

/**
 * POST /admin/auth/login
 *
 * Verify email/password, confirm the user has a backend role and a verified
 * mobile number. Create a DB-backed login challenge with a hashed OTP.
 *
 * In development, the OTP is returned for convenience (never in production).
 * In production, the OTP is sent via the configured SMS provider.
 *
 * Returns only a challenge ID and masked mobile — never confirms whether
 * an arbitrary email is a privileged account (generic error for all failures).
 */
export async function adminLogin(
  email: string,
  password: string,
): Promise<AdminLoginChallengeResult> {
  const db = getDatabase();

  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'password_hash', 'mobile_number', 'mobile_verified_at'])
    .where('email', '=', email)
    .executeTakeFirst();

  // Generic error — don't reveal if email exists
  if (!user) {
    throw AppError.unauthorized('Invalid credentials');
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    throw AppError.unauthorized('Invalid credentials');
  }

  // Verify they have at least one backend role
  const hasRole = await hasAnyBackendRole(user.id);
  if (!hasRole) {
    // Don't reveal this user exists but isn't admin — same generic error
    throw AppError.unauthorized('Invalid credentials');
  }

  // Verify mobile is verified
  if (!user.mobile_number || !user.mobile_verified_at) {
    throw AppError.forbidden('Verified mobile number required for admin login');
  }

  // Rate limit: check recent challenges for this user
  const recentChallengeCount = await db
    .selectFrom('admin_login_challenges')
    .select(sql<number>`COUNT(*)::int`.as('count'))
    .where('user_id', '=', user.id)
    .where('created_at', '>', new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MS).toISOString())
    .executeTakeFirstOrThrow();

  if (recentChallengeCount.count >= OTP_RATE_LIMIT_MAX) {
    throw AppError.tooManyRequests('Too many login attempts. Please try again later.');
  }

  // Generate challenge
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_SECONDS * 1000).toISOString();

  const insertResult = await sql<{ id: string }>`
    INSERT INTO admin_login_challenges (user_id, otp_hash, masked_mobile, expires_at, created_at)
    VALUES (${user.id}, ${otpHash}, ${maskMobile(user.mobile_number)}, ${expiresAt}, now())
    RETURNING id
  `.execute(db);

  const challengeId = insertResult.rows[0]!.id;

  await smsProvider.sendOtp({ mobileNumber: user.mobile_number, otp, expiresInSeconds: CHALLENGE_EXPIRY_SECONDS });

  return {
    challengeId,
    requiresOtp: true,
    maskedMobile: maskMobile(user.mobile_number),
    expiresInSeconds: CHALLENGE_EXPIRY_SECONDS,
    ...(env.NODE_ENV === 'production' ? {} : { developmentOtp: otp }),
  };
}

// ===== OTP Verification (Step 2) =====

export interface AdminOtpVerifyResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    mobileNumber: string | null;
    mobileVerified: boolean;
    roles: string[];
  };
}

/**
 * POST /admin/auth/verify-otp
 *
 * Verify the OTP for a challenge. On success:
 * - Atomically marks the challenge as verified (prevents replay)
 * - Issues access token with admin_verified claim
 * - Issues refresh token
 *
 * Failures increment the attempt counter. After max_attempts, the challenge
 * is revoked and a new login is required.
 */
export async function verifyAdminOtp(
  challengeId: string,
  otp: string,
): Promise<AdminOtpVerifyResult> {
  const db = getDatabase();

  const result = await db.transaction().execute(async (trx) => {
    const challenge = await trx
      .selectFrom('admin_login_challenges')
      .select([
        'admin_login_challenges.id',
        'admin_login_challenges.user_id',
        'admin_login_challenges.otp_hash',
        'admin_login_challenges.attempts',
        'admin_login_challenges.max_attempts',
        'admin_login_challenges.expires_at',
        'admin_login_challenges.verified_at',
        'admin_login_challenges.revoked_at',
      ])
      .where('id', '=', challengeId)
      .forUpdate()
      .executeTakeFirst();

    if (!challenge) {
      throw AppError.badRequest('Invalid challenge');
    }

    // Check if already verified (replay prevention)
    if (challenge.verified_at) {
      throw AppError.badRequest('Challenge already used');
    }

    // Check if revoked
    if (challenge.revoked_at) {
      throw AppError.badRequest('Challenge revoked');
    }

    // Check expiry
    if (new Date(challenge.expires_at) < new Date()) {
      await trx
        .updateTable('admin_login_challenges')
        .set({ revoked_at: sql`now()` })
        .where('id', '=', challengeId)
        .execute();
      throw AppError.badRequest('Challenge expired');
    }

    // Check remaining attempts
    const remaining = challenge.max_attempts - challenge.attempts;
    if (remaining <= 0) {
      await trx
        .updateTable('admin_login_challenges')
        .set({ revoked_at: sql`now()` })
        .where('id', '=', challengeId)
        .execute();
      throw AppError.tooManyRequests('Too many failed attempts. Please login again.');
    }

    // Verify OTP hash
    const otpHash = hashOtp(otp);
    if (challenge.otp_hash !== otpHash) {
      await trx
        .updateTable('admin_login_challenges')
        .set({ attempts: challenge.attempts + 1 })
        .where('id', '=', challengeId)
        .execute();
      throw AppError.badRequest('Invalid OTP');
    }

    // Success — atomically consume challenge
    await trx
      .updateTable('admin_login_challenges')
      .set({ verified_at: sql`now()`, attempts: challenge.attempts + 1 })
      .where('id', '=', challengeId)
      .execute();

    // Fetch user and roles
    const user = await trx
      .selectFrom('users')
      .select(['id', 'email', 'mobile_number', 'mobile_verified_at'])
      .where('id', '=', challenge.user_id)
      .executeTakeFirstOrThrow();

    const roles = await getUserRoles(user.id);

    // Issue tokens with admin_verified claim
    const accessToken = signAccessToken(user.id, user.email, true);
    const refreshToken = signRefreshToken(user.id);

    // Store refresh token
    await trx
      .insertInto('refresh_tokens')
      .values({
        user_id: user.id,
        token_hash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .execute();

    // Audit successful login
    const { recordAudit } = await import('../admin/service.js');
    await recordAudit(user.id, 'admin.login', 'auth', null, {
      challengeId,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        mobileNumber: user.mobile_number ?? null,
        mobileVerified: user.mobile_verified_at !== null && user.mobile_number !== null,
        roles,
      },
    };
  });

  return result;
}

// ===== Admin Mobile Verification =====

/**
 * Request OTP for an admin to verify/change their mobile number.
 * Uses the existing customer OTP mechanism but requires backend role.
 */
export async function requestAdminMobileOtp(
  userId: string,
  mobileNumber: string,
): Promise<{ message: string; expiresInSeconds: number }> {
  const { normalizeMobile } = await import('../auth/service.js');
  const { requestOtp } = await import('../auth/otp.js');

  const normalized = normalizeMobile(mobileNumber);
  const result = requestOtp(normalized);

  await smsProvider.sendOtp({ mobileNumber: normalized, otp: result.otp, expiresInSeconds: result.expiresInSeconds });

  return { message: 'OTP sent', expiresInSeconds: result.expiresInSeconds };
}

/**
 * Verify OTP and link mobile number to the admin user.
 */
export async function verifyAdminMobile(
  userId: string,
  mobileNumber: string,
  otp: string,
): Promise<{ mobileNumber: string; mobileVerified: boolean }> {
  const db = getDatabase();
  const { normalizeMobile } = await import('../auth/service.js');
  const { verifyOtp, clearOtp } = await import('../auth/otp.js');

  const normalized = normalizeMobile(mobileNumber);
  verifyOtp(normalized, otp);

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

  const { recordAudit } = await import('../admin/service.js');
  await recordAudit(userId, 'admin.mobile_verified', 'auth', userId, {
    mobile: maskMobile(normalized),
  });

  return { mobileNumber: normalized, mobileVerified: true };
}
