import { Router } from 'express';
import { login, register, refresh, logout } from './service.js';

const router = Router();

interface LoginBody {
  email?: string;
  password?: string;
}

interface RegisterBody {
  email?: string;
  password?: string;
}

interface RefreshBody {
  refreshToken?: string;
}

interface LogoutBody {
  refreshToken?: string;
}

router.post('/auth/register', async (req, res, next) => {
  try {
    const { email, password } = req.body as RegisterBody;

    if (!email || !password) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email and password are required',
        },
      });
      return;
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email and password must be strings',
        },
      });
      return;
    }

    const result = await register({ email, password });

    res.status(201).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body as LoginBody;

    if (!email || !password) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email and password are required',
        },
      });
      return;
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email and password must be strings',
        },
      });
      return;
    }

    const result = await login({ email, password });

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body as RefreshBody;

    if (!refreshToken) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'refreshToken is required',
        },
      });
      return;
    }

    if (typeof refreshToken !== 'string') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'refreshToken must be a string',
        },
      });
      return;
    }

    const result = await refresh(refreshToken);

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body as LogoutBody;

    if (!refreshToken) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'refreshToken is required',
        },
      });
      return;
    }

    if (typeof refreshToken !== 'string') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'refreshToken must be a string',
        },
      });
      return;
    }

    await logout(refreshToken);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;