import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './tokens.js';
import { AppError } from '../errors/AppError.js';

// Augment Express Request to carry authenticated user info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
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