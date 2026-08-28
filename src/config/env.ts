import { from } from 'env-var';
import { config } from 'dotenv';

config();

const envVar = from(process.env, {});

const validPinoLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof validPinoLevels)[number];

export const env = Object.freeze({
  NODE_ENV: envVar.get('NODE_ENV').default('development').asEnum(['development', 'production', 'test']),
  PORT: envVar.get('PORT').default('3000').asPortNumber(),
  HOST: envVar.get('HOST').default('0.0.0.0').asString(),
  LOG_LEVEL: envVar.get('LOG_LEVEL').default('info').asEnum(validPinoLevels),
  API_VERSION: envVar.get('API_VERSION').default('1').asString(),
  DATABASE_URL: envVar.get('DATABASE_URL').default('postgresql://localhost:5432/mercury_dev').asUrlString(),
  DB_POOL_SIZE: envVar.get('DB_POOL_SIZE').default('10').asIntPositive(),
  BCRYPT_ROUNDS: envVar.get('BCRYPT_ROUNDS').default('12').asIntPositive(),
  JWT_SECRET: envVar.get('JWT_SECRET').default('dev-secret-do-not-use-in-production').asString(),
  JWT_ISSUER: envVar.get('JWT_ISSUER').default('mercury').asString(),
  JWT_ACCESS_EXPIRY: envVar.get('JWT_ACCESS_EXPIRY').default('15m').asString(),
  JWT_REFRESH_EXPIRY: envVar.get('JWT_REFRESH_EXPIRY').default('7d').asString(),
  ADMIN_BOOTSTRAP_EMAIL: envVar.get('ADMIN_BOOTSTRAP_EMAIL').default('').asString(),
  ADMIN_BOOTSTRAP_PASSWORD: envVar.get('ADMIN_BOOTSTRAP_PASSWORD').default('').asString(),
});

/**
 * Validate production configuration.
 * Fails fast with a clear message so unsafe defaults are not used in production.
 * Must be called explicitly at startup — not at import time, so tests
 * can import env without triggering these checks.
 */
export function validateProductionConfig(): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (env.JWT_SECRET === 'dev-secret-do-not-use-in-production') {
    throw new Error(
      'JWT_SECRET must be set to a unique, secure value in production. ' +
      'The default development secret is not safe for production use.',
    );
  }

  if (env.DATABASE_URL === 'postgresql://localhost:5432/mercury_dev') {
    throw new Error(
      'DATABASE_URL must be configured for production. ' +
      'The default development URL is not suitable for production.',
    );
  }
}