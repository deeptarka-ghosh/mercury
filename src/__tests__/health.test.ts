import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';

describe('GET /health', () => {
  it('returns 200 with correct response shape', async () => {
    const app = createApp();
    const response = await supertest(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      version: '1',
    });
    const body = response.body as { status: string; uptime: number; timestamp: string; version: string };
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.timestamp).toBe('string');
    expect(body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });
});