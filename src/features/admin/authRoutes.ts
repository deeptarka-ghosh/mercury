import { Router } from 'express';
import { authenticate, requireAnyRole } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rateLimiter.js';
import { adminLogin, verifyAdminOtp, requestAdminMobileOtp, verifyAdminMobile } from './authService.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });
const otpLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });

// ===== Admin 2FA Login (Step 1) =====

/**
 * POST /admin/auth/login
 *
 * No authentication required.
 * Returns a challenge ID and masked mobile if credentials are valid.
 * Generic "Invalid credentials" for all failures (no user enumeration).
 */
router.post('/admin/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email and password are required' } });
      return;
    }

    const result = await adminLogin(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===== Admin 2FA OTP Verification (Step 2) =====

/**
 * POST /admin/auth/verify-otp
 *
 * No authentication required.
 * Verifies the OTP and issues admin tokens with admin_verified claim.
 */
router.post('/admin/auth/verify-otp', otpLimiter, async (req, res, next) => {
  try {
    const { challengeId, otp } = req.body as { challengeId?: string; otp?: string };

    if (!challengeId || typeof challengeId !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'challengeId is required' } });
      return;
    }
    if (!otp || typeof otp !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'otp is required' } });
      return;
    }

    const result = await verifyAdminOtp(challengeId, otp);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===== Admin Mobile Verification (authenticated, backend role required) =====

/**
 * POST /admin/auth/mobile/request-verification
 * Authenticated admin: request OTP to verify/change mobile number.
 */
router.post('/admin/auth/mobile/request-verification', authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin', 'user_management'), async (req, res, next) => {
  try {
    const { mobileNumber } = req.body as { mobileNumber?: string };

    if (!mobileNumber || typeof mobileNumber !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'mobileNumber is required' } });
      return;
    }

    const result = await requestAdminMobileOtp(req.user!.id, mobileNumber);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/auth/mobile/verify
 * Authenticated admin: verify OTP and link mobile number.
 */
router.post('/admin/auth/mobile/verify', authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin', 'user_management'), async (req, res, next) => {
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

    const result = await verifyAdminMobile(req.user!.id, mobileNumber, otp);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;