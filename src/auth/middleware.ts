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
        adminVerified?: boolean;
      };
    }
  }
}

const BACKEND_ROLES = new Set([
  'backend_read',
  'backend_write',
  'backend_admin',
  'user_management',
]);

/**
 * Returns true if the given role name is a known backend role.
 */
export function isBackendRole(role: string): boolean {
  return BACKEND_ROLES.has(role);
}

/**
 * Fetch a user's assigned role names from the database.
 * Server-authoritative — always reads fresh from DB, never from JWT.
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .select('roles.name')
    .where('user_roles.user_id', '=', userId)
    .execute();

  return rows.map((r) => r.name);
}

/**
 * Check whether a user has any backend roles at all.
 */
export async function hasAnyBackendRole(userId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  return roles.some((r) => BACKEND_ROLES.has(r));
}

/**
 * Authenticate middleware.
 *
 * Verifies the JWT access token and attaches user identity to req.user.
 * Also checks if the user account has been disabled.
 * Does NOT check roles — that's done by the authorization middleware.
 *
 * Returns 401 if the token is missing, invalid, expired, or user is disabled.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
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

    const payload = verifyToken(token, 'access') as { sub: string; email: string; type: 'access'; adminVerified?: boolean };

    // Check if user is disabled
    const db = getDatabase();
    const user = await db
      .selectFrom('users')
      .select(['id', 'status'])
      .where('id', '=', payload.sub)
      .executeTakeFirst();

    if (!user) {
      throw AppError.unauthorized('User not found');
    }

    if (user.status === 'disabled') {
      throw AppError.forbidden('Account is disabled');
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      adminVerified: payload.adminVerified ?? false,
    };

    next();
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * Middleware factory: require the user to have ALL specified backend roles.
 *
 * Must be used after `authenticate`.
 * Looks up roles from the database on every request (server-authoritative).
 *
 * Returns:
 *   401 if not authenticated
 *   403 if authenticated but missing any required role
 */
export function requireAllRoles(...requiredRoles: string[]) {
  return async function requireAllRolesMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        throw AppError.unauthorized('Authentication required');
      }

      const roles = await getUserRoles(req.user.id);
      const roleSet = new Set(roles);

      for (const role of requiredRoles) {
        if (!roleSet.has(role)) {
          throw AppError.forbidden('Insufficient permissions');
        }
      }

      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

/**
 * Middleware factory: require the user to have ANY of the specified backend roles.
 *
 * Must be used after `authenticate`.
 * Looks up roles from the database on every request (server-authoritative).
 *
 * Returns:
 *   401 if not authenticated
 *   403 if authenticated but none of the required roles are held
 */
export function requireAnyRole(...requiredRoles: string[]) {
  return async function requireAnyRoleMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        throw AppError.unauthorized('Authentication required');
      }

      const roles = await getUserRoles(req.user.id);

      if (!roles.some((r) => requiredRoles.includes(r))) {
        throw AppError.forbidden('Insufficient permissions');
      }

      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

/**
 * Require the access token to have been issued through the admin 2FA flow.
 * Customer tokens (without admin_verified) are rejected.
 */
export function requireAdminVerification(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  if (!req.user.adminVerified) {
    next(AppError.forbidden('Admin two-factor authentication required'));
    return;
  }

  next();
}

/**
 * @deprecated Use requireAllRoles / requireAnyRole with specific role names.
 * Kept for backward compatibility during transition.
 */
export function authorize(...allowedRoles: string[]) {
  return requireAnyRole(...allowedRoles);
}