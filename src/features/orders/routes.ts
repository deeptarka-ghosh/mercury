import { Router } from 'express';
import { listOrders, getOrder } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * All orders endpoints require authentication.
 */

/**
 * GET /orders
 * Lists the authenticated user's orders, most recent first.
 */
router.get('/orders', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const orders = await listOrders(userId, limit, offset);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders/:orderId
 * Returns a single order with its items. Ownership-scoped.
 */
router.get('/orders/:orderId', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const order = await getOrder(userId, orderId);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

export default router;