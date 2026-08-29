# Mercury — Frontend Integration Guide

Deployment topology and API integration patterns for the Store-front and Back-office applications.

---

## Deployment Topology

```
Nginx (reverse proxy, TLS termination)
  ├── /api/* → Backend API (Node.js, port 3000)
  ├── /* → Store-front application (separate process)
  └── /admin/* → Back-office application (separate process)
```

- **Backend**: Node.js Express 5, PostgreSQL 16+
- **Store-front**: Customer-facing web app (separate process, independent technology)
- **Back-office**: Admin panel for backend operations (separate process)
- **PostgreSQL**: Runs as a separate service on the VPS
- All three applications run independently and communicate through HTTP
- The backend is **not coupled** to either frontend

---

## API Base URL

In development: `http://localhost:3000`
In production: `https://your-domain.com/api` (via Nginx proxy)

Configure as a single base URL in each frontend application.

---

## Authentication Token Handling

### Token Format

All APIs use `Authorization: Bearer <accessToken>` headers.

### Token Lifecycle

| Token | Lifetime | Storage |
|-------|----------|---------|
| Access token | 15 minutes (configurable) | Frontend memory / HTTP-only cookie |
| Refresh token | 7 days (configurable) | Frontend secure storage |

### Refresh Strategy

When the backend returns HTTP 401, the frontend should:

1. Do NOT immediately redirect to login — attempt token refresh first
2. Call `POST /auth/refresh` with the stored refresh token
3. On success: store the new access + refresh tokens, retry the original request
4. On failure (401): clear stored tokens, redirect to login

### Logout

Call `POST /auth/logout` with the refresh token to invalidate it server-side. Then clear local tokens.

---

## CORS

The backend is configured with an explicit allowed-origins list.

**Environment variable**: `CORS_ORIGINS` (comma-separated, default: `http://localhost:3000,http://localhost:3001`)

**Allowed methods**: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`

**Allowed headers**: `Content-Type`, `Authorization`

**Credentials mode**: `false` (auth is Bearer-header only, no cookies)

**Preflight**: `OPTIONS` requests are handled automatically with a 204 response and 24-hour cache.

The backend does NOT use `Access-Control-Allow-Origin: *`. Only explicitly configured origins receive CORS headers.

---

## Multipart File Uploads

Media uploads use `multipart/form-data` with a single `file` field.

```javascript
const formData = new FormData();
formData.append('file', fileObject, 'filename.jpg');

const response = await fetch('/admin/products/{id}/media', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData,
});
```

Do NOT set `Content-Type` header manually — the browser sets it automatically with the boundary.

---

## Pagination

All list endpoints that can grow use a consistent pagination pattern:

```json
{
  "data": [...],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**Query parameters**: `?limit=50&offset=0`

- `limit`: max items per page (default 50, max 200)
- `offset`: number of items to skip (default 0)
- `total`: total number of items matching the current filters (not just the page)

---

## Standardized API Errors

Every error response follows this contract:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Meaning | Frontend Action |
|------|-------------|---------|-----------------|
| `VALIDATION_ERROR` | 400 | Invalid input | Show field validation |
| `BAD_REQUEST` | 400 | Invalid request | Show error message |
| `UNAUTHORIZED` | 401 | No or invalid token | Try refresh, then redirect to login |
| `FORBIDDEN` | 403 | Authenticated but insufficient permissions | Show access denied UI |
| `MOBILE_VERIFICATION_REQUIRED` | 403 | Mobile not verified, cannot checkout | Show mobile verification prompt |
| `NOT_FOUND` | 404 | Resource not found | Show 404 UI |
| `CONFLICT` | 409 | Duplicate or state conflict | Show conflict message |
| `PAYLOAD_TOO_LARGE` | 413 | Request body too large | Reduce payload |
| `FILE_TOO_LARGE` | 413 | Uploaded file exceeds limit | Choose smaller file |
| `TOO_MANY_REQUESTS` | 429 | Rate limited | Wait and retry |
| `INTERNAL_ERROR` | 500 | Server error | Show generic error |

---

## RBAC for Back-office

The Back-office application must handle role-based UI visibility.

**Important**: Backend authorization is server-authoritative. Frontend role checks are UX-only.

### Permission Matrix

| Feature | backend_read | backend_write | backend_admin | user_management |
|---------|:---:|:---:|:---:|:---:|
| View products/categories | ✓ | ✓ | ✓ | |
| View inventory/pricing | ✓ | ✓ | ✓ | |
| View audit/analytics | ✓ | ✓ | ✓ | |
| Create/update products | | ✓ | ✓ | |
| Create/update categories | | ✓ | ✓ | |
| Publish/unpublish/archive | | ✓ | ✓ | |
| Update inventory/pricing | | ✓ | ✓ | |
| Upload media to products | | ✓ | ✓ | |
| Delete media | | | ✓ | |
| View users | | | | ✓ |
| Create users | | | | ✓ |
| Assign roles | | | | ✓ |

### Obtaining the User's Roles

The JWT does NOT contain roles. The frontend should call `GET /admin/me` (authenticated, requires at least one backend role) to retrieve the user's identity and assigned backend roles at once:

```json
{
  "id": "uuid",
  "email": "admin@example.com",
  "mobileNumber": "+919876543210",
  "mobileVerified": true,
  "roles": ["backend_read", "backend_write"]
}
```

If the user has no backend roles, the endpoint returns 403. The frontend can use this to gate the back-office UI and derive available permissions from the `roles` array.

---

## Public vs Authenticated Routes

| Category | Auth Required | Notes |
|----------|---------------|-------|
| Health | No | `GET /health` |
| Catalog browsing | No | Products, categories, search |
| Product detail | No | Single product by slug |
| Inventory/price lookup | No | Public read-only |
| Registration | No | Email + password |
| Login | No | Email/password or social |
| Profile | Yes | GET/PATCH `/users/me` |
| Cart | Yes | All cart operations |
| Checkout | Yes | Requires mobile verification |
| Orders | Yes | Own orders only |
| Payments | Yes | Own orders only |
| Shipping | Yes | Own orders only |
| Reviews | Mixed | Read: public; write: authenticated |
| Wishlist | Yes | Own wishlist only |
| Notifications | Yes | Own notifications only |
| Media listing | No | Public read-only |
| Any `/admin/*` | Yes | Requires at least one backend role |

---

## Auth Response Shape

All authentication endpoints return the same shape:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "mobileNumber": "+15551234567",
    "mobileVerified": true
  }
}
```

The `mobileVerified` field tells the Store-front whether to show the mobile verification prompt before checkout.

---

## Mobile Verification Flow

1. Customer attempts checkout → receives `MOBILE_VERIFICATION_REQUIRED` (403)
2. Frontend shows mobile verification form
3. `POST /auth/mobile/request-verification` (authenticated, body: `{ mobileNumber }`)
4. Customer receives OTP (via SMS in production, logged to stdout in dev)
5. `POST /auth/mobile/verify` (authenticated, body: `{ mobileNumber, otp }`)
6. Success → `mobileVerified: true` → customer can proceed to checkout

---

## Error Handling Best Practices

1. Always check for `error` field in responses
2. Map `error.code` to UI states (not `error.message` — messages may change)
3. On 401, attempt token refresh before showing login
4. On 403, check if the user needs different roles or mobile verification
5. On 429, implement exponential backoff
6. On 5xx, show a generic error with retry option

---

## Multipart Form Data

See [Media/File Uploads in api.md](api.md#media-file-uploads) for exact field names and response shapes.

---

## Rate Limiting

The backend applies rate limits to abuse-prone endpoints. Frontends should handle 429 responses with backoff.

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /auth/register | 10 | 1 minute |
| POST /auth/login | 10 | 1 minute |
| POST /auth/refresh | 20 | 1 minute |
| POST /auth/mobile/request-otp | 5 | 1 minute |
| POST /auth/mobile/verify-otp | 5 | 1 minute |
| POST /checkout | 10 | 1 minute per user |
| POST /products/:slug/reviews | 20 | 1 minute per user |
| POST /wishlist | 30 | 1 minute per user |

---

## Store-front API Map

| Area | Endpoints | Auth |
|------|-----------|------|
| **Auth** | POST /auth/register, /auth/login, /auth/refresh, /auth/logout | Mixed |
| **Auth - Mobile** | POST /auth/mobile/request-otp, /auth/mobile/verify-otp | No |
| **Auth - Mobile link** | POST /auth/mobile/request-verification, /auth/mobile/verify | Yes |
| **Auth - Social** | POST /auth/google, /auth/apple, /auth/facebook | No |
| **Profile** | GET /users/me, PATCH /users/me | Yes |
| **Catalog** | GET /categories, /categories/:slug, /products, /products/:slug, /products/search | No |
| **Inventory** | GET /products/:slug/inventory | No |
| **Pricing** | GET /products/:slug/price | No |
| **Cart** | GET /cart, POST /cart, PATCH /cart/:itemId, DELETE /cart/:itemId, DELETE /cart | Yes |
| **Checkout** | POST /checkout | Yes (mobile-verified) |
| **Orders** | GET /orders, GET /orders/:orderId | Yes |
| **Payments** | POST /orders/:orderId/payments, GET /orders/:orderId/payments, PATCH /orders/:orderId/payments | Yes |
| **Shipping** | POST /orders/:orderId/shipping, GET /orders/:orderId/shipping, PATCH /orders/:orderId/shipping | Yes |
| **Reviews** | GET /products/:slug/reviews, POST /products/:slug/reviews, GET /account/reviews, PATCH /account/reviews/:reviewId, DELETE /account/reviews/:reviewId | Mixed |
| **Wishlist** | GET /wishlist, POST /wishlist, DELETE /wishlist/:productId | Yes |
| **Notifications** | GET /notifications, PATCH /notifications/:id/read | Yes |
| **Media** | GET /products/:slug/media, GET /products/:slug/reviews/:reviewId/media | No |

---

## Back-office API Map

| Area | Endpoints | Min Role |
|------|-----------|----------|
| **Orders** | GET /admin/orders, GET /admin/orders/:orderId | backend_read |
| | PATCH /admin/orders/:orderId/status, PATCH /admin/orders/:orderId/shipping-status, POST /admin/orders/:orderId/cancel | backend_write |
| | POST /admin/orders/:orderId/refunds | backend_admin |
| **Variants** | GET /admin/products/:productId/variants, GET /admin/products/:productId/variants/:variantId | backend_read |
| | POST /admin/products/:productId/variants, PATCH /admin/products/:productId/variants/:variantId, PATCH /admin/products/:productId/variants/:variantId/status, PUT /admin/products/:productId/variants/:variantId/inventory, PUT /admin/products/:productId/variants/:variantId/pricing | backend_write |
| **Session** | GET /admin/me | backend_read |
| **Dashboard** | GET /admin/analytics/summary | backend_read |
| **Analytics** | GET /admin/analytics/orders, /admin/analytics/revenue, /admin/analytics/products | backend_read |
| **Products** | GET /admin/products, GET /admin/products/:id | backend_read |
| | POST /admin/products, PATCH /admin/products/:id, PATCH /admin/products/:id/status | backend_write |
| **Categories** | GET /admin/categories, GET /admin/categories/:id | backend_read |
| | POST /admin/categories, PATCH /admin/categories/:id | backend_write |
| **Inventory** | GET /admin/products/:slug/inventory | backend_read |
| | PUT /admin/products/:slug/inventory | backend_write |
| **Pricing** | GET /admin/products/:slug/price | backend_read |
| | PUT /admin/products/:slug/price | backend_write |
| **Media** | POST /admin/products/:productId/media, PUT /admin/products/:productId/media/reorder | backend_write |
| | DELETE /admin/products/:productId/media/:mediaId | backend_admin |
| **Audit** | GET /admin/audit | backend_read |
| **Users** | GET /admin/users, GET /admin/users/:id, POST /admin/users, PUT /admin/users/:id/roles | user_management |

**Note**: Product and category hard-deletion endpoints do not exist. Use status changes (draft/active/archived) instead.

---

## Status Codes Summary

| Code | Usage |
|------|-------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (deletion) |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions, mobile not verified) |
| 404 | Not Found |
| 409 | Conflict (duplicate, state conflict) |
| 413 | Payload Too Large |
| 429 | Rate Limited |
| 500 | Internal Server Error |