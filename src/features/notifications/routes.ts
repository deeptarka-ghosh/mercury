import { Router } from 'express';
import { listNotifications, markAsRead } from './service.js';
import { authenticate } from '../../auth/middleware.js';

const router = Router();

/**
 * All notification endpoints require authentication.
 */

/**
 * GET /notifications
 * Lists the authenticated user's notifications, most recent first.
 */
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const notifications = await listNotifications(userId, limit, offset);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /notifications/:id/read
 * Mark a notification as read.
 */
router.patch('/notifications/:id/read', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid notification ID' },
      });
      return;
    }

    const result = await markAsRead(userId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;