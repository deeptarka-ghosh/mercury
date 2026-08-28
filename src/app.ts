import express from 'express';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './errors/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './features/auth/routes.js';
import usersRouter from './features/users/routes.js';
import catalogRouter from './features/catalog/routes.js';
import inventoryRouter from './features/inventory/routes.js';
import pricingRouter from './features/pricing/routes.js';
import cartRouter from './features/cart/routes.js';
import checkoutRouter from './features/checkout/routes.js';
import ordersRouter from './features/orders/routes.js';
import paymentsRouter from './features/payments/routes.js';
import shippingRouter from './features/shipping/routes.js';
import notificationsRouter from './features/notifications/routes.js';
import reviewsRouter from './features/reviews/routes.js';
import wishlistRouter from './features/wishlist/routes.js';
import adminRouter from './features/admin/routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(requestLogger);
  app.use(express.json());
  app.use(healthRouter);
  app.use(authRouter);
  app.use(usersRouter);
  app.use(catalogRouter);
  app.use(inventoryRouter);
  app.use(pricingRouter);
  app.use(cartRouter);
  app.use(checkoutRouter);
  app.use(ordersRouter);
  app.use(paymentsRouter);
  app.use(shippingRouter);
  app.use(notificationsRouter);
  app.use(reviewsRouter);
  app.use(wishlistRouter);
  app.use(adminRouter);

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