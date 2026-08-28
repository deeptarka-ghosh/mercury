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