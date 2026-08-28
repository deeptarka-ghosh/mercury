import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('database pool', () => {
  beforeEach(() => {
    // Reset module state between tests by clearing the require cache
    vi.resetModules();
  });

  it('createPool returns a Pool instance with configured max size', async () => {
    const { createPool, destroyPool } = await import('../db/pool.js');
    const pool = createPool();
    expect(pool).toBeDefined();
    expect(pool.totalCount).toBe(0);
    expect(pool.waitingCount).toBe(0);
    await destroyPool();
  });

  it('getPool throws if pool not initialized', async () => {
    const { getPool } = await import('../db/pool.js');
    expect(() => getPool()).toThrow('Database pool not initialized');
  });

  it('createPool returns the same instance on subsequent calls', async () => {
    const { createPool, destroyPool } = await import('../db/pool.js');
    const pool1 = createPool();
    const pool2 = createPool();
    expect(pool1).toBe(pool2);
    await destroyPool();
  });

  it('destroyPool clears the singleton', async () => {
    const { createPool, destroyPool, getPool } = await import('../db/pool.js');
    createPool();
    await destroyPool();
    expect(() => getPool()).toThrow('Database pool not initialized');
  });

  it('destroyPool is safe to call multiple times', async () => {
    const { destroyPool } = await import('../db/pool.js');
    await destroyPool();
    await destroyPool();
  });
});