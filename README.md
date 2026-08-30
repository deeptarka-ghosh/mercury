# Mercury — Ecommerce Engine

A production-grade ecommerce backend built with **TypeScript**, **Express 5**, and **PostgreSQL**.

## Status

- **Application**: Complete local three-repository commerce platform (merchandising, customer data, admin and storefront contracts)
- **Stage A**: Production readiness — security hardening, rate limiting, Helmet, config validation — complete
- **Stage B**: Deployment plan documented — `docs/deployment.md`, `docs/operations.md`
- **Stage C**: Codebase documentation — this document and `docs/`
- **Stage D**: Multi-role RBAC — normalized roles table, user_roles join, 4 backend roles, user management API, hard-delete removal — complete
- **Stage E**: Customer authentication — mobile OTP, social login (Google/Apple/Facebook), identity linking, mobile verification, checkout enforcement — complete
- **Stage F**: Backend closure — bug hunt, pagination/count consistency, CORS, media audit, documentation, frontend integration guide — complete
- **Deployment**: Not yet deployed (no Hostinger VPS provisioned)

## Quick Start

```bash
# Prerequisites: Node.js >= 24.19.0, pnpm >= 9.0.0, PostgreSQL 16+
git clone <repo>
cd mercury
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your local PostgreSQL connection string

# Run migrations
pnpm run migrate

# Start development server (hot reload)
pnpm run dev

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
| Auth | bcrypt + JWT (access + refresh tokens), mobile OTP, Google/Apple/Facebook, RBAC |
| Logging | pino (structured JSON) |
| Testing | vitest + supertest (real PostgreSQL) |
| Security | Helmet, rate limiting, body size limits |
| Package manager | pnpm |

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
| Admin | Role-based authorization, category/product/inventory/price/variant management |
| Audit + Analytics | Admin mutation audit log, revenue/order/product analytics |
| Media Upload | File upload, validation (sharp), storage abstraction, product/review attachments |
| Customer Auth | Mobile OTP, Google/Apple/Facebook login, identity linking, mobile verification |

## Available Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Development server with hot reload (tsx watch) |
| `pnpm run build` | Production build (tsc) |
| `pnpm run start` | Start built production server |
| `pnpm run lint` | ESLint |
| `pnpm run format` | Prettier check |
| `pnpm run format:fix` | Prettier auto-format |
| `pnpm run typecheck` | TypeScript type check |
| `pnpm run test` | Run all tests (vitest) |
| `pnpm run migrate` | Run pending database migrations |
| `pnpm run migrate:down` | Revert one migration |
| `pnpm run migrate:list` | List migration status |
| `pnpm run seed:demo` | Idempotently create the realistic clothing catalog and demo identities |
| `pnpm run clean` | Remove dist/ |

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
| `docs/frontend-integration.md` | Frontend integration guide: auth, CORS, pagination, error handling, API maps |
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
│   ├── migrations/           # 38 ordered migrations
│   └── __tests__/            # 33 integration test files
├── docs/                     # Documentation
├── .env.example
├── tsconfig.json / tsconfig.build.json
├── eslint.config.mjs
├── vitest.config.ts
└── pnpm-lock.yaml
```

## Testing

```bash
# Run all tests (requires a running PostgreSQL instance)
pnpm run test

# Run a single test file
pnpm exec vitest run src/__tests__/auth.test.ts

# Run tests in watch mode
pnpm run test:watch
```

Tests are integration tests against real PostgreSQL. See `vitest.config.ts` for configuration.

## Deployment

See `docs/deployment.md` for the complete production deployment guide.

Deployment is **not yet performed** — it requires a Hostinger VPS to be provisioned.

## License

Private project. All rights reserved.
