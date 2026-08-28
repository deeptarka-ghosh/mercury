import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/tokens.js';

const userId = '550e8400-e29b-41d4-a716-446655440000';
const userEmail = 'user@example.com';

describe('signAccessToken', () => {
  it('returns a JWT string for valid inputs', () => {
    const token = signAccessToken(userId, userEmail);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('includes email in the token payload', () => {
    const token = signAccessToken(userId, userEmail);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe(userId);
    expect(decoded.email).toBe(userEmail);
    expect(decoded.type).toBe('access');
  });
});

describe('signRefreshToken', () => {
  it('returns a JWT string', () => {
    const token = signRefreshToken(userId);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
  });

  it('does not include email in payload', () => {
    const token = signRefreshToken(userId);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe(userId);
    expect(decoded.email).toBeUndefined();
    expect(decoded.type).toBe('refresh');
  });
});

describe('verifyToken', () => {
  it('returns payload for valid access token', () => {
    const token = signAccessToken(userId, userEmail);
    const payload = verifyToken(token);
    expect(payload.sub).toBe(userId);
    expect(payload.type).toBe('access');
    if (payload.type === 'access') {
      expect(payload.email).toBe(userEmail);
    }
  });

  it('returns payload for valid refresh token', () => {
    const token = signRefreshToken(userId);
    const payload = verifyToken(token);
    expect(payload.sub).toBe(userId);
    expect(payload.type).toBe('refresh');
  });

  it('throws on tampered token', () => {
    const token = signAccessToken(userId, userEmail) + 'tampered';
    expect(() => verifyToken(token)).toThrow('Invalid token');
  });

  it('throws on garbage string', () => {
    expect(() => verifyToken('not.a.token')).toThrow('Invalid token');
  });

  it('throws on empty string', () => {
    expect(() => verifyToken('')).toThrow('Invalid token');
  });

  it('throws on expired token', () => {
    const expiredToken = jwt.sign(
      {
        sub: userId,
        iss: 'mercury',
        type: 'access',
        email: userEmail,
      },
      'dev-secret-do-not-use-in-production',
      { expiresIn: '0s' },
    );

    // Allow slight clock skew
    expect(() => verifyToken(expiredToken)).toThrow('Token expired');
  });

  it('throws when access token is used where refresh token is expected', () => {
    const token = signAccessToken(userId, userEmail);
    expect(() => verifyToken(token, 'refresh')).toThrow(
      'Invalid token type: expected refresh',
    );
  });

  it('throws when refresh token is used where access token is expected', () => {
    const token = signRefreshToken(userId);
    expect(() => verifyToken(token, 'access')).toThrow(
      'Invalid token type: expected access',
    );
  });

  it('accepts access token when no type restriction', () => {
    const token = signAccessToken(userId, userEmail);
    expect(() => verifyToken(token)).not.toThrow();
  });

  it('accepts refresh token when type matches', () => {
    const token = signRefreshToken(userId);
    const payload = verifyToken(token, 'refresh');
    expect(payload.type).toBe('refresh');
  });
});