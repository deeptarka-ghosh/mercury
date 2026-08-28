import { Router } from 'express';
import { checkout } from './service.js';
import { authenticate } from '../../auth/middleware.js';
import { rateLimit, userKey } from '../../middleware/rateLimiter.js';

const router = Router();

// Checkout is a sensitive operation — limit to 10 per minute per user
const checkoutLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyFn: userKey });

/**
 * POST /checkout
 * Authenticated: converts the current user's cart into an order.
 * Validates inventory, snapshots prices, and clears the cart.
 */
router.post('/checkout', authenticate, checkoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const result = await checkout(userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;