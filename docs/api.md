# Mercury — API Reference

## Customer addresses, preferences, and behavior

Authenticated routes under `/account` provide saved-address CRUD and
`GET/PUT /account/preferences`. Every query is scoped by the access-token user;
unknown or foreign address IDs return 404. `POST /account/behavior` accepts
product/search/collection/category events only after explicit personalization
consent. `GET /account/recommendations/:placement` uses those signals and
returns deterministic scores and explanations.

## Recommendations

`GET /recommendations/:placement` selects the highest-priority active rule for
the optional ISO `at` instant and returns its products with rank and a shared,
human-readable explanation. Strategies are `manual`, `collection`, `category`,
`new_arrivals`, and `best_sellers`; every strategy has an explicit stable
tie-breaker and none uses random ordering. Missing placements return an explicit
empty result.

Admin routes are `GET/POST /admin/recommendation-rules`, `PATCH
/admin/recommendation-rules/:id`, and `PUT
/admin/recommendation-rules/:id/products` for manual ordering. Writes require
`backend_write` or `backend_admin` and are audited.

## Homepage layout

`GET /homepage` resolves the highest-priority active layout whose schedule
contains the optional ISO `at` instant. It returns the layout and its enabled
sections in explicit position order, or `{ "layout": null, "sections": [] }`.
Supported section types cover heroes, banner strips, collection/category grids,
product carousels, campaign/promotion features, and editorial content.

Admin routes are `GET/POST /admin/homepage-layouts`, `GET/PATCH
/admin/homepage-layouts/:id`, and atomic `PUT
/admin/homepage-layouts/:id/sections`. The replace body is `{ "sections": [...] }`;
array order becomes section position. Writes require `backend_write` or
`backend_admin` and are audited.

## Merchandising banners

`GET /banners` returns only active banners whose schedule contains the requested
instant. Optional query parameters are `placement` and ISO `at`. Results are
stable: placement ascending, priority descending, then ID ascending. Each banner
includes desktop and optional mobile media, accessible alt text, and a typed
destination (`product`, `category`, `collection`, `campaign`, `promotion`,
`url`, or `none`).

Admin routes are `GET/POST /admin/banners` and `PATCH /admin/banners/:id`.
Reads require a backend role; writes require `backend_write` or
`backend_admin`, and every mutation is audited.

## Campaigns and promotions

`GET /campaigns` and `GET /campaigns/:slug` resolve active campaigns at an
optional ISO `at` instant. Campaign detail returns collections in explicit
placement order. `GET /promotions` resolves active offers by priority and stable
ID. Admin routes under `/admin/campaigns` and `/admin/promotions` require backend
roles; mutations require `backend_write` or `backend_admin` and are audited.

## Merchandising collections

Public collection resolution is deterministic and schedule-aware. Collections
sort by priority descending, then slug and ID ascending. Products sort by their
explicit position, then ID. `GET /collections` lists visible collections and
`GET /collections/:slug` returns one collection with active products. Both
accept an optional ISO `at` query for deterministic preview/testing.

Admin routes are `GET/POST /admin/collections`, `PATCH
/admin/collections/:id`, and `PUT /admin/collections/:id/products`. Reads allow
backend roles; mutations require `backend_write` or `backend_admin` and are
audited. The product replacement body is `{ "productIds": ["..."] }`; array
order becomes product position.

All endpoints return JSON. Error responses follow a consistent structure:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

---

## Health

### `GET /health`

Public. Returns application status.

```json
{ "status": "ok", "uptime": 123.45, "timestamp": "2026-08-28T12:00:00.000Z", "version": "1" }
```

---

## Authentication

All auth responses share this shape:

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": "uuid", "email": "user@example.com", "mobileNumber": "+15551234567", "mobileVerified": true }
}
```

### `POST /auth/register`

Rate-limited: 10 req/min. Creates a new user account with email+password.

**Body**: `{ "email": string, "password": string }`

**Response 201**: Auth response. **Errors**: 400, 409 (duplicate email)

### `POST /auth/login`

Rate-limited: 10 req/min. Email+password login.

**Body**: `{ "email": string, "password": string }`

**Response 200**: Auth response. **Errors**: 400, 401 (invalid credentials)

### `POST /auth/refresh`

Rate-limited: 20 req/min. Rotates a refresh token. One-time use.

**Body**: `{ "refreshToken": string }`

**Response 200**: New auth response. **Errors**: 400, 401 (invalid/expired/reused token)

### `POST /auth/logout`

Invalidates a refresh token. Idempotent.

**Body**: `{ "refreshToken": string }`

**Response 200**: `{ "message": "Logged out successfully" }` **Errors**: 400

### `POST /auth/mobile/request-otp`

Rate-limited: 5 req/min. Request an OTP for mobile login.

**Body**: `{ "mobileNumber": string }` (E.164 preferred, will be normalized)

**Response 200**: `{ "message": "OTP sent", "expiresInSeconds": 300 }`

**Errors**: 400 (invalid mobile), 429 (rate limited, cooldown)

### `POST /auth/mobile/verify-otp`

Rate-limited: 5 req/min. Verify OTP and login/register via mobile.

**Body**: `{ "mobileNumber": string, "otp": string }`

**Response 200**: Auth response. Creates a new user if mobile number is new, or logs in existing user.

**Errors**: 400 (invalid/expired OTP), 429 (too many attempts)

### `POST /auth/google`

Login with Google identity token.

**Body**: `{ "idToken": string }`

**Response 200**: Auth response. Creates new user if first-time login.

**Errors**: 400 (not configured), 401 (invalid token)

### `POST /auth/apple`

Login with Apple identity token.

**Body**: `{ "idToken": string }`

**Response 200**: Auth response. **Errors**: 400 (not configured), 401 (invalid token)

### `POST /auth/facebook`

Login with Facebook access token.

**Body**: `{ "accessToken": string }`

**Response 200**: Auth response. **Errors**: 400 (not configured), 401 (invalid token)

### `POST /auth/mobile/request-verification`

Authenticated. Request OTP to link/verify mobile number on existing account.

**Body**: `{ "mobileNumber": string }`

**Response 200**: `{ "message": "OTP sent", "expiresInSeconds": 300 }`

**Errors**: 400, 401, 429

### `POST /auth/mobile/verify`

Authenticated. Verify OTP and link mobile to current user.

**Body**: `{ "mobileNumber": string, "otp": string }`

**Response 200**: `{ "mobileNumber": "+15551234567", "mobileVerified": true }`

**Errors**: 400, 401, 409 (mobile already associated with another account), 429

---

## Users / Profile

### `GET /users/me`

Authenticated. Returns the current user's profile.

**Response 200**: `{ "id", "email", "displayName", "bio", "avatarUrl", "createdAt", "updatedAt" }`

### `PATCH /users/me`

Authenticated. Updates profile fields. All fields optional.

**Body**: `{ "displayName"?: string | null, "bio"?: string | null, "avatarUrl"?: string | null }`

**Response 200**: Full profile object.

---

## Catalog (Public)

### `GET /categories`

Public. Lists all categories, alphabetically ordered.

**Response 200**: `[{ "id", "name", "slug", "description", "parentId", "createdAt", "updatedAt" }]`

### `GET /categories/:slug`

Public. Returns a category with its active products.

**Response 200**: `{ "category": { ... }, "products": [{ ... }] }`

### `GET /products`

Public. Lists active products with filtering, sorting, and pagination.

**Query params**:

| Param | Type | Description |
|-------|------|-------------|
| `category` | string | Filter by category slug |
| `minPrice` | number | Minimum price (inclusive) |
| `maxPrice` | number | Maximum price (inclusive) |
| `inStock` | boolean | Filter to in-stock products only (`true`) |
| `sort` | enum | Sort order (see below) |
| `limit` | integer | Page size (default 50, max 200) |
| `offset` | integer | Pagination offset (default 0) |

**Sort options**: `name_asc` (default), `name_desc`, `price_asc`, `price_desc`, `newest`

**Response 200**:
```json
{
  "products": [{ "id", "name", "slug", "description", "status", "categoryId", "category", "price", "createdAt", "updatedAt" }],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

Only `status: "active"` products are returned. Draft/archived products are invisible.

### `GET /products/search`

Public. Search active products by name/description with filtering, pagination, and relevance ordering.

**Query params**:

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | **Search query (required when called).** Max 200 chars. ILIKE match on name + description. |
| `category` | string | Filter by category slug |
| `minPrice` | number | Minimum price (inclusive) |
| `maxPrice` | number | Maximum price (inclusive) |
| `inStock` | boolean | Filter to in-stock products only (`true`) |
| `sort` | enum | Sort order: `relevance` (default when q is present), `price_asc`, `price_desc`, `newest`, `name_asc`, `name_desc` |
| `limit` | integer | Page size (default 50, max 200) |
| `offset` | integer | Pagination offset (default 0) |

**Sort options explained**:

- `relevance` (default): Name prefix matches rank highest, then name exact matches, then ILIKE name matches, then description matches. Tiebreaker: alphabetical by name, then by product ID.
- `price_asc` / `price_desc`: NULLS LAST for unpriced products.
- All sorts include product ID as a secondary tiebreaker for deterministic pagination.

**Response 200**: Same paginated shape as `GET /products`.

**Errors**: 400 (empty/whitespace-only q, invalid sort, invalid params)

### `GET /products/:slug`

Public. Returns a single active product by slug.

**Response 200**: Single product object. **404** if not found, draft, or archived.

---

## Inventory

### `GET /products/:slug/inventory`

Public. Returns stock status for an active product.

**Response 200**: `{ "inStock": boolean, "quantity": number }`

Missing inventory row = quantity 0 = out of stock.

### `PUT /products/:slug/inventory`

Requires: `backend_write` or higher. Sets absolute stock quantity. Uses FOR UPDATE transaction.

**Body**: `{ "quantity": integer }` (non-negative)

**Response 200**: `{ "productId", "productSlug", "productName", "quantity" }`

---

## Pricing

### `GET /products/:slug/price`

Public. Returns the price for an active product. Null amount = no price set.

**Response 200**: `{ "amount": string | null }`

### `PUT /products/:slug/price`

Requires: `backend_write` or higher. Sets the price. Uses FOR UPDATE transaction.

**Body**: `{ "amount": number }` (non-negative)

**Response 200**: `{ "productId", "productSlug", "productName", "amount" }`

---

## Cart

All cart endpoints require authentication. Ownership-scoped.

### `GET /cart`

Returns the current user's cart items with product info and total.

**Response 200**:
```json
{
  "items": [{ "id", "productId", "productSlug", "productName", "quantity", "unitPrice", "lineTotal" }],
  "total": "39.98"
}
```

### `POST /cart`

Adds a product or increases quantity (atomic UPSERT). Only active products accepted.

**Body**: `{ "productId": string, "quantity": integer }` (quantity > 0)

**Response 200**: Single cart item. **Errors**: 400 (out of stock, invalid quantity), 404 (product not found/not active)

### `PATCH /cart/:itemId`

Updates quantity of a specific cart item. Ownership-scoped.

**Body**: `{ "quantity": integer }` (positive integer)

**Response 200**: Updated cart item. **Errors**: 400, 404

### `DELETE /cart/:itemId`

Removes a single cart item. Ownership-scoped.

**Response 204**

### `DELETE /cart`

Clears all items from the current user's cart.

**Response 204**

---

## Checkout

### `POST /checkout`

Authenticated. Rate-limited: 10 req/min per user.

**Requires mobile verification**: If the user's `mobile_verified_at` is null, returns 403 with `MOBILE_VERIFICATION_REQUIRED`.

Converts cart into order in a single atomic transaction:

1. Validate mobile verified
2. Lock cart items (FOR UPDATE)
3. Lock existing inventory rows (FOR UPDATE)
4. Validate cart not empty, products active, sufficient stock
5. INSERT order + order_items (snapshot current prices)
6. Decrement inventory atomically with conditional WHERE guard
7. Compute and persist order total
8. Clear cart
9. Create notification

**Response 201**:
```json
{ "orderId": "uuid", "status": "pending", "total": "39.98" }
```

**Errors**: 400 (empty cart, inactive product), 403 (MOBILE_VERIFICATION_REQUIRED), 409 (insufficient stock)

---

## Orders

### `GET /orders`

Authenticated. Lists the current user's orders. Most recent first. Paginated.

**Query**: `?limit=50&offset=0` (default 50, max 200)

**Response 200**: `[{ "id", "status", "total", "createdAt", "updatedAt" }]`

### `GET /orders/:orderId`

Authenticated. Returns a single order with its items. Ownership-scoped.

**Response 200**:
```json
{
  "id": "uuid", "status": "confirmed", "total": "39.98",
  "createdAt": "...", "updatedAt": "...",
  "items": [{ "id", "productId", "productName", "quantity", "unitPrice", "lineTotal" }]
}
```

**Errors**: 404 (not found or not owned)

---

## Payments

### `POST /orders/:orderId/payments`

Authenticated. Creates a payment for an order. Amount sourced from order total (never from client). One payment per order.

**Errors**: 400 (order not pending, no total), 409 (payment already exists)

**Response 201**: `{ "id", "orderId", "amount", "currency", "status", "provider", "providerRef", "createdAt", "updatedAt" }`

### `GET /orders/:orderId/payments`

Authenticated. Returns the payment for an order. Ownership-scoped.

**Response 200**: Payment response.

### `PATCH /orders/:orderId/payments`

Authenticated. Updates payment status. Valid transitions: `pending → completed`, `pending → failed`.

**Body**: `{ "status": "completed" | "failed" }`

**Response 200**: Updated payment.

> **⚠️ No external payment provider is integrated.** Payment status changes are internal-only. In production, implement a real provider (Stripe, etc.) and trigger status changes via webhook, not direct API.

---

## Shipping

### `POST /orders/:orderId/shipping`

Authenticated. Creates shipping information for an order. One per order. Address is snapshotted from the request body.

**Body**: `{ "recipientName", "addressLine1", "addressLine2"?, "city", "state", "postalCode", "countryCode", "phone"? }`

**Response 201**: Shipping response. **Errors**: 400 (validation), 409 (already exists)

### `GET /orders/:orderId/shipping`

Authenticated. Returns shipping information. Ownership-scoped.

**Response 200**: Shipping response.

### `PATCH /orders/:orderId/shipping`

Authenticated. Updates shipping. Only allowed when status is `pending`.

**Body**: Same as create. **Response 200**: Updated shipping response.

---

## Notifications

Notifications are in-app only. No email/push delivery exists.

### `GET /notifications`

Authenticated. Lists the current user's notifications. Most recent first. Paginated.

**Query**: `?limit=50&offset=0` (default 50, max 200)

**Response 200**: `[{ "id", "type", "title", "message", "isRead", "readAt", "createdAt" }]`

### `PATCH /notifications/:id/read`

Authenticated. Marks a notification as read. Ownership-scoped. Idempotent.

**Response 200**: Updated notification.

---

## Reviews

### `POST /products/:slug/reviews`

Authenticated. Rate-limited: 20 req/min per user. Creates a review for an active product.

**Body**: `{ "rating": 1-5, "content"?: string }` (content max 5000 chars)

**Response 201**: `{ "id", "userId", "productId", "rating", "content", "createdAt", "updatedAt" }`

**Errors**: 400 (validation), 404 (product not found/not active), 409 (duplicate review per user/product)

### `GET /products/:slug/reviews`

Public. Returns reviews for an active product with aggregate rating.

**Response 200**:
```json
{ "reviews": [{ "id", "userId", "productId", "rating", "content", "createdAt", "updatedAt" }], "averageRating": "4.5", "reviewCount": 12 }
```

### `GET /account/reviews`

Authenticated. Returns the current user's reviews. Most recent first.

### `PATCH /account/reviews/:reviewId`

Authenticated. Updates the current user's own review. Ownership-scoped.

**Body**: `{ "rating"?: 1-5, "content"?: string | null }`

**Response 200**: Updated review.

### `DELETE /account/reviews/:reviewId`

Authenticated. Deletes the current user's own review. Ownership-scoped.

**Response 204**

---

## Wishlist

### `GET /wishlist`

Authenticated. Returns the current user's wishlist items. Only active products shown. Most recent first.

**Response 200**: `[{ "id", "productId", "productSlug", "productName", "price", "createdAt" }]`

### `POST /wishlist`

Authenticated. Rate-limited: 30 req/min per user. Adds a product to the wishlist. Idempotent (ON CONFLICT DO NOTHING).

**Body**: `{ "productId": string }`

**Response 200**: Wishlist item. **404** if product not found or not active.

### `DELETE /wishlist/:productId`

Authenticated. Removes a product from the wishlist. Ownership-scoped.

**Response 204**

---

## Media / File Upload

All media uploads use `multipart/form-data` with a single `file` field.

**Validation** (applied to all uploads, server-authoritative, never trust client-provided values):
- File extension checked against MIME type (magic bytes are authoritative)
- **Images**: decoded via sharp (integrity, dimensions, max 4096px per side)
- **Videos**: probed via ffprobe (codec, duration, dimensions, max 1920px per side). Supported: H.264, H.265, AV1
- Size limits: 10 MB images, 50 MB videos, 30s max video duration
- Attachment limits: 10 per product, 5 per review

All limits are configuration-driven via env vars.

### Product Media

Requires backend role as noted.

#### `POST /admin/products/:productId/media`

Requires: `backend_write` or higher. Upload a file for a product. Multipart field name: `file`.

**Response 201**:
```json
{
  "id": "uuid", "userId": "uuid", "entityType": "product", "entityId": "uuid",
  "fileType": "image", "mimeType": "image/jpeg", "originalName": "photo.jpg",
  "storagePath": "2026/08/29/1712345678-a1b2c3d4.jpg", "fileSize": 12345,
  "width": 100, "height": 100, "durationSeconds": null,
  "createdAt": "2026-08-29T12:00:00.000Z", "url": "/media/2026/08/29/1712345678-a1b2c3d4.jpg"
}
```

**Errors**: 400 (validation), 401, 403, 404 (product not found), 413 (FILE_TOO_LARGE)

#### `DELETE /admin/products/:productId/media/:mediaId`

Requires: `backend_admin`. Deletes a media item. File removed from storage + DB record.

**Response 204**

#### `PUT /admin/products/:productId/media/reorder`

Requires: `backend_write` or higher. Reorder product media.

**Body**: `{ "mediaIds": ["uuid1", "uuid2", ...] }`

**Response 200**: `{ "reordered": true }`

### Review Media

#### `POST /account/reviews/:reviewId/media`

Authenticated. Upload a file to the current user's own review. Ownership-scoped.

**Response 201**: Same shape as product upload (entityType: "review").

**Errors**: 400, 401, 404 (review not found or not owned)

#### `DELETE /account/reviews/:reviewId/media/:mediaId`

Authenticated. Delete the current user's own review media. Ownership-scoped.

**Response 204**. **Errors**: 401, 403 (not owner), 404

### Public Media Listing

#### `GET /products/:slug/media`

Public. Lists all media for an active product, ordered by sort_order then created_at. Each item includes a `url` field.

**Response 200**: Array of media objects (same shape as upload response).

#### `GET /products/:slug/reviews/:reviewId/media`

Public. Lists all media for a review, ordered by created_at. Each item includes a `url` field.

**Response 200**: Array of media objects.

---

## Back-office (RBAC Protected)

All admin endpoints require authentication + at least one backend role. Customers receive 403.

**Role requirements** are noted per endpoint group.

### Categories

#### `GET /admin/categories`
Requires: `backend_read` or higher. List all categories.

#### `POST /admin/categories`
Requires: `backend_write` or higher. Create a category.
**Body**: `{ "name": string, "slug": string, "description"?: string, "parentId"?: string }`
Name max 100 chars, slug max 120 chars.

#### `GET /admin/categories/:id`
Requires: `backend_read` or higher. Get a category by ID.

#### `PATCH /admin/categories/:id`
Requires: `backend_write` or higher. Update a category. All fields optional.

**Hard-deletion is not available.** Use status-based mechanisms instead.

### Products

#### `GET /admin/products`
Requires: `backend_read` or higher. List all products (any status). Optional `?status=` filter.

#### `POST /admin/products`
Requires: `backend_write` or higher. Create a product. Defaults to `draft` status.
**Body**: `{ "name": string, "slug": string, "description"?: string, "status"?: string, "categoryId"?: string }`
Name max 255, slug max 280.

#### `GET /admin/products/:id`
Requires: `backend_read` or higher. Get a product by ID (any status).

#### `PATCH /admin/products/:id`
Requires: `backend_write` or higher. Update a product. All fields optional.

#### `PATCH /admin/products/:id/status`
Requires: `backend_write` or higher. Change product status.
**Body**: `{ "status": "draft" | "active" | "archived" }`

**Hard-deletion is not available.** Use status changes (archive/draft) instead.

### Inventory (Admin)

#### `GET /admin/products/:slug/inventory`
Requires: `backend_read` or higher. Get inventory (any status).

#### `PUT /admin/products/:slug/inventory`
Requires: `backend_write` or higher. Set inventory. **Body**: `{ "quantity": integer }`

### Pricing (Admin)

#### `GET /admin/products/:slug/price`
Requires: `backend_read` or higher. Get price (any status).

#### `PUT /admin/products/:slug/price`
Requires: `backend_write` or higher. Set price. **Body**: `{ "amount": number }`

### Audit

Requires: `backend_read` or higher.

#### `GET /admin/audit`

Paginated audit log. Ordered by `created_at` DESC. Supports `?limit=`, `?offset=`, `?action=` filter.

**Response 200**:
```json
{
  "entries": [{ "id", "actorId", "actorEmail", "action", "resourceType", "resourceId", "metadata", "createdAt" }],
  "total": 42, "limit": 50, "offset": 0
}
```

### Analytics

Requires: `backend_read` or higher.

#### `GET /admin/analytics/summary`

Compact dashboard overview: order counts, payment stats, product counts, review stats, revenue.

#### `GET /admin/analytics/orders`

Paginated order breakdown with totals by status. Supports `?status=` filter.

#### `GET /admin/analytics/revenue`

Revenue breakdown by payment status. Completed payments are authoritative revenue.

#### `GET /admin/analytics/products`

Top-selling products from `order_items`. Paginated.

### User Management

Requires: `user_management` role.

#### `GET /admin/users`

List backend users (users with at least one backend role). Optional `?role=` filter.

**Response 200**:
```json
[
  { "id": "uuid", "email": "admin@example.com", "roles": ["backend_read", "backend_write", "backend_admin", "user_management"], "createdAt": "..." }
]
```

#### `GET /admin/users/:id`

View a single backend user's details and roles.

**Response 200**: `{ "id", "email", "roles": [...], "createdAt" }`

#### `POST /admin/users`

Create a backend user with roles. Roles validated against the `roles` table.

**Body**: `{ "email": string, "password": string, "roles": ["backend_read", ...] }`

**Response 201**: `{ "id", "email", "roles": [...] }`

**Errors**: 400 (validation, unknown role), 409 (duplicate email)

#### `PUT /admin/users/:id/roles`

Replace all roles for a user. Transactional. Prevents removing `user_management` from the last user who has it.

**Body**: `{ "roles": ["backend_read", "backend_write", ...] }`

**Response 200**: `{ "id", "roles": [...] }`

**Errors**: 400 (validation, unknown role, would remove last user_management)

---

## Pagination Standard

All paginated endpoints return:

```json
{ "data": [...], "total": 42, "limit": 50, "offset": 0 }
```

- `total`: count matching the current filters (not just the page)
- `limit`: max 200, default 50
- `offset`: default 0

Endpoints using pagination: products, search, orders, notifications, admin/audit, admin/analytics/orders, admin/analytics/products, admin/users

---

## Error Contract

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

**Common error codes**:

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Invalid/missing input |
| `BAD_REQUEST` | 400 | Invalid request |
| `UNAUTHORIZED` | 401 | No/invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `MOBILE_VERIFICATION_REQUIRED` | 403 | Mobile not verified |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate/state conflict |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds 100KB limit |
| `FILE_TOO_LARGE` | 413 | Upload exceeds size limit |
| `TOO_MANY_REQUESTS` | 429 | Rate limited |
| `INTERNAL_ERROR` | 500 | Server error |

---

## HTTP Status Code Summary

| Code | Usage |
|------|-------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (deletion) |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized |
| 403 | Forbidden / Mobile Verification Required |
| 404 | Not Found |
| 409 | Conflict |
| 413 | Payload Too Large |
| 429 | Rate Limited |
| 500 | Internal Server Error |
