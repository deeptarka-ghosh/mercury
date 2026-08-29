# Mercury — Authentication & Authorization

## Overview

Mercury uses a dual-token JWT authentication system with bcrypt password hashing, refresh-token rotation, and server-authoritative multi-role RBAC (Role-Based Access Control).

---

## Authentication Flow

```
Registration
    │
    ▼
bcrypt(password) → hash → INSERT INTO users
    │
    ▼
signAccessToken(userId, email) → 15m access JWT
signRefreshToken(userId) → 7d refresh JWT
    │
    ▼
INSERT refresh token (SHA-256 hash) → refresh_tokens table
    │
    ▼
Return { accessToken, refreshToken, user }
```

```
Login
    │
    ▼
SELECT user by email
    │
    ▼
bcrypt.compare(password, hash)
    │
    ▼
Same token generation as registration
```

```
Refresh
    │
    ▼
BEGIN TRANSACTION
    │
    ▼
SELECT refresh_tokens WHERE token_hash = SHA-256(token) FOR UPDATE
    │
    ▼
Verify not expired
    │
    ▼
DELETE old token row
    │
    ▼
INSERT new token row (rotation)
    │
    ▼
COMMIT
    │
    ▼
Return new access + refresh tokens
```

## Password Hashing

- **Algorithm**: bcrypt
- **Rounds**: Configurable via `BCRYPT_ROUNDS` (default 12)
- **Library**: `bcrypt` (native binding)
- **Hash storage**: `users.password_hash` column

## Access Tokens (JWT)

| Property | Value |
|----------|-------|
| **Algorithm** | HS256 (HMAC-SHA256) |
| **Secret** | `JWT_SECRET` environment variable |
| **Expiry** | `JWT_ACCESS_EXPIRY` (default `15m`) |
| **Issuer** | `JWT_ISSUER` (default `mercury`) |
| **Payload** | `{ sub: userId, email, type: 'access', iss, iat, exp }` |

### Validation

On every authenticated request, the `authenticate` middleware:

1. Extracts the `Authorization: Bearer ***` header
2. Verifies the JWT signature against `JWT_SECRET`
3. Validates the `iss` claim matches `JWT_ISSUER`
4. Validates the `type` is `'access'`
5. Validates the token is not expired
6. Extracts `sub` (user ID) and `email` into `req.user`

**Roles are NOT stored in the JWT.** All role lookups are server-authoritative from the database on every request.

## Customer Authentication Model

Customers can authenticate using multiple methods:

1. **Email + password** (existing, bcrypt-hashed)
2. **Mobile number + OTP** (primary verified contact, E.164 normalized)
3. **Google** (OIDC identity token)
4. **Apple** (Sign in with Apple identity token)
5. **Facebook** (access token)

A user may have multiple authentication identities linked to one account via the `user_identities` table.

### Mobile Verification

- Mobile number is the primary verified customer contact
- Mobile numbers are normalized to E.164 format (`+919876543210`)
- Verified mobile numbers are unique across the system
- **Checkout requires mobile verification** — enforced server-side in the checkout transaction
- Users may register/login via email or social without mobile, but cannot place orders until mobile is verified
- The `mobileVerified` boolean in the auth response tells the frontend whether verification is needed

### Mobile OTP Flow

```
POST /auth/mobile/request-otp
  → normalize mobile to E.164
  → generate 6-digit secure OTP (SHA-256 hashed in memory)
  → apply rate limits (10 req/hr, 30s cooldown)
  → send via SMS provider (dev: log to stdout)

POST /auth/mobile/verify-otp
  → hash OTP, compare against stored hash
  → enforce 5-attempt max, 5-minute expiry
  → invalidate OTP after use (replay protection)
  → create user if new mobile, or login existing
  → set mobile_verified_at
```

### Social Login Flow

```
POST /auth/google (body: { idToken })
  → verify token claims server-side (aud, exp, sub)
  → look up existing identity by provider + subject
  → create new user + link identity, or login existing
  → return auth response (no backend roles assigned)

POST /auth/apple (body: { idToken })
  → same flow, Apple identity token

POST /auth/facebook (body: { accessToken })
  → same flow, Facebook access token
```

Social login users never receive backend roles. Only the `user_management` system can assign backend roles.

### Mobile Verification for Existing Users

Authenticated users can link/verify a mobile number:

```
POST /auth/mobile/request-verification (authenticated)
POST /auth/mobile/verify (authenticated)
  → OTP validates, mobile linked to current user
  → Prevents duplicate verified mobiles across accounts
  → mobile_verified_at set immediately
```

---

## Password Hashing

- **Algorithm**: bcrypt
- **Rounds**: Configurable via `BCRYPT_ROUNDS` (default 12)

## Refresh Tokens (JWT + Database)

| Property | Value |
|----------|-------|
| **Algorithm** | HS256 |
| **Expiry** | `JWT_REFRESH_EXPIRY` (default `7d`) |
| **Payload** | `{ sub: userId, type: 'refresh', jti: uuid, iss, iat, exp }` |

### Storage

The raw refresh token is **never stored in the database**. Instead, a SHA-256 hash is stored in `refresh_tokens.token_hash`. This prevents token theft from a database breach.

### Rotation

Every refresh operation:
1. Looks up the old token hash with `FOR UPDATE` (row lock)
2. Deletes the old token row
3. Inserts a new token row with a fresh hash
4. Commits

This means each refresh token can be used **exactly once**. Previous tokens are immediately invalidated.

### Replay Protection

If a stolen refresh token is used after the legitimate owner has already rotated it, the `SELECT ... FOR UPDATE` returns no rows because the old token hash was already deleted. The attacker receives a 401 error.

### Concurrent Refresh Protection

The `FOR UPDATE` row lock ensures that two concurrent refresh attempts with the same token result in exactly one success and one failure. Tested in `auth.test.ts`.

### Logout

Logout performs a `DELETE FROM refresh_tokens WHERE token_hash = ?`. This is idempotent — calling logout with an already-deleted token returns 200.

## Authorization (RBAC)

### Role System

Mercury uses a normalized multi-role RBAC model. Roles are stored in a `roles` table and assigned via a `user_roles` join table. A user may have zero or more backend roles.

The `users.role` column is deprecated. All authorization is derived from `user_roles`.

### Backend Roles

| Role | Description |
|------|-------------|
| `backend_read` | Can access backend read-only APIs (categories, products, inventory, pricing, audit/analytics) |
| `backend_write` | Can create, update, publish/unpublish products and categories; update inventory and pricing |
| `backend_admin` | Full backend operational access including sensitive operations |
| `user_management` | Can list, view, create backend users and assign/revoke roles |

A **full system administrator** is a user who has ALL four backend roles.

Normal ecommerce customers have **no** backend roles.

### Authorization Middleware

```typescript
// Require ALL specified roles
app.use('/admin/users', authenticate, requireAllRoles('user_management'));

// Require ANY of the specified roles
app.get('/admin/products', authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin'));

// Deprecated single-role helper (internally uses requireAnyRole)
authorize('admin')  // kept for backward compatibility
```

Three middleware factories are provided:

- **`requireAllRoles(...roles)`** — user must have every listed role. Returns 403 if any is missing.
- **`requireAnyRole(...roles)`** — user must have at least one listed role. Returns 403 if none match.
- **`authorize(...roles)`** — deprecated alias for `requireAnyRole`.

### Why DB-authoritative?

Roles are looked up from the database on every request — not from the JWT — so that:

- Role changes take effect immediately without requiring a new JWT (tested in `admin.test.ts`)
- A compromised token cannot be used with an elevated role it was never granted
- The authorization system is consistent with the database source of truth

### Access Rules

**Customer** (no backend roles):
- Can use customer-facing authenticated APIs (cart, checkout, orders, etc.)
- Cannot access `/admin/*` (returns 403)
- Cannot assign roles or manage users

**backend_read**:
- Can GET /admin/categories, /admin/products, /admin/audit, /admin/analytics/*
- Cannot create, update, publish/unpublish, or otherwise mutate data

**backend_write**:
- Includes read access
- Can create/update products and categories
- Can publish/unpublish/archive products
- Can update inventory and pricing
- Cannot hard-delete products or categories
- Cannot manage users or roles

**backend_admin**:
- Full read/write access to backend operations
- Product/category hard-deletion is disabled for all roles (server-enforced, routes removed)

**user_management**:
- Required for all `/admin/users/*` endpoints (in addition to any other roles)
- Can create backend users, list users, view user details, assign and revoke roles

### Ownership Isolation

All user-owned resources are scoped by `user_id` in the WHERE clause:

```sql
DELETE FROM cart_items WHERE id = ? AND user_id = ?
```

If the resource is not owned by the requesting user, it returns 404 (not 403) — preventing attackers from learning whether a resource exists.

### Hard-deletion Disabled

Product and category hard-deletion endpoints (`DELETE /admin/products/:id`, `DELETE /admin/categories/:id`) are **removed from the server**. No role, including `backend_admin`, can use them. Use status-based mechanisms (draft/active/archived for products) instead.

### Admin Bootstrap

When `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` environment variables are set, the application creates a user with all four backend roles on startup. This is:

- **Opt-in**: Only runs when both env vars are set
- **Idempotent**: Does nothing if a user with `user_management` role already exists
- **Secure**: Uses bcrypt password hashing
- **Not HTTP-triggerable**: Only runs at startup, not via any API endpoint

### User Management API

Protected by `user_management` role:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/users` | List backend users (optional `?role=` filter) |
| GET | `/admin/users/:id` | View user details and roles |
| POST | `/admin/users` | Create backend user with roles |
| PUT | `/admin/users/:id/roles` | Replace all roles for a user (transactional) |

**Safeguards**:
- Role names are validated against the `roles` table
- The last user with `user_management` role cannot be stripped of it (prevents lockout)
- Public registration cannot self-elevate to any backend role

## Rate Limiting

Auth endpoints have rate limiting:

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `POST /auth/register` | 10 | 1 minute | IP |
| `POST /auth/login` | 10 | 1 minute | IP |
| `POST /auth/refresh` | 20 | 1 minute | IP |

The rate limiter is in-memory and process-local. It is a no-op in `NODE_ENV=test`.

## Deferred

- **Email verification**: The `email_verified_at` column exists but is never set. No verification email is sent.
- **Password reset**: Not implemented.
- **External identity providers**: Not implemented.
- **Multi-process rate limiting**: The in-memory limiter must be replaced with a shared store if the application is scaled to multiple processes.