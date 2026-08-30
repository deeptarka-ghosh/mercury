import { expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';

it('keeps public admin login and OTP verification ahead of the protected admin router', async () => {
  const app = createApp();
  const login = await supertest(app).post('/admin/auth/login').send({}).expect(400);
  expect(login.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'email and password are required' } });
  const otp = await supertest(app).post('/admin/auth/verify-otp').send({}).expect(400);
  expect(otp.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'challengeId is required' } });
});
