import { Router } from 'express';
import { createPayment, getPayment, updatePaymentStatus } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * All payment endpoints require authentication.
 */

/**
 * POST /orders/:orderId/payments
 * Create a payment for an order. Amount is sourced from the order total.
 * Idempotent: returns 409 if a payment already exists.
 */
router.post('/orders/:orderId/payments', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const result = await createPayment(userId, orderId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders/:orderId/payments
 * Get the payment record for an order.
 */
router.get('/orders/:orderId/payments', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const result = await getPayment(userId, orderId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /orders/:orderId/payments
 * Update payment status. This is the provider-callback boundary.
 * Valid transitions: pending → completed, pending → failed.
 */
router.patch('/orders/:orderId/payments', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    if (typeof orderId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order ID' },
      });
      return;
    }

    const { status } = req.body as { status?: unknown };

    if (!status || typeof status !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'status is required' },
      });
      return;
    }

    const result = await updatePaymentStatus(userId, orderId, status);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;