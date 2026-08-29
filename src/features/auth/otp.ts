import crypto from 'node:crypto';

/**
 * In-memory OTP store.
 *
 * OTPs are stored only in memory — never persisted to the database or logs.
 * Production deployments should not rely on process restart to clear OTPs;
 * the short expiry window (5 minutes) makes this acceptable for a single-process
 * deployment. For multi-process deployments, replace with a shared store (Redis).
 */

interface OtpEntry {
  otpHash: string;       // SHA-256 of the OTP
  expiresAt: number;      // epoch ms
  attempts: number;       // failed attempts
  verified: boolean;      // set to true on successful verification
}

const store = new Map<string, OtpEntry>();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const OTP_VALIDITY_MS = 5 * 60 * 1000;   // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;     // 30 seconds
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_MOBILE = 10;       // per rolling window

// Rate-limit tracking
const requestCounts = new Map<string, { count: number; windowStart: number }>();
const OTP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt < now) {
        store.delete(key);
      }
    }
    for (const [key, entry] of requestCounts) {
      if (entry.windowStart < now - OTP_RATE_WINDOW_MS) {
        requestCounts.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

startCleanup();

/**
 * Generate a secure 6-digit OTP.
 */
function generateOtp(): string {
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % 900000;
  return String(num + 100000);
}

/**
 * Request an OTP for a mobile number.
 * Returns the OTP (in dev) or a success indicator.
 * In production, the OTP would be sent via SMS.
 */
export function requestOtp(mobileNumber: string): { otp: string; expiresInSeconds: number } {
  const now = Date.now();

  // Rate limit: check requests per mobile
  const rateKey = `rate:${mobileNumber}`;
  const rateEntry = requestCounts.get(rateKey);
  if (rateEntry && rateEntry.windowStart > now - OTP_RATE_WINDOW_MS) {
    if (rateEntry.count >= MAX_REQUESTS_PER_MOBILE) {
      throw Object.assign(new Error('Too many OTP requests. Please try again later.'), { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
    }
    rateEntry.count++;
  } else {
    requestCounts.set(rateKey, { count: 1, windowStart: now });
  }

  // Resend cooldown
  const existing = store.get(mobileNumber);
  if (existing && existing.expiresAt > now) {
    const elapsed = now - (existing.expiresAt - OTP_VALIDITY_MS);
    if (elapsed < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw Object.assign(new Error(`Please wait ${retryAfter}s before requesting a new OTP`), { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
    }
  }

  const otp = generateOtp();
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

  store.set(mobileNumber, {
    otpHash,
    expiresAt: now + OTP_VALIDITY_MS,
    attempts: 0,
    verified: false,
  });

  return { otp, expiresInSeconds: OTP_VALIDITY_MS / 1000 };
}

/**
 * Verify an OTP for a mobile number.
 * Returns true on success, throws on failure.
 */
export function verifyOtp(mobileNumber: string, otp: string): void {
  const now = Date.now();
  const entry = store.get(mobileNumber);

  if (!entry) {
    throw Object.assign(new Error('No OTP requested for this number'), { statusCode: 400, code: 'BAD_REQUEST' });
  }

  if (entry.verified) {
    throw Object.assign(new Error('OTP already used'), { statusCode: 400, code: 'BAD_REQUEST' });
  }

  if (entry.expiresAt < now) {
    store.delete(mobileNumber);
    throw Object.assign(new Error('OTP has expired. Please request a new one.'), { statusCode: 400, code: 'BAD_REQUEST' });
  }

  entry.attempts++;
  if (entry.attempts > MAX_ATTEMPTS) {
    store.delete(mobileNumber);
    throw Object.assign(new Error('Too many failed attempts. Please request a new OTP.'), { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
  }

  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
  if (entry.otpHash !== otpHash) {
    throw Object.assign(new Error('Invalid OTP'), { statusCode: 400, code: 'BAD_REQUEST' });
  }

  entry.verified = true;
  // Keep the entry briefly to prevent replay, then it will be cleaned up
}

/**
 * Check if a mobile number has a currently valid, verified OTP.
 */
export function isOtpVerified(mobileNumber: string): boolean {
  const entry = store.get(mobileNumber);
  return !!entry && entry.verified && entry.expiresAt > Date.now();
}

/**
 * Clear OTP state for a mobile number (used after successful verification flow completes).
 */
export function clearOtp(mobileNumber: string): void {
  store.delete(mobileNumber);
}

/**
 * For testing: reset all OTP state.
 */
export function resetOtpStore(): void {
  store.clear();
  requestCounts.clear();
}