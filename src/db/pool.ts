import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let pool: pg.Pool | null = null;

export function createPool(): pg.Pool {
  if (pool) {
    return pool;
  }

  pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_SIZE,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
  });

  logger.info(
    { poolSize: env.DB_POOL_SIZE },
    'Database pool created',
  );

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
}

export async function destroyPool(): Promise<void> {
  if (!pool) {
    return;
  }

  const currentPool = pool;
  pool = null;
  logger.info('Closing database pool...');
  try {
    await currentPool.end();
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Called end on pool more than once') {
      logger.warn('Database pool already ended');
    } else {
      throw err;
    }
  }
  logger.info('Database pool closed');
}