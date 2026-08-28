import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/password.js';

describe('password hashing', () => {
  it('hashes a password and returns a string', async () => {
    const hash = await hashPassword('my-secret-password');
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(50);
  });

  it('verifies correct password against its hash', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hashPassword(password);
    const result = await verifyPassword(password, hash);
    expect(result).toBe(true);
  });

  it('rejects incorrect password', async () => {
    const hash = await hashPassword('real-password');
    const result = await verifyPassword('wrong-password', hash);
    expect(result).toBe(false);
  });

  it('rejects empty password against real hash', async () => {
    const hash = await hashPassword('something');
    const result = await verifyPassword('', hash);
    expect(result).toBe(false);
  });

  it('generates different hashes for the same password', async () => {
    const password = 'same-password';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });
});