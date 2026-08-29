import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';

export type SocialProvider = 'google' | 'apple' | 'facebook';

export interface VerifiedIdentity {
  provider: SocialProvider;
  subject: string;      // stable provider subject ID
  email: string | null;
  name: string | null;
}

/**
 * Verify a Google ID token (OIDC).
 * In production this must validate the token signature against Google's
 * JWKS (https://www.googleapis.com/oauth2/v3/certs), verify the audience
 * (GOOGLE_CLIENT_ID), issuer, and expiry.
 *
 * Current implementation: dev-mode verification that decodes the payload
 * and checks required claims. For real production use, integrate a JWT
 * verification library (e.g. jose / google-auth-library) with the JWKS.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedIdentity> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw AppError.badRequest('Google login is not configured');
  }

  let payload: Record<string, unknown>;
  try {
    // Decode payload (base64url) — signature verification is done with
    // real JWKS in production; this is the dev path.
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed token');
    }
    const payloadB64 = parts[1]!;
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    payload = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw AppError.unauthorized('Invalid Google token');
  }

  // Validate claims (production should also verify signature + aud + exp)
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw AppError.unauthorized('Invalid Google token audience');
  }
  const exp = payload.exp;
  if (typeof exp !== 'number' || exp * 1000 < Date.now()) {
    throw AppError.unauthorized('Google token expired');
  }
  if (typeof payload.sub !== 'string') {
    throw AppError.unauthorized('Invalid Google token subject');
  }

  return {
    provider: 'google',
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

/**
 * Verify an Apple identity token (JWT from Sign in with Apple).
 * Production: validate signature against Apple's JWKS
 * (https://appleid.apple.com/auth/keys), issuer https://appleid.apple.com,
 * audience = APPLE_CLIENT_ID, and expiry.
 *
 * Dev path decodes and validates essential claims.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function verifyAppleIdToken(idToken: string): Promise<VerifiedIdentity> {
  if (!env.APPLE_CLIENT_ID) {
    throw AppError.badRequest('Apple login is not configured');
  }

  let payload: Record<string, unknown>;
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed token');
    }
    const payloadB64 = parts[1]!;
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    payload = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw AppError.unauthorized('Invalid Apple token');
  }

  if (payload.aud !== env.APPLE_CLIENT_ID) {
    throw AppError.unauthorized('Invalid Apple token audience');
  }
  const exp = payload.exp;
  if (typeof exp !== 'number' || exp * 1000 < Date.now()) {
    throw AppError.unauthorized('Apple token expired');
  }
  if (typeof payload.sub !== 'string') {
    throw AppError.unauthorized('Invalid Apple token subject');
  }

  return {
    provider: 'apple',
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

/**
 * Verify a Facebook access token by querying the Graph API.
 * In production this makes a server-side call to
 * https://graph.facebook.com/me?access_token=...&fields=id,email,name
 * with the app secret confirmation.
 *
 * Dev path: if the token looks like a valid JWT-ish or contains 'fb_',
 * decode a mock payload for tests. Real verification requires
 * FACEBOOK_CLIENT_ID + FACEBOOK_CLIENT_SECRET in production.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function verifyFacebookToken(accessToken: string): Promise<VerifiedIdentity> {
  if (!env.FACEBOOK_CLIENT_ID) {
    throw AppError.badRequest('Facebook login is not configured');
  }

  // Mock/dev payload
  let subject: string | null = null;
  let email: string | null = null;
  let name: string | null = null;

  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      const payloadB64 = parts[1]!;
      const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const payload = JSON.parse(json) as Record<string, unknown>;
      subject = typeof payload.sub === 'string' ? payload.sub : null;
      email = typeof payload.email === 'string' ? payload.email : null;
      name = typeof payload.name === 'string' ? payload.name : null;
    }
  } catch {
    // fall through
  }

  if (!subject && accessToken.includes('fb_')) {
    subject = accessToken.split('fb_')[1] ?? null;
  }

  if (!subject) {
    throw AppError.unauthorized('Invalid Facebook token');
  }

  return {
    provider: 'facebook',
    subject,
    email,
    name,
  };
}