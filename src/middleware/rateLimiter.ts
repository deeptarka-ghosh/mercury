import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory sliding-window rate limiter.
 * Not suitable for multi-process deployments — use a shared store (Redis, DB)
 * when scaling beyond a single process.
 *
 * When NODE_ENV is 'test', the limiter allows all requests (no-op).
 * This prevents rate limits from breaking integration tests.
 *
 * Each entry key gets a `maxRequests` budget per `windowMs` window.
 * Cleanup of stale entries happens opportunistically on new requests.
 */
export function rateLimit(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
}) {
  // Skip rate limiting in test environment so integration tests are not affected
  if (process.env.NODE_ENV === 'test') {
    return function noopRateLimit(
      _req: Request,
      _res: Response,
      next: NextFunction,
    ): void {
      next();
    };
  }
  const { windowMs, maxRequests } = options;
  const keyFn = options.keyFn ?? ((req) => req.ip ?? 'unknown');
  const store = new Map<string, RateLimitEntry>();
  const cleanupThreshold = 100_000; // store size at which we trigger cleanup
  let lastCleanup = Date.now();

  return function rateLimitMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    // Opportunistic cleanup — runs periodically, not on every request
    const now = Date.now();
    if (store.size > cleanupThreshold && now - lastCleanup > 60_000) {
      lastCleanup = now;
      for (const [key, entry] of store) {
        if (entry.resetAt < now) {
          store.delete(key);
        }
      }
    }

    const key = keyFn(req);
    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      // First request or window expired
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      throw AppError.tooManyRequests('Too many requests. Please try again later.');
    }

    next();
  };
}

/**
 * Extract a user-based key from the request.
 * Falls back to IP if the user is not yet authenticated.
 */
export function userKey(req: Request): string {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip ?? 'unknown'}`;
}