# Mercury — Security Overview

## Current Security Posture

| Area | Implementation | Status |
|------|---------------|--------|
| Password hashing | bcrypt, 12 rounds (configurable) | ✅ |
| JWT signing | HMAC-SHA256, configurable secret | ✅ |
| JWT validation | Signature + issuer + token type + expiration | ✅ |
| Refresh token hashing | SHA-256 stored in DB (raw token never persisted) | ✅ |
| Refresh rotation | Delete old + insert new in transaction | ✅ |
| Replay protection | Rotated tokens are invalidated; FOR UPDATE prevents races | ✅ |
| Concurrent refresh | FOR UPDATE row lock → exactly one succeeds | ✅ |
| Authorization | Multi-role RBAC — `backend_read`, `backend_write`, `backend_admin`, `user_management`; DB-authoritative lookup; `requireAllRoles()`, `requireAnyRole()` middleware | ✅ |
| Ownership isolation | All queries scoped by `user_id` in WHERE clause | ✅ |
| SQL injection | All queries parameterized via Kysely or `$N` placeholders | ✅ |
| Database constraints | UNIQUE, CHECK, FK with ON DELETE behavior | ✅ |
| Transaction isolation | FOR UPDATE in checkout, payments, shipping, refresh | ✅ |
| Rate limiting | In-memory sliding window (10-30 req/min per endpoint) | ✅ |
| Security headers | Helmet (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) | ✅ |
| Body size limit | 100kb via `express.json({ limit: '100kb' })` | ✅ |
| Production config validation | Fails fast on dev defaults in production mode | ✅ |
| Error responses | No stack traces, no internals, no secrets | ✅ |
| Logging | Only method/url/status/duration — no secrets | ✅ |
| Money safety | All PostgreSQL NUMERIC, CAST to TEXT in API, no JS floats | ✅ |
| Admin bootstrap | Env-based, bcrypt-hashed, opt-in, not HTTP-triggerable | ✅ |
| CORS | Configurable via `CORS_ORIGINS` env var; explicit origin allowlist; no wildcard for authenticated APIs | ✅ |
| External payment provider | None integrated | ⚪️ Deferred |

---

## Authentication & Token Security

See [docs/authentication.md](authentication.md) for full details.

Key points:
- Passwords are hashed with bcrypt (12 rounds). The cost factor is configurable via `BCRYPT_ROUNDS`.
- Access tokens are short-lived (default 15 minutes). They contain the user ID and email.
- Refresh tokens are long-lived (default 7 days) but single-use. They are stored as SHA-256 hashes.
- The JWT secret is configurable via `JWT_SECRET`. The default development value `dev-secret-do-not-use-in-production` causes a startup error in production mode.

## Authorization

- Backend roles (`backend_read`, `backend_write`, `backend_admin`, `user_management`) are stored in the `roles` table and assigned via `user_roles` join table.
- Roles are looked up from the database on every request (server-authoritative, not from JWT).
- `requireAllRoles(...)` middleware requires the user to have every listed role.
- `requireAnyRole(...)` middleware requires at least one listed role.
- Role changes take effect immediately without requiring a new JWT.
- The old `users.role` column is deprecated. All authorization derives from `user_roles`.
- Hard-deletion of products and categories is disabled server-side for all roles.
- Ownership is enforced at the query level — another user's resource returns 404, not 403 (preventing existence leakage).

## Rate Limiting

Rate limits are applied to abuse-prone endpoints:

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /auth/register | 10 | 1 minute |
| POST /auth/login | 10 | 1 minute |
| POST /auth/refresh | 20 | 1 minute |
| POST /checkout | 10 | 1 minute per user |
| POST /products/:slug/reviews | 20 | 1 minute per user |
| POST /wishlist | 30 | 1 minute per user |

**Limitation**: The rate limiter is in-memory and process-local. Multiple application processes would not share limiter state. This is acceptable for a single-process systemd deployment but must be addressed if scaling horizontally.

## SQL / Database Safety

- Kysely parameterizes all queries. Raw SQL uses `$N` placeholders exclusively.
- Database constraints (CHECK, UNIQUE, FK) enforce invariants at the storage level as defense-in-depth.
- All monetary values use PostgreSQL `NUMERIC(10,2)`. API responses cast amounts to strings to avoid floating-point representation issues.
- Missing inventory rows are treated as zero stock (not unlimited stock).

## Transaction / Concurrency Safety

- **Checkout**: Full atomic transaction. Locks cart (`FOR UPDATE`), locks existing inventory rows, validates stock, creates order + order_items, conditionally decrements inventory with `WHERE quantity >= ?` guard, calculates total, clears cart.
- **Refresh token rotation**: DELETE old + INSERT new within `FOR UPDATE` transaction.
- **Payments**: `FOR UPDATE` on order + payment rows; UNIQUE(order_id) prevents duplicate payments.
- **Shipping**: `FOR UPDATE` on order + shipping rows; UNIQUE(order_id) prevents duplicates.
- **Cart upsert**: `ON CONFLICT DO UPDATE` for atomic quantity merging.
- **Wishlist / Reviews**: `ON CONFLICT DO NOTHING` / `UNIQUE(user_id, product_id)` for idempotent insert.

## HTTP Security

- **Helmet**: Sets X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Strict-Transport-Security (1 year), and other security headers.
- **Body size limit**: `express.json({ limit: '100kb' })` rejects oversized payloads with 413 Payload Too Large.
- **CORS**: Enabled with an explicit origin allowlist from `CORS_ORIGINS` env var. Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS. Headers: Content-Type, Authorization. Credentials: false (Bearer-only auth). No wildcard origin. Preflight requests handled with 204 + 24h cache.

## Error Handling

- All operational errors return consistent JSON: `{ "error": { "code": "...", "message": "..." } }`.
- Unknown/internal errors return 500 with no stack trace, no SQL details, no filesystem paths.
- The error handler distinguishes Express body-parser errors (413) from application errors.
- Authentication errors do not reveal whether an email is registered (401 for both "user not found" and "wrong password").

## Logging

- Request logs capture: method, URL path, HTTP status, duration in milliseconds.
- The following are **never** logged: passwords, password hashes, access tokens, refresh tokens, Authorization header values, payment credentials, bootstrap credentials, environment variables.

See [docs/operations.md](operations.md) for production logging configuration.

## Production Configuration

When `NODE_ENV=production`, `validateProductionConfig()` is called at startup. It throws a clear error if:
- `JWT_SECRET` is still the development default
- `DATABASE_URL` is still the development default

This prevents accidental use of insecure defaults in production.

## Dependency Security

- `npm audit` reports 0 vulnerabilities (production and full).
- Only 8 production dependencies, all well-maintained.
- Dev dependencies are not required at runtime.

## Known Limitations (Not Vulnerabilities)

| Limitation | Impact | Future Work |
|-----------|--------|-------------|
| In-memory rate limiter | Process-local; state lost on restart | Replace with shared store if scaling to multi-process |
| No external payment provider | Payment status changes are internal-only | Integrate Stripe or similar |
| No email verification | `email_verified_at` column unused | Email verification flow |
| No password reset | Users cannot recover accounts | Password reset flow |
| OTP in-memory store | OTPs lost on process restart; 5-min expiry acceptable for single-process | Replace with shared store if multi-process |
| No database-aware health | `/health` does not verify DB connectivity | Add readiness check if needed |