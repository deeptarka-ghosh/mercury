import { Router } from 'express';
import { authenticate } from '../../auth/middleware.js';
import { getProfile, updateProfile } from './service.js';

const router = Router();

router.get('/users/me', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }
    const profile = await getProfile(user.id);
    res.json(profile);
  } catch (error: unknown) {
    next(error);
  }
});

router.patch('/users/me', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const { displayName, bio, avatarUrl } = req.body as {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
    };

    if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'displayName must be a string or null' },
      });
      return;
    }
    if (bio !== undefined && bio !== null && typeof bio !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'bio must be a string or null' },
      });
      return;
    }
    if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'avatarUrl must be a string or null' },
      });
      return;
    }

    const profile = await updateProfile(user.id, {
      displayName,
      bio,
      avatarUrl,
    });

    res.json(profile);
  } catch (error: unknown) {
    next(error);
  }
});

export default router;