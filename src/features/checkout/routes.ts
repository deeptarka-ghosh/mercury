import { Router } from 'express';
import { checkout } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * POST /checkout
 * Authenticated: converts the current user's cart into an order.
 * Validates inventory, snapshots prices, and clears the cart.
 */
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const result = await checkout(userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;