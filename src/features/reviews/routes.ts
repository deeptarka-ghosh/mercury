import { Router } from 'express';
import { authenticate } from '../../auth/middleware.js';
import {
  createReview,
  getProductReviews,
  getMyReviews,
  updateMyReview,
  deleteMyReview,
} from './service.js';

const router = Router();

/**
 * POST /products/:slug/reviews
 * Authenticated: create a review for an active product.
 */
router.post('/products/:slug/reviews', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const slug = req.params.slug as string;
    const { rating, content } = req.body as { rating?: unknown; content?: unknown };

    if (rating === undefined || rating === null) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'rating is required' },
      });
      return;
    }

    if (typeof rating !== 'number' || !Number.isInteger(rating)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'rating must be an integer' },
      });
      return;
    }

    if (content !== undefined && content !== null && typeof content !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'content must be a string' },
      });
      return;
    }

    if (typeof content === 'string' && content.length > 5000) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'content must be at most 5000 characters' },
      });
      return;
    }

    const reviewContent: string | null =
      content === undefined || content === null ? null : content;

    const result = await createReview(userId, slug, rating, reviewContent);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /products/:slug/reviews
 * Public: get reviews for an active product, with aggregate rating.
 */
router.get('/products/:slug/reviews', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const result = await getProductReviews(slug);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /account/reviews
 * Authenticated: get the current user's reviews.
 */
router.get('/account/reviews', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const result = await getMyReviews(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /account/reviews/:reviewId
 * Authenticated: update the current user's own review.
 */
router.patch('/account/reviews/:reviewId', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const reviewId = req.params.reviewId as string;
    const { rating, content } = req.body as { rating?: unknown; content?: unknown };

    if (rating !== undefined) {
      if (typeof rating !== 'number' || !Number.isInteger(rating)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'rating must be an integer' },
        });
        return;
      }
    }

    if (content !== undefined && content !== null && typeof content !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'content must be a string or null' },
      });
      return;
    }

    if (typeof content === 'string' && content.length > 5000) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'content must be at most 5000 characters' },
      });
      return;
    }

    if (rating === undefined && content === undefined) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Nothing to update' },
      });
      return;
    }

    const result = await updateMyReview(userId, reviewId, rating, content);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /account/reviews/:reviewId
 * Authenticated: delete the current user's own review.
 */
router.delete('/account/reviews/:reviewId', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const reviewId = req.params.reviewId as string;

    await deleteMyReview(userId, reviewId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;