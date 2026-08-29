# Mercury — Architecture

## System Overview

Mercury is a production-grade ecommerce backend API. It is a single-process Node.js application providing RESTful JSON endpoints for a complete ecommerce lifecycle: catalog browsing, cart management, checkout, order processing, payment tracking, shipping, notifications, reviews, wishlist, admin management, audit logging, analytics, and media/file upload.

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js >= 24.19.0 | JavaScript runtime |
| **Language** | TypeScript 5.8 | Type safety, ES2022 target |
| **HTTP framework** | Express 5 | Routing, middleware, error handling |
| **Database** | PostgreSQL 16+ | Relational store, source of truth |
| **Database driver** | `pg` | PostgreSQL client |
| **Query builder** | Kysely 0.29 | Type-safe SQL query builder with migration support |
| **Authentication** | bcrypt + JWT | Password hashing, access/refresh tokens |
| **Logging** | pino | Structured JSON logging |
| **Configuration** | dotenv + env-var | Environment file loading + typed accessors |
| **Testing** | vitest + supertest | Integration tests against real PostgreSQL |
| **Linting** | ESLint + typescript-eslint | Flat config, strict type-checked rules |
| **Formatting** | Prettier | Code formatting |
| **Security headers** | Helmet | Production HTTP security headers |
| **Rate limiting** | In-memory sliding window | Process-local; no-op in test mode |
| **File validation** | sharp | Image decode/integrity/dimensions |
| **File upload** | multer | Multipart form data handling |

## Request Flow

```
HTTP Request
    │
    ▼
Nginx (production only — reverse proxy, TLS termination)
    │
    ▼
Express (app.ts)
    │
    ├── Helmet (security headers)
    ├── requestLogger (pino request logging)
    ├── express.json (body parser, 100kb limit)
    │
    ├── Router: /health
    ├── Router: /auth/*              (auth: register, login, OTP, social, refresh, logout)
    ├── Router: /users/*             (profile: get, update)
    ├── Router: /categories, /products/*  (catalog — public)
    ├── Router: /products/:slug/inventory (public read)
    ├── Router: /products/:slug/price     (public read)
    ├── Router: /cart/*              (cart — authenticated)
    ├── Router: /checkout             (checkout — authenticated)
    ├── Router: /orders/*             (orders — authenticated)
    ├── Router: /orders/:orderId/payments/*  (payments — authenticated)
    ├── Router: /orders/:orderId/shipping/*  (shipping — authenticated)
    ├── Router: /notifications/*      (notifications — authenticated)
    ├── Router: /products/:slug/reviews (reviews — mixed)
    ├── Router: /account/reviews/*    (my reviews — authenticated)
    ├── Router: /wishlist/*          (wishlist — authenticated)
    ├── Router: /admin/*             (admin — authenticated + authorized)
    ├── Router: /admin/products/:productId/media  (admin — upload/delete/reorder media)
    ├── Router: /account/reviews/:reviewId/media  (authenticated — upload/delete review media)
    ├── Router: /products/:slug/media             (public — list product media)
    ├── Router: /products/:slug/reviews/:reviewId/media (public — list review media)
    │
    ├── 404 catch-all
    └── errorHandler
            │
            ▼
        JSON response
```

## Application Structure

```
src/
├── index.ts                    # Entry point: validate config, bootstrap admin, start server
├── app.ts                      # Express app factory (middleware chain, routes, error handler)
├── config/
│   ├── env.ts                  # Typed env-var accessors + production validation
│   └── logger.ts               # Pino logger instance
├── auth/
│   ├── middleware.ts            # authenticate() + authorize() middleware
│   ├── tokens.ts               # JWT sign/verify (access + refresh)
│   └── password.ts             # bcrypt hash/verify
├── db/
│   ├── types.ts                # Kysely DB table interfaces
│   ├── database.ts             # Kysely singleton factory
│   └── pool.ts                 # pg.Pool singleton factory
├── errors/
│   ├── AppError.ts             # Base error class with status/code/JSON serialization
│   └── errorHandler.ts         # Express error middleware
├── middleware/
│   ├── requestLogger.ts        # Per-request pino logging
│   └── rateLimiter.ts          # In-memory sliding-window rate limiter
├── routes/
│   └── health.ts               # GET /health endpoint
├── features/                   # Domain modules, each with routes.ts + service.ts
│   ├── auth/                   # Registration, login, OTP, social login, refresh, logout
│   ├── users/                  # Profile management
│   ├── catalog/                # Categories, products, search
│   ├── inventory/              # Stock levels
│   ├── pricing/                # Product prices
│   ├── cart/                   # Shopping cart
│   ├── checkout/               # Checkout transaction
│   ├── orders/                 # Order history
│   ├── payments/               # Payment lifecycle
│   ├── shipping/               # Shipping address management
│   ├── notifications/          # In-app notifications
│   ├── reviews/                # Product reviews
│   ├── wishlist/               # Product wishlist
│   ├── admin/                  # Admin management + audit + analytics
│   └── media/                  # File upload + validation + storage abstraction
├── migrations/                 # Kysely file-based migrations (001-023)
└── __tests__/                  # Integration tests
```

## Feature Module Pattern

Each feature module follows a consistent pattern:

- **`routes.ts`**: Express Router with endpoint definitions, body parsing, validation, middleware, and error handling
- **`service.ts`**: Business logic, database queries, AppError throwing

The media module additionally includes:

- **`types.ts`**: Shared interfaces, constants, and the `MediaStorage` abstraction interface
- **`storage.ts`**: `MediaStorage` implementation (`LocalMediaStorage` with date-based directories)
- **`validation.ts`**: Centralized file validation (magic byte sniffing, sharp image decode, ffprobe video probe)

Modules do not use a separate data-access layer — Kysely queries are in the service files. This avoids unnecessary abstraction for a single-database application.

## Key Architectural Decisions

### Database as source of truth
PostgreSQL is authoritative. There is no caching layer, no in-memory state that persists across restarts, and no ORM abstraction above Kysely.

### No event bus
State transitions (checkout, payments, shipping) happen in synchronous PostgreSQL transactions. There is no event bus, message queue, or background worker.

### No generic repository pattern
Each service file owns its queries directly. This avoids the abstraction overhead of a generic repository for a single-database, single-process application.

### Historical snapshots
Orders snapshot product names/prices at checkout time. Shipping snapshots the address provided by the user. These are never updated from mutable product/user data.

### Server-authoritative authorization
Roles are looked up from the database on every admin request, not from JWT claims. This prevents stale role data after a role change.

### Feature-complete, not over-engineered
The application is feature-complete for the current scope. Each module implements the minimum coherent behavior. Future features (payment providers, email, queues, etc.) are deferred.

### Storage abstraction
Media files are accessed through a `MediaStorage` interface (`types.ts`). The initial implementation (`LocalMediaStorage`) stores files on the local filesystem in date-based subdirectories. Swapping to S3, GCS, or any object store requires only a new implementation of `MediaStorage` — no changes to product, review, or media service business logic.

## Deferred Architecture

- **Payment provider integration**: The payment system is provider-independent. A real provider (Stripe, etc.) must be integrated.
- **Email/SMS/Push notifications**: Only in-app notifications exist.
- **Background workers**: No queue system exists.
- **Multi-process support**: Rate limiter and media storage are process-local.
- **Video transcoding**: Uploaded videos are stored as-is; no transcoding pipeline.
- **Media serving URL**: The `getUrl()` method returns relative paths (`/media/<path>`). A static file serving endpoint (`express.static`) must be added in production.
- **CDN integration**: No CDN layer for media delivery.
- **Deployment**: No Hostinger VPS is provisioned yet. See `docs/deployment.md`.