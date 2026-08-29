import { Router } from 'express';
import { getCart, addToCart, updateCartItem, removeCartItem, clearCart } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * All cart endpoints require authentication.
 */

/**
 * GET /cart
 * Returns the current user's cart with items and total.
 */
router.get('/cart', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const result = await getCart(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /cart
 * Add a product to the cart (upserts quantity).
 */
router.post('/cart', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { productId, variantId, quantity } = req.body as { productId?: unknown; variantId?: unknown; quantity?: unknown };

    if (!productId || typeof productId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'productId is required' },
      });
      return;
    }

    if (quantity === undefined || quantity === null || typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive integer' },
      });
      return;
    }

    const result = await addToCart(userId, productId, quantity, variantId as string | undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /cart/:itemId
 * Update the quantity of a specific cart item.
 */
router.patch('/cart/:itemId', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { itemId } = req.params;
    if (typeof itemId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid item ID' },
      });
      return;
    }

    const { quantity } = req.body as { quantity?: unknown };

    if (quantity === undefined || quantity === null || typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive integer' },
      });
      return;
    }

    const result = await updateCartItem(userId, itemId, quantity);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /cart/:itemId
 * Remove a single item from the cart.
 */
router.delete('/cart/:itemId', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { itemId } = req.params;
    if (typeof itemId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid item ID' },
      });
      return;
    }

    await removeCartItem(userId, itemId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /cart
 * Clear all items from the current user's cart.
 */
router.delete('/cart', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    await clearCart(userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;