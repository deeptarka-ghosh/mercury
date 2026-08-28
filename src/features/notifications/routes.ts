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
    const notifications = await listNotifications(userId);
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