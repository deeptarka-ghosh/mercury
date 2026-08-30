import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './errors/errorHandler.js';
import { allowedOrigins } from './config/env.js';
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
import adminAuthRouter from './features/admin/authRoutes.js';
import mediaRouter from './features/media/routes.js';
import collectionsRouter from './features/collections/routes.js';
import campaignsRouter from './features/campaigns/routes.js';
import bannersRouter from './features/banners/routes.js';
import homepageRouter from './features/homepage/routes.js';
import recommendationsRouter from './features/recommendations/routes.js';
import customerDataRouter from './features/customerData/routes.js';

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS — only explicitly configured origins are allowed
  // No credentials (auth is Bearer header only, not cookies)
  app.use(cors({
    origin(origin, callback) {
      // No Origin header (server-to-server, curl, same-origin browsers) — no ACAO needed
      if (!origin) {
        callback(null, false);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, origin); // reflect the specific origin
        return;
      }
      callback(null, false); // unknown origin — deny (no ACAO header)
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86_400,
    optionsSuccessStatus: 204,
  }));

  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));
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
  app.use(adminAuthRouter);
  app.use(mediaRouter);
  app.use(collectionsRouter);
  app.use(campaignsRouter);
  app.use(bannersRouter);
  app.use(homepageRouter);
  app.use(recommendationsRouter);
  app.use(customerDataRouter);

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
