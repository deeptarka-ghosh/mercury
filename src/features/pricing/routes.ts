import { Router } from 'express';
import { getPrice, setPrice } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * GET /products/:slug/price
 * Public: returns the price for an active product.
 */
router.get('/products/:slug/price', async (req, res, next) => {
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
    const result = await getPrice(slug);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /products/:slug/price
 * Authenticated: sets the price for a product.
 */
router.put('/products/:slug/price', authenticate, async (req, res, next) => {
  try {
    const { amount } = req.body as { amount?: unknown };

    if (amount === undefined || amount === null) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'amount is required',
        },
      });
      return;
    }

    if (typeof amount !== 'number') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'amount must be a number',
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

    const result = await setPrice(slug, amount);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;