import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './tokens.js';
import { AppError } from '../errors/AppError.js';
import { getDatabase } from '../db/database.js';

// Augment Express Request to carry authenticated user info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role?: string;
      };
    }
  }
}

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw AppError.unauthorized('Authentication required');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw AppError.unauthorized('Invalid authorization header');
    }

    const token = parts[1];
    if (!token) {
      throw AppError.unauthorized('Invalid authorization header');
    }

    const payload = verifyToken(token, 'access') as { sub: string; email: string; type: 'access' };

    req.user = {
      id: payload.sub,
      email: payload.email,
    };

    next();
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * Authorization middleware factory.
 * Must be used after `authenticate`.
 * Looks up the user's role from the database (server-authoritative)
 * and verifies it matches one of the allowed roles.
 */
export function authorize(...allowedRoles: string[]) {
  return async function authorizeMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        throw AppError.unauthorized('Authentication required');
      }

      const db = getDatabase();
      const user = await db
        .selectFrom('users')
        .select(['role'])
        .where('users.id', '=', req.user.id)
        .executeTakeFirst();

      if (!user) {
        throw AppError.unauthorized('User not found');
      }

      if (!allowedRoles.includes(user.role)) {
        throw AppError.forbidden('Insufficient permissions');
      }

      // Attach role to req.user for downstream use
      req.user.role = user.role;

      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}