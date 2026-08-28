import { Router } from 'express';
import { createShipping, getShipping, updateShipping } from './service.js';
import type { ShippingInput } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * All shipping endpoints require authentication.
 */

/**
 * POST /orders/:orderId/shipping
 * Create shipping information for an order.
 */
router.post('/orders/:orderId/shipping', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const body = req.body as ShippingInput;
    const result = await createShipping(userId, orderId, body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders/:orderId/shipping
 * Get shipping information for an order.
 */
router.get('/orders/:orderId/shipping', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const result = await getShipping(userId, orderId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /orders/:orderId/shipping
 * Update shipping information. Only allowed if shipping status is 'pending'.
 */
router.patch('/orders/:orderId/shipping', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const body = req.body as ShippingInput;
    const result = await updateShipping(userId, orderId, body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;