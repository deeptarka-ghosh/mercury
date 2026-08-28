import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { errorHandler } from '../errors/errorHandler.js';
import { AppError } from '../errors/AppError.js';

describe('errorHandler', () => {
  const createTestApp = (throwable: (req: express.Request, _res: express.Response, _next: express.NextFunction) => void) => {
    const app = express();
    app.get('/test', throwable);
    app.use(errorHandler);
    return app;
  };

  it('returns structured response for AppError (400)', async () => {
    const app = createTestApp((_req, _res, next) => {
      next(AppError.badRequest('Invalid input'));
    });

    const response = await supertest(app).get('/test');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid input' },
    });
  });

  it('returns structured response for AppError (404)', async () => {
    const app = createTestApp((_req, _res, next) => {
      next(AppError.notFound('User not found'));
    });

    const response = await supertest(app).get('/test');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'User not found' },
    });
  });

  it('returns 500 for unknown errors without leaking internals', async () => {
    const app = createTestApp(() => {
      throw new Error('database connection failed');
    });

    const response = await supertest(app).get('/test');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' },
    });
  });
});