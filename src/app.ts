import express from 'express';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './errors/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './features/auth/routes.js';
import usersRouter from './features/users/routes.js';
import catalogRouter from './features/catalog/routes.js';
import inventoryRouter from './features/inventory/routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(requestLogger);
  app.use(express.json());
  app.use(healthRouter);
  app.use(authRouter);
  app.use(usersRouter);
  app.use(catalogRouter);
  app.use(inventoryRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route not found`,
      },
    });
  });

  app.use(errorHandler);

  return app;
}