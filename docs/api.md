# Mercury — API Reference

All endpoints return JSON. Error responses follow a consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

**Error codes**: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `VALIDATION_ERROR`, `CONFLICT`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`, `PAYLOAD_TOO_LARGE`

---

## Health

### `GET /health`

Public. Returns application status.

```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-08-28T12:00:00.000Z",
  "version": "1"
}
```

---

## Authentication

### `POST /auth/register`

Rate-limited: 10 req/min. Creates a new user account.

**Body**: `{ "email": string, "password": string }`

**Response 201**:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": "uuid", "email": "user@example.com" }
}
```

**Errors**: 400 (validation), 409 (duplicate email)

### `POST /auth/login`

Rate-limited: 10 req/min. Authenticates and returns tokens.

**Body**: `{ "email": string, "password": string }`

**Response 200**: Same shape as registration.

**Errors**: 400 (validation), 401 (invalid credentials)

### `POST /auth/refresh`

Rate-limited: 20 req/min. Rotates a refresh token. One-time use; previous tokens are invalidated.

**Body**: `{ "refreshToken": string }`

**Response 200**: New access + refresh tokens.

**Errors**: 400 (validation), 401 (invalid/expired/reused token)

### `POST /auth/logout`

Invalidates a refresh token. Idempotent.

**Body**: `{ "refreshToken": string }`

**Response 200**: `{ "message": "Logged out successfully" }`

**Errors**: 400 (validation)

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

Public. Lists active products. Optional `?category=` filter by slug.

**Response 200**: `[{ "id", "name", "slug", "description", "status", "categoryId", "category", "price", "createdAt", "updatedAt" }]`

### `GET /products/:slug`

Public. Returns a single active product by slug.

**Response 200**: Full product response. **404** if not found or not active.

### `GET /products/search?q=<query>`

Public. Searches active products by name and description using PostgreSQL ILIKE + pg_trgm. Max query length: 200 characters. Max 50 results. Alphabetical ordering.

**Response 200**: Array of product responses.

---

## Inventory

### `GET /products/:slug/inventory`

Public. Returns stock status for an active product.

**Response 200**: `{ "inStock": boolean, "quantity": number }`

### `PUT /products/:slug/inventory`

Authenticated. Sets absolute stock quantity. Uses FOR UPDATE transaction.

**Body**: `{ "quantity": integer }` (non-negative)

**Response 200**: `{ "productId", "productSlug", "productName", "quantity" }`

---

## Pricing

### `GET /products/:slug/price`

Public. Returns the price for an active product. Null amount = no price set.

**Response 200**: `{ "amount": string | null }`

### `PUT /products/:slug/price`

Authenticated. Sets the price. Uses FOR UPDATE transaction.

**Body**: `{ "amount": number }` (non-negative, max 2 decimal places)

**Response 200**: `{ "productId", "productSlug", "productName", "amount" }`

---

## Cart

### `GET /cart`

Authenticated. Returns the current user's cart items with product info and total.

**Response 200**:
```json
{
  "items": [
    {
      "id": "uuid",
      "productId": "uuid",
      "productSlug": "product-slug",
      "productName": "Product Name",
      "quantity": 2,
      "unitPrice": "19.99",
      "lineTotal": "39.98"
    }
  ],
  "total": "39.98"
}
```

### `POST /cart`

Authenticated. Adds a product or increases quantity (atomic UPSERT).

**Body**: `{ "productId": string, "quantity": integer }`

**Response 200**: Single cart item. **400** if out of stock. **404** if product not found or not active.

### `PATCH /cart/:itemId`

Authenticated. Updates the quantity of a specific cart item. Ownership-scoped.

**Body**: `{ "quantity": integer }`

**Response 200**: Updated cart item.

### `DELETE /cart/:itemId`

Authenticated. Removes a single cart item. Ownership-scoped.

**Response 204**

### `DELETE /cart`

Authenticated. Clears all items from the current user's cart.

**Response 204**

---

## Checkout

### `POST /checkout`

Authenticated. Rate-limited: 10 req/min per user. Converts the current cart into an order. Single atomic transaction.

**Response 201**:
```json
{
  "orderId": "uuid",
  "status": "pending",
  "total": "39.98"
}
```

**Errors**: 400 (empty cart, inactive product), 409 (insufficient stock)

---

## Orders

### `GET /orders`

Authenticated. Lists the current user's orders. Paginated (default limit 50, max 200). Oldest first.

**Query**: `?limit=50&offset=0`

**Response 200**: `[{ "id", "status", "total", "createdAt", "updatedAt" }]`

### `GET /orders/:orderId`

Authenticated. Returns a single order with its items. Ownership-scoped.

**Response 200**:
```json
{
  "id": "uuid",
  "status": "confirmed",
  "total": "39.98",
  "createdAt": "...",
  "updatedAt": "...",
  "items": [
    {
      "id": "uuid",
      "productId": "uuid",
      "productName": "Product Name",
      "quantity": 2,
      "unitPrice": "19.99",
      "lineTotal": "39.98"
    }
  ]
}
```

---

## Payments

### `POST /orders/:orderId/payments`

Authenticated. Creates a payment for an order. Amount is sourced from the persisted order total — never from client input. One payment per order.

**Response 201**: `{ "id", "orderId", "amount", "currency", "status", "provider", "providerRef", "createdAt", "updatedAt" }`

**Errors**: 400 (order not pending, no total), 409 (payment already exists)

### `GET /orders/:orderId/payments`

Authenticated. Returns the payment for an order. Ownership-scoped.

**Response 200**: Payment response.

### `PATCH /orders/:orderId/payments`

Authenticated. Updates the payment status. Valid transitions: `pending → completed`, `pending → failed`.

**Body**: `{ "status": "completed" | "failed" }`

**Response 200**: Updated payment.

> **⚠️ Security note**: This is currently a provider-independent internal transition. In production, payment status changes should be triggered by a real payment provider webhook, not a direct API call.

---

## Shipping

### `POST /orders/:orderId/shipping`

Authenticated. Creates shipping information for an order. One shipping record per order. Address is snapshotted from the request body.

**Body**: `{ "recipientName", "addressLine1", "addressLine2"?, "city", "state", "postalCode", "countryCode", "phone"? }`

**Response 201**: Shipping response.

### `GET /orders/:orderId/shipping`

Authenticated. Returns shipping information. Ownership-scoped.

**Response 200**: Shipping response.

### `PATCH /orders/:orderId/shipping`

Authenticated. Updates shipping. Only allowed when status is `pending`.

**Body**: Same as create.

**Response 200**: Updated shipping response.

---

## Notifications

### `GET /notifications`

Authenticated. Lists the current user's notifications. Most recent first. Paginated (default limit 50, max 200).

**Query**: `?limit=50&offset=0`

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

**Errors**: 400 (validation), 404 (product not found/not active), 409 (duplicate review)

### `GET /products/:slug/reviews`

Public. Returns reviews for an active product with aggregate rating.

**Response 200**:
```json
{
  "reviews": [{ "id", "userId", "productId", "rating", "content", "createdAt", "updatedAt" }],
  "averageRating": "4.5",
  "reviewCount": 12
}
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

Authenticated. Returns the current user's wishlist items. Most recent first.

**Response 200**: `[{ "id", "productId", "productSlug", "productName", "price", "createdAt" }]`

### `POST /wishlist`

Authenticated. Rate-limited: 30 req/min per user. Adds a product to the wishlist. Idempotent (ON CONFLICT DO NOTHING).

**Body**: `{ "productId": string }`

**Response 200**: Wishlist item. **404** if product not found or not active.

### `DELETE /wishlist/:productId`

Authenticated. Removes a product from the wishlist. Ownership-scoped (by product_id).

**Response 204**

---

## Admin (Authenticated + Admin role required)

All admin endpoints require `authenticate` + `authorize('admin')` middleware. Ordinary users receive 403.

### Categories

#### `GET /admin/categories`
List all categories.

#### `POST /admin/categories`
Create a category. **Body**: `{ "name": string, "slug": string, "description"?: string, "parentId"?: string }`
Name max 100 chars, slug max 120 chars.

#### `GET /admin/categories/:id`
Get a category by ID.

#### `PATCH /admin/categories/:id`
Update a category. All fields optional.

#### `DELETE /admin/categories/:id`
Delete a category. **409** if it has child categories or products.

### Products

#### `GET /admin/products`
List all products (any status). Optional `?status=` filter.

#### `POST /admin/products`
Create a product. Name max 255 chars, slug max 280 chars. Defaults to `draft` status.

**Body**: `{ "name": string, "slug": string, "description"?: string, "status"?: string, "categoryId"?: string }`

#### `GET /admin/products/:id`
Get a product by ID (any status).

#### `PATCH /admin/products/:id`
Update a product. All fields optional.

#### `DELETE /admin/products/:id`
Delete a product. **400** if it has associated orders.

#### `PATCH /admin/products/:id/status`
Change product status. **Body**: `{ "status": "draft" | "active" | "archived" }`

### Inventory (Admin)

#### `GET /admin/products/:slug/inventory`
Get inventory for a product (any status, unlike public).

#### `PUT /admin/products/:slug/inventory`
Set inventory. Reuses existing `setInventory` logic. **Body**: `{ "quantity": integer }`

### Pricing (Admin)

#### `GET /admin/products/:slug/price`
Get price for a product (any status, unlike public).

#### `PUT /admin/products/:slug/price`
Set price. Reuses existing `setPrice` logic. **Body**: `{ "amount": number }`

### Audit

#### `GET /admin/audit`

Paginated audit log. Ordered by `created_at` DESC. Admin-only.

**Query**: `?limit=50&offset=0&action=product.create`

**Response 200**:
```json
{
  "entries": [
    {
      "id": "uuid",
      "actorId": "uuid",
      "actorEmail": "admin@example.com",
      "action": "product.create",
      "resourceType": "product",
      "resourceId": "uuid",
      "metadata": { "name": "Product Name", "slug": "product-name" },
      "createdAt": "..."
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### Analytics

#### `GET /admin/analytics/summary`

Compact dashboard overview. Returns order counts by status, payment stats, user counts, product counts by status, review stats, and revenue.

#### `GET /admin/analytics/orders`

Paginated order list with totals by status. Optional `?status=` filter.

#### `GET /admin/analytics/revenue`

Revenue breakdown. **Completed payments only** are authoritative revenue. Includes breakdown by status and currency.

**Revenue definition**: `SUM(payments.amount) WHERE payments.status = 'completed'`

#### `GET /admin/analytics/products`

Top-selling products from `order_items`. Paginated.

---

## HTTP Status Code Summary

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (deletion) |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized (missing/invalid auth) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 409 | Conflict (duplicate, state conflict) |
| 413 | Payload Too Large |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |