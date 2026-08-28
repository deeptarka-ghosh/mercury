# Mercury — Ecommerce Engine

A production-grade ecommerce backend built with **TypeScript**, **Express 5**, and **PostgreSQL**.

## Status

- **Application**: Feature-complete (19 modules)
- **Stage A**: Production readiness — security hardening, rate limiting, Helmet, config validation — complete
- **Stage B**: Deployment plan documented — `docs/deployment.md`, `docs/operations.md`
- **Stage C**: Codebase documentation — this document and `docs/`
- **Deployment**: Not yet deployed (no Hostinger VPS provisioned)

## Quick Start

```bash
# Prerequisites: Node.js >= 24.19.0, PostgreSQL 16+
git clone <repo>
cd mercury
npm install

# Configure environment
cp .env.example .env
# Edit .env with your local PostgreSQL connection string

# Run migrations
npm run migrate

# Start development server (hot reload)
npm run dev

# Health check
curl http://localhost:3000/health
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 24.19.0 |
| Language | TypeScript 5.8 (strict mode) |
| HTTP framework | Express 5 |
| Database | PostgreSQL 16+ |
| Query builder | Kysely 0.29 |
| Auth | bcrypt + JWT (access + refresh tokens) |
| Logging | pino (structured JSON) |
| Testing | vitest + supertest (real PostgreSQL) |
| Security | Helmet, rate limiting, body size limits |

## Implemented Modules

| Module | Description |
|--------|-------------|
| Authentication | Register, login, JWT access/refresh tokens, rotation, replay protection |
| Users + Profiles | User profile management |
| Catalog | Categories (hierarchical), products (draft/active/archived), public browsing |
| Search | PostgreSQL ILIKE + pg_trgm, active products only |
| Inventory | Per-product stock, missing = zero, FOR UPDATE concurrency |
| Pricing | Per-product NUMERIC prices, string serialization |
| Cart | Per-user cart, atomic UPSERT, active-product validation |
| Checkout | Atomic transaction: lock cart + inventory, validate, snapshot, decrement, clear |
| Orders | Order history with snapshotted line items, pagination |
| Payments | One-per-order, FOR UPDATE + UNIQUE, status transitions |
| Shipping | One-per-order, address snapshot, pending-only edits |
| Notifications | In-app persistence, transactional creation |
| Reviews | 1-5 rating, UNIQUE per user/product, aggregate AVG/COUNT |
| Wishlist | Per-user, idempotent insert, live pricing |
| Admin | Role-based authorization, category/product/inventory/price management |
| Audit + Analytics | Admin mutation audit log, revenue/order/product analytics |

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with hot reload (tsx watch) |
| `npm run build` | Production build (tsc) |
| `npm run start` | Start built production server |
| `npm run lint` | ESLint |
| `npm run format` | Prettier check |
| `npm run format:fix` | Prettier auto-format |
| `npm run typecheck` | TypeScript type check |
| `npm run test` | Run all tests (vitest) |
| `npm run migrate` | Run pending database migrations |
| `npm run migrate:down` | Revert one migration |
| `npm run migrate:list` | List migration status |
| `npm run clean` | Remove dist/ |

## Documentation

| Document | Description |
|----------|-------------|
| `docs/architecture.md` | System architecture, request flow, module structure |
| `docs/api.md` | Complete API reference (all endpoints, methods, responses) |
| `docs/database.md` | Full schema reference (all tables, columns, constraints, indexes) |
| `docs/authentication.md` | Auth flow, JWT, refresh rotation, authorization |
| `docs/security.md` | Security posture, rate limiting, concurrency, known limitations |
| `docs/deployment.md` | Production deployment guide (Stage B) |
| `docs/operations.md` | Operations runbook, backups, disaster recovery (Stage B) |
| `PROJECT.md` | Engineering rules and conventions |

## Project Structure

```
mercury/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Express app factory
│   ├── config/               # Environment + logger
│   ├── auth/                 # Authentication middleware + tokens
│   ├── db/                   # Database types, pool, connection
│   ├── errors/               # AppError + error handler
│   ├── middleware/            # Request logging + rate limiting
│   ├── routes/               # Health endpoint
│   ├── features/             # Domain modules (routes + service per module)
│   ├── migrations/           # 19 ordered migrations
│   └── __tests__/            # 23 integration test files
├── docs/                     # Documentation
├── .env.example
├── Dockerfile
├── tsconfig.json / tsconfig.build.json
├── eslint.config.mjs
└── vitest.config.ts
```

## Testing

```bash
# Run all tests (requires a running PostgreSQL instance)
npm run test

# Run a single test file
npx vitest run src/__tests__/auth.test.ts

# Run tests in watch mode
npm run test:watch
```

Tests are integration tests against real PostgreSQL. See `vitest.config.ts` for configuration.

## Deployment

See `docs/deployment.md` for the complete production deployment guide.

Deployment is **not yet performed** — it requires a Hostinger VPS to be provisioned.

## License

Private project. All rights reserved.