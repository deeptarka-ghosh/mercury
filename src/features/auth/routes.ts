import { Router } from 'express';
import { login, register, refresh, logout, requestMobileOtp, verifyMobileOtp, verifyMobileForUser, loginWithGoogle, loginWithApple, loginWithFacebook } from './service.js';
import { authenticate } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rateLimiter.js';

const router = Router();

const authLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });
const refreshLimiter = rateLimit({ windowMs: 60_000, maxRequests: 20 });
const otpLimiter = rateLimit({ windowMs: 60_000, maxRequests: 5 });

// ===== Existing email login =====

router.post('/auth/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email and password are required' } });
      return;
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email and password must be strings' } });
      return;
    }

    const result = await register({ email, password });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email and password are required' } });
      return;
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email and password must be strings' } });
      return;
    }

    const result = await login({ email, password });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/auth/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'refreshToken is required' } });
      return;
    }
    if (typeof refreshToken !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'refreshToken must be a string' } });
      return;
    }

    const result = await refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'refreshToken is required' } });
      return;
    }
    if (typeof refreshToken !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'refreshToken must be a string' } });
      return;
    }

    await logout(refreshToken);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// ===== Mobile OTP Login =====

/**
 * POST /auth/mobile/request-otp
 * Request an OTP for a mobile number.
 */
router.post('/auth/mobile/request-otp', otpLimiter, async (req, res, next) => {
  try {
    const { mobileNumber } = req.body as { mobileNumber?: string };

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'mobileNumber is required' } });
      return;
    }

    const result = await requestMobileOtp(mobileNumber);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/mobile/verify-otp
 * Verify OTP and login/register the user.
 */
router.post('/auth/mobile/verify-otp', otpLimiter, async (req, res, next) => {
  try {
    const { mobileNumber, otp } = req.body as { mobileNumber?: string; otp?: string };

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'mobileNumber is required' } });
      return;
    }
    if (!otp || typeof otp !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'otp is required' } });
      return;
    }

    const result = await verifyMobileOtp(mobileNumber, otp);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===== Mobile Verification for Authenticated Users =====

/**
 * POST /auth/mobile/request-verification
 * Authenticated: request OTP to verify/link a mobile number.
 */
router.post('/auth/mobile/request-verification', authenticate, async (req, res, next) => {
  try {
    const { mobileNumber } = req.body as { mobileNumber?: string };

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'mobileNumber is required' } });
      return;
    }

    const result = await requestMobileOtp(mobileNumber);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/mobile/verify
 * Authenticated: verify OTP and link mobile to the current user.
 */
router.post('/auth/mobile/verify', authenticate, async (req, res, next) => {
  try {
    const { mobileNumber, otp } = req.body as { mobileNumber?: string; otp?: string };

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'mobileNumber is required' } });
      return;
    }
    if (!otp || typeof otp !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'otp is required' } });
      return;
    }

    const result = await verifyMobileForUser(req.user!.id, mobileNumber, otp);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===== Social Login =====

/**
 * POST /auth/google
 * Login with Google identity token.
 */
router.post('/auth/google', async (req, res, next) => {
  try {
    const { idToken } = req.body as { idToken?: string };

    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'idToken is required' } });
      return;
    }

    const result = await loginWithGoogle(idToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/apple
 * Login with Apple identity token.
 */
router.post('/auth/apple', async (req, res, next) => {
  try {
    const { idToken } = req.body as { idToken?: string };

    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'idToken is required' } });
      return;
    }

    const result = await loginWithApple(idToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/facebook
 * Login with Facebook access token.
 */
router.post('/auth/facebook', async (req, res, next) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };

    if (!accessToken || typeof accessToken !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'accessToken is required' } });
      return;
    }

    const result = await loginWithFacebook(accessToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;