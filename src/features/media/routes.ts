import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireAnyRole } from '../../auth/middleware.js';
import { getProductBySlug } from '../catalog/service.js';
import { uploadMedia, deleteMedia, listMedia, reorderProductMedia, getMediaUrl } from './service.js';
import { getMediaPolicy } from './validation.js';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { recordAudit } from '../admin/service.js';

const router = Router();

// Multer setup: store in memory so we can validate before writing to disk
const limits = getMediaPolicy();
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(limits.maxImageSizeBytes, limits.maxVideoSizeBytes),
  },
});

// ===================== Product Media (Admin) =====================

// Upload & reorder require backend_write or higher. Delete requires backend_admin.
const mediaWriteAuth = [authenticate, requireAnyRole('backend_write', 'backend_admin')];
const mediaDeleteAuth = [authenticate, requireAnyRole('backend_admin')];

/**
 * Verify a product exists by ID (used by admin product media routes).
 */
async function verifyProductExists(productId: string): Promise<void> {
  const db = getDatabase();
  const exists = await db
    .selectFrom('products')
    .select('id')
    .where('id', '=', productId)
    .executeTakeFirst();

  if (!exists) {
    throw AppError.notFound('Product not found');
  }
}

/**
 * POST /admin/products/:productId/media
 * Admin-only: upload media for a product.
 * Accepts multipart/form-data with a single 'file' field.
 */
router.post('/admin/products/:productId/media', ...mediaWriteAuth, uploadMiddleware.single('file'), async (req, res, next) => {
  try {
    const productId = req.params.productId as string;
    const userId = req.user!.id;

    await verifyProductExists(productId);

    if (!req.file) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'File is required. Use field name "file".' },
      });
      return;
    }

    const result = await uploadMedia(userId, 'product', productId, req.file.originalname, req.file.mimetype, req.file.buffer);
    await recordAudit(userId, 'media.upload', 'media', result.id, {
      entityType: 'product',
      entityId: productId,
      fileType: result.fileType,
      fileSize: result.fileSize,
    });
    res.status(201).json({
      ...result,
      url: getMediaUrl(result.storagePath),
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the maximum allowed size' },
      });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /admin/products/:productId/media/:mediaId
 * Admin-only: delete media from a product.
 */
router.delete('/admin/products/:productId/media/:mediaId', ...mediaDeleteAuth, async (req, res, next) => {
  try {
    const mediaId = req.params.mediaId as string;
    await deleteMedia(req.user!.id, 'backend_admin', mediaId);
    await recordAudit(req.user!.id, 'media.delete', 'media', mediaId, {
      productId: req.params.productId,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/products/:productId/media/reorder
 * Admin-only: reorder product media.
 * Body: { mediaIds: string[] } — ordered array of media IDs.
 */
router.put('/admin/products/:productId/media/reorder', ...mediaWriteAuth, async (req, res, next) => {
  try {
    const productId = req.params.productId as string;
    const { mediaIds } = req.body as { mediaIds?: unknown };

    if (!Array.isArray(mediaIds)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'mediaIds must be an array of strings' },
      });
      return;
    }

    await verifyProductExists(productId);
    await reorderProductMedia(productId, mediaIds as string[]);
    await recordAudit(req.user!.id, 'media.reorder', 'media', productId, {
      mediaIds,
    });
    res.status(200).json({ reordered: true });
  } catch (err) {
    next(err);
  }
});

// ===================== Review Media (User) =====================

/**
 * POST /account/reviews/:reviewId/media
 * Authenticated: upload media to your own review.
 * Accepts multipart/form-data with a single 'file' field.
 */
router.post('/account/reviews/:reviewId/media', authenticate, uploadMiddleware.single('file'), async (req, res, next) => {
  try {
    const reviewId = req.params.reviewId as string;
    const userId = req.user!.id;

    // Verify the review exists and belongs to the user
    const db = getDatabase();
    const review = await db
      .selectFrom('reviews')
      .select(['id'])
      .where('id', '=', reviewId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!review) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Review not found' },
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'File is required. Use field name "file".' },
      });
      return;
    }

    const result = await uploadMedia(userId, 'review', reviewId, req.file.originalname, req.file.mimetype, req.file.buffer);
    await recordAudit(userId, 'media.upload', 'media', result.id, {
      entityType: 'review',
      entityId: reviewId,
      fileType: result.fileType,
      fileSize: result.fileSize,
    });
    res.status(201).json({
      ...result,
      url: getMediaUrl(result.storagePath),
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the maximum allowed size' },
      });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /account/reviews/:reviewId/media/:mediaId
 * Authenticated: delete your own review media.
 */
router.delete('/account/reviews/:reviewId/media/:mediaId', authenticate, async (req, res, next) => {
  try {
    const mediaId = req.params.mediaId as string;
    await deleteMedia(req.user!.id, undefined, mediaId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ===================== Public Read Endpoints =====================

/**
 * GET /products/:slug/media
 * Public: list media for a product, with URLs.
 */
router.get('/products/:slug/media', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const product = await getProductBySlug(slug);
    const media = await listMedia('product', product.id);
    const enriched = media.map((m) => ({
      ...m,
      url: getMediaUrl(m.storagePath),
    }));
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /products/:slug/reviews/:reviewId/media
 * Public: list media for a review, with URLs.
 */
router.get('/products/:slug/reviews/:reviewId/media', async (req, res, next) => {
  try {
    const reviewId = req.params.reviewId;
    const media = await listMedia('review', reviewId);
    const enriched = media.map((m) => ({
      ...m,
      url: getMediaUrl(m.storagePath),
    }));
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

export default router;