import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  adminVerified?: boolean;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

export type TokenPayload = AccessTokenPayload | RefreshTokenPayload;

interface JwtClaims {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
  email?: string;
  admin_verified?: boolean;
}

export function signAccessToken(userId: string, email: string, adminVerified = false): string {
  const payload: Omit<JwtClaims, 'iat' | 'exp'> = {
    sub: userId,
    iss: env.JWT_ISSUER,
    type: 'access',
    email,
    ...(adminVerified ? { admin_verified: true } : {}),
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY as `${number}${'s' | 'm' | 'h' | 'd'}`,
  });
}

export function signRefreshToken(userId: string): string {
  const payload: Omit<JwtClaims, 'iat' | 'exp'> & { jti?: string } = {
    sub: userId,
    iss: env.JWT_ISSUER,
    type: 'refresh',
    jti: crypto.randomUUID(),
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY as `${number}${'s' | 'm' | 'h' | 'd'}`,
  });
}

/**
 * Verifies and decodes a JWT. Optionally enforces the expected token type.
 * Throws AppError on invalid token, expired token, or type mismatch.
 */
export function verifyToken(token: string, expectedType?: 'access' | 'refresh'): TokenPayload {
  let decoded: JwtClaims;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
    }) as JwtClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Token expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw AppError.unauthorized('Invalid token');
    }
    throw err;
  }

  if (expectedType && decoded.type !== expectedType) {
    throw AppError.unauthorized(`Invalid token type: expected ${expectedType}`);
  }

  if (decoded.type === 'access' && decoded.email) {
    return { sub: decoded.sub, email: decoded.email, type: 'access', adminVerified: decoded.admin_verified ?? false };
  }

  if (decoded.type === 'refresh') {
    return { sub: decoded.sub, type: 'refresh' };
  }

  throw AppError.unauthorized('Invalid token type');
}