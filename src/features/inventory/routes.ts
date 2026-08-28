import { Router } from 'express';
import { getInventory, setInventory } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * GET /products/:slug/inventory
 * Public: returns stock status for an active product.
 */
router.get('/products/:slug/inventory', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    if (typeof slug !== 'string') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid product slug',
        },
      });
      return;
    }
    const result = await getInventory(slug);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /products/:slug/inventory
 * Authenticated: sets the absolute stock quantity for a product.
 */
router.put('/products/:slug/inventory', authenticate, async (req, res, next) => {
  try {
    const { quantity } = req.body as { quantity?: unknown };

    if (quantity === undefined || quantity === null) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'quantity is required',
        },
      });
      return;
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'quantity must be an integer',
        },
      });
      return;
    }

    const slug = req.params.slug;
    if (typeof slug !== 'string') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid product slug',
        },
      });
      return;
    }
    const result = await setInventory(slug, quantity);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;