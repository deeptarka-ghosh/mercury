import { Router } from 'express';
import { authenticate } from '../../auth/middleware.js';
import { rateLimit, userKey } from '../../middleware/rateLimiter.js';
import { getWishlist, addToWishlist, removeFromWishlist } from './service.js';

const router = Router();

// Wishlist add is a write operation — limit to 30 per minute per user
const wishlistLimiter = rateLimit({ windowMs: 60_000, maxRequests: 30, keyFn: userKey });

/**
 * GET /wishlist
 * Authenticated: returns the current user's wishlist items.
 */
router.get('/wishlist', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const items = await getWishlist(userId);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /wishlist
 * Authenticated: add a product to the wishlist.
 */
router.post('/wishlist', authenticate, wishlistLimiter, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { productId } = req.body as { productId?: unknown };

    if (!productId || typeof productId !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'productId is required' },
      });
      return;
    }

    const item = await addToWishlist(userId, productId);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /wishlist/:productId
 * Authenticated: remove a product from the wishlist.
 */
router.delete('/wishlist/:productId', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { productId } = req.params as { productId: string };

    await removeFromWishlist(userId, productId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;