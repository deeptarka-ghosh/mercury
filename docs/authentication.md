# Mercury — Authentication & Authorization

## Overview

Mercury uses a dual-token JWT authentication system with bcrypt password hashing, refresh-token rotation, and server-authoritative role-based authorization.

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

1. Extracts the `Authorization: Bearer <token>` header
2. Verifies the JWT signature against `JWT_SECRET`
3. Validates the `iss` claim matches `JWT_ISSUER`
4. Validates the `type` is `'access'`
5. Validates the token is not expired
6. Extracts `sub` (user ID) and `email` into `req.user`

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

## Authorization

### Role System

Users have a `role` column with values constrained to `'user'` (default) or `'admin'`. The role was added in migration 017.

### authorize() Middleware

```typescript
app.use('/admin', authenticate, authorize('admin'));
```

The `authorize(...)` middleware factory:

1. Requires `authenticate` to have run first (verifies `req.user` exists)
2. **Looks up the user's role from the database** (not from the JWT)
3. Returns `403 FORBIDDEN` if the user's role is not in the allowed list
4. Attaches the role to `req.user.role` for downstream use

### Why DB-authoritative?

The role is looked up from the database — not from the JWT — so that:
- Role changes take effect immediately (no waiting for token expiry)
- A compromised token cannot be used with an elevated role it was never granted
- The authorization system is consistent with the database source of truth

### Ownership Isolation

All user-owned resources are scoped by `user_id` in the WHERE clause:

```sql
DELETE FROM cart_items WHERE id = ? AND user_id = ?
```

If the resource is not owned by the requesting user, it returns 404 (not 403) — preventing attackers from learning whether a resource exists.

### Admin Bootstrap

When `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` environment variables are set, the application creates or upgrades a user to admin on startup. This is:

- **Opt-in**: Only runs when both env vars are set
- **Idempotent**: Does nothing if an admin already exists
- **Secure**: Uses bcrypt password hashing
- **Not HTTP-triggerable**: Only runs at startup, not via any API endpoint

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