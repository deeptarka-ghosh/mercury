import { Router } from 'express';
import { authenticate, requireAnyRole, requireAllRoles, isBackendRole, getUserRoles } from '../../auth/middleware.js';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { recordAudit } from './service.js';
import { setInventory } from '../inventory/service.js';
import { setPrice } from '../pricing/service.js';
import { hashPassword } from '../../auth/password.js';
import {
  listVariants,
  getVariant,
  createVariant,
  updateVariant,
  setVariantStatus,
  setVariantInventory,
  setVariantPricing,
} from '../variants/service.js';
import {
  listAdminOrders,
  getAdminOrder,
  updateOrderStatus,
  cancelOrder,
  createRefund,
  updateShippingStatus,
} from './orderService.js';
import {
  listCustomers,
  getCustomerDetail,
  updateCustomerStatus,
  listCustomerOrders,
} from './customerService.js';
import {
  getStoreSettings,
  updateStoreSettings,
} from './settingsService.js';
import {
  listReturns,
  getReturnDetail,
  updateReturnStatus,
  updateShipmentTracking,
} from './returnsService.js';
import {
  listAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  listAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  setProductStatus,
} from './service.js';

const router = Router();

// Public, deliberately non-sensitive branding/locale projection for storefronts.
router.get('/settings/store', async (_req, res, next) => {
  try {
    const settings = await getStoreSettings();
    res.json({ storeName: settings.storeName, defaultCurrency: settings.defaultCurrency, countryCode: settings.countryCode, timezone: settings.timezone, locale: settings.locale, supportEmail: settings.supportEmail, supportMobile: settings.supportMobile });
  } catch (error) { next(error); }
});

// All admin routes require authentication + at least one backend role
router.use('/admin', authenticate, requireAnyRole(
  'backend_read', 'backend_write', 'backend_admin', 'user_management',
));

// ===================== Category Read (backend_read or higher) =====================

router.get('/admin/categories', async (_req, res, next) => {
  try {
    const categories = await listAllCategories();
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/categories/:id', async (req, res, next) => {
  try {
    const result = await getCategoryById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Category Write (backend_write or higher) =====================

router.post('/admin/categories', async (req, res, next) => {
  try {
    // Require write or higher for mutations
    await enforceRole(req, 'backend_write', 'backend_admin');

    const body = req.body as { name?: unknown; slug?: unknown; description?: unknown; parentId?: unknown; audience?: unknown; sortOrder?: unknown };

    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
      return;
    }
    if (!body.slug || typeof body.slug !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'slug is required' } });
      return;
    }
    if (body.name.length > 100) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name must be at most 100 characters' } });
      return;
    }
    if (body.slug.length > 120) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'slug must be at most 120 characters' } });
      return;
    }

    const result = await createCategory({
      name: body.name,
      slug: body.slug,
      description: body.description === undefined ? null : (body.description as string | null),
      parentId: body.parentId === undefined ? null : (body.parentId as string | null),
      audience: body.audience === undefined ? null : (body.audience as string | null),
      sortOrder: body.sortOrder === undefined ? 0 : Number(body.sortOrder),
    });

    await recordAudit(req.user!.id, 'category.create', 'category', result.id, {
      name: result.name,
      slug: result.slug,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/categories/:id', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { name, slug, description, parentId, audience, sortOrder } = req.body as {
      name?: string; slug?: string; description?: string | null; parentId?: string | null; audience?: string | null; sortOrder?: number;
    };
    const result = await updateCategory(req.params.id, { name, slug, description, parentId, audience, sortOrder });

    await recordAudit(req.user!.id, 'category.update', 'category', result.id, {
      changes: { name, slug, description, parentId, audience, sortOrder },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// NOTE: Category hard-delete endpoint is intentionally removed.
// Use status/active-state mechanisms rather than destructive deletion.

// ===================== Product Read (backend_read or higher) =====================

router.get('/admin/products', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const products = await listAllProducts(status || undefined);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/products/:id', async (req, res, next) => {
  try {
    const result = await getProductById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/products/:slug/inventory', async (req, res, next) => {
  try {
    const db = getDatabase();
    const row = await db
      .selectFrom('products')
      .leftJoin('inventory', 'inventory.product_id', 'products.id')
      .select(['inventory.quantity'])
      .where('products.slug', '=', req.params.slug)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('Product not found');
    res.json({ productSlug: req.params.slug, quantity: row.quantity ?? 0, inStock: (row.quantity ?? 0) > 0 });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/products/:slug/price', async (req, res, next) => {
  try {
    const db = getDatabase();
    const row = await db
      .selectFrom('products')
      .leftJoin('prices', 'prices.product_id', 'products.id')
      .select([
        'products.name',
        'products.slug',
        'products.id',
        sql<string | null>`CAST(prices.amount AS TEXT)`.as('amount'),
      ])
      .where('products.slug', '=', req.params.slug)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('Product not found');
    res.json({ productId: row.id, productSlug: row.slug, productName: row.name, amount: row.amount ?? null });
  } catch (err) {
    next(err);
  }
});

// ===================== Product Write (backend_write or higher) =====================

router.post('/admin/products', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const body = req.body as { name?: unknown; slug?: unknown; description?: unknown; status?: unknown; categoryId?: unknown; audience?: unknown; material?: unknown; fit?: unknown; careInstructions?: unknown; badge?: unknown; merchandisingPriority?: unknown };

    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
      return;
    }
    if (!body.slug || typeof body.slug !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'slug is required' } });
      return;
    }
    if (body.name.length > 255) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name must be at most 255 characters' } });
      return;
    }
    if (body.slug.length > 280) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'slug must be at most 280 characters' } });
      return;
    }

    const result = await createProduct({
      name: body.name,
      slug: body.slug,
      description: body.description === undefined ? null : (body.description as string | null),
      status: body.status === undefined ? 'draft' : (body.status as string),
      categoryId: body.categoryId === undefined ? null : (body.categoryId as string | null),
      audience: body.audience === undefined ? null : (body.audience as string | null), material: body.material === undefined ? null : (body.material as string | null), fit: body.fit === undefined ? null : (body.fit as string | null), careInstructions: body.careInstructions === undefined ? null : (body.careInstructions as string | null), badge: body.badge === undefined ? null : (body.badge as string | null), merchandisingPriority: body.merchandisingPriority === undefined ? 0 : Number(body.merchandisingPriority),
    });

    await recordAudit(req.user!.id, 'product.create', 'product', result.id, {
      name: result.name,
      slug: result.slug,
      status: result.status,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/products/:id', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { name, slug, description, status, categoryId, audience, material, fit, careInstructions, badge, merchandisingPriority } = req.body as {
      name?: string; slug?: string; description?: string | null; status?: string; categoryId?: string | null; audience?: string | null; material?: string | null; fit?: string | null; careInstructions?: string | null; badge?: string | null; merchandisingPriority?: number;
    };
    const result = await updateProduct(req.params.id, { name, slug, description, status, categoryId, audience, material, fit, careInstructions, badge, merchandisingPriority });

    await recordAudit(req.user!.id, 'product.update', 'product', result.id, {
      changes: { name, slug, description, status, categoryId, audience, material, fit, careInstructions, badge, merchandisingPriority },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/products/:id/status', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { status } = req.body as { status?: unknown };

    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
      return;
    }

    const result = await setProductStatus(req.params.id, status);

    await recordAudit(req.user!.id, 'product.status_change', 'product', result.id, {
      newStatus: result.status,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// NOTE: Product hard-delete endpoint is intentionally removed.
// Use status changes (draft/active/archived) rather than destructive deletion.

// ===================== Product Variants — Read (backend_read or higher) =====================

/**
 * GET /admin/products/:productId/variants
 * List all variants for a product.
 */
router.get('/admin/products/:productId/variants', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const result = await listVariants(req.params.productId, limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/products/:productId/variants/:variantId
 * Get a single variant.
 */
router.get('/admin/products/:productId/variants/:variantId', async (req, res, next) => {
  try {
    const result = await getVariant(req.params.productId, req.params.variantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Product Variants — Write (backend_write or higher) =====================

/**
 * POST /admin/products/:productId/variants
 * Create a new variant.
 */
router.post('/admin/products/:productId/variants', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const body = req.body as {
      sku?: unknown; barcode?: unknown; size?: unknown; colourName?: unknown;
      colourCode?: unknown; sellingPrice?: unknown; mrp?: unknown;
      costPrice?: unknown; quantity?: unknown; lowStockThreshold?: unknown; status?: unknown;
    };

    const result = await createVariant(req.params.productId, {
      sku: body.sku as string,
      barcode: body.barcode === undefined ? null : (body.barcode as string | null),
      size: body.size as string,
      colourName: body.colourName as string,
      colourCode: body.colourCode === undefined ? null : (body.colourCode as string | null),
      sellingPrice: body.sellingPrice as number,
      mrp: body.mrp as number,
      costPrice: body.costPrice === undefined ? null : (body.costPrice as number | null),
      quantity: body.quantity === undefined ? 0 : (body.quantity as number),
      lowStockThreshold: body.lowStockThreshold === undefined ? null : (body.lowStockThreshold as number | null),
      status: body.status as string | undefined,
    });

    await recordAudit(req.user!.id, 'variant.create', 'variant', result.id, {
      productId: req.params.productId,
      sku: result.sku,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/products/:productId/variants/:variantId
 * Update variant fields.
 */
router.patch('/admin/products/:productId/variants/:variantId', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { sku, barcode, size, colourName, colourCode, sellingPrice, mrp, costPrice, lowStockThreshold } = req.body as {
      sku?: string; barcode?: string | null; size?: string; colourName?: string;
      colourCode?: string | null; sellingPrice?: number; mrp?: number;
      costPrice?: number | null; lowStockThreshold?: number | null;
    };

    const result = await updateVariant(req.params.productId, req.params.variantId, {
      sku, barcode, size, colourName, colourCode, sellingPrice, mrp, costPrice, lowStockThreshold,
    });

    await recordAudit(req.user!.id, 'variant.update', 'variant', result.id, {
      changes: { sku, size, colourName, sellingPrice, mrp },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/products/:productId/variants/:variantId/status
 * Archive or activate a variant.
 */
router.patch('/admin/products/:productId/variants/:variantId/status', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { status } = req.body as { status?: unknown };

    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
      return;
    }

    const result = await setVariantStatus(req.params.productId, req.params.variantId, status);

    await recordAudit(req.user!.id, 'variant.status_change', 'variant', result.id, {
      newStatus: result.status,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/products/:productId/variants/:variantId/inventory
 * Set variant inventory quantity (concurrency-safe).
 */
router.put('/admin/products/:productId/variants/:variantId/inventory', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { quantity } = req.body as { quantity?: unknown };

    if (quantity === undefined || quantity === null) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'quantity is required' } });
      return;
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'quantity must be an integer' } });
      return;
    }

    const result = await setVariantInventory(req.params.productId, req.params.variantId, quantity);

    await recordAudit(req.user!.id, 'variant.inventory_set', 'variant', result.id, {
      newQuantity: quantity,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/products/:productId/variants/:variantId/pricing
 * Set variant pricing (concurrency-safe).
 */
router.put('/admin/products/:productId/variants/:variantId/pricing', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { sellingPrice, mrp, costPrice } = req.body as {
      sellingPrice?: unknown; mrp?: unknown; costPrice?: unknown;
    };

    if (sellingPrice === undefined || sellingPrice === null) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'sellingPrice is required' } });
      return;
    }
    if (mrp === undefined || mrp === null) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'mrp is required' } });
      return;
    }

    const result = await setVariantPricing(
      req.params.productId,
      req.params.variantId,
      sellingPrice as number,
      mrp as number,
      costPrice === undefined ? undefined : (costPrice as number | null),
    );

    await recordAudit(req.user!.id, 'variant.pricing_set', 'variant', result.id, {
      sellingPrice: result.sellingPrice,
      mrp: result.mrp,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Inventory & Pricing Write (backend_write or higher) =====================

router.put('/admin/products/:slug/inventory', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { quantity } = req.body as { quantity?: unknown };

    if (quantity === undefined || quantity === null) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'quantity is required' } });
      return;
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'quantity must be an integer' } });
      return;
    }

    const result = await setInventory(req.params.slug, quantity);

    await recordAudit(req.user!.id, 'inventory.set', 'inventory', result.productId, {
      productSlug: req.params.slug,
      newQuantity: quantity,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.put('/admin/products/:slug/price', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { amount } = req.body as { amount?: unknown };

    if (amount === undefined || amount === null) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'amount is required' } });
      return;
    }
    if (typeof amount !== 'number') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'amount must be a number' } });
      return;
    }

    const result = await setPrice(req.params.slug, amount);

    await recordAudit(req.user!.id, 'price.set', 'price', result.productId, {
      productSlug: req.params.slug,
      newAmount: result.amount,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Session Identity (backend_read or higher) =====================

/**
 * GET /admin/me
 * Returns the authenticated user's identity and backend roles.
 * Roles are read from the database (server-authoritative, not from JWT).
 */
router.get('/admin/me', async (req, res, next) => {
  try {
    const db = getDatabase();
    const user = await db
      .selectFrom('users')
      .select(['users.id', 'users.email', 'users.mobile_number', 'users.mobile_verified_at'])
      .where('users.id', '=', req.user!.id)
      .executeTakeFirst();

    if (!user) {
      throw AppError.notFound('User not found');
    }

    const roles = await getUserRoles(user.id);

    res.json({
      id: user.id,
      email: user.email,
      mobileNumber: user.mobile_number ?? null,
      mobileVerified: user.mobile_verified_at !== null && user.mobile_number !== null,
      roles,
    });
  } catch (err) {
    next(err);
  }
});

// ===================== Audit & Analytics (backend_read or higher) =====================

router.get('/admin/audit', async (req, res, next) => {
  try {
    const db = getDatabase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const actionFilter = req.query.action as string | undefined;

    let query = db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.actor_id')
      .select([
        'audit_log.id',
        'audit_log.actor_id',
        'users.email as actor_email',
        'audit_log.action',
        'audit_log.resource_type',
        'audit_log.resource_id',
        'audit_log.metadata',
        'audit_log.created_at',
      ])
      .orderBy('audit_log.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (actionFilter) {
      query = query.where('audit_log.action', '=', actionFilter);
    }

    const rows = await query.execute();

    let countQuery = db
      .selectFrom('audit_log')
      .select(sql<number>`COUNT(*)`.as('total'));
    if (actionFilter) {
      countQuery = countQuery.where('audit_log.action', '=', actionFilter);
    }
    const countResult = await countQuery.executeTakeFirstOrThrow();

    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorEmail: r.actor_email ?? null,
        action: r.action,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        metadata: r.metadata,
        createdAt: r.created_at,
      })),
      total: Number(countResult.total),
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

// ===================== Analytics =====================

router.get('/admin/analytics/summary', async (_req, res, next) => {
  try {
    const db = getDatabase();

    const orderStats = await db
      .selectFrom('orders')
      .select([
        sql<string>`status`.as('status'),
        sql<number>`COUNT(*)::int`.as('count'),
      ])
      .groupBy('status')
      .orderBy('status')
      .execute();

    const paymentStats = await db
      .selectFrom('payments')
      .select([
        sql<string>`status`.as('status'),
        sql<number>`COUNT(*)::int`.as('count'),
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('total'),
      ])
      .groupBy('status')
      .orderBy('status')
      .execute();

    // Backend users (any with roles)
    const backendUserCount = await db
      .selectFrom('user_roles')
      .select(sql<number>`COUNT(DISTINCT user_id)::int`.as('count'))
      .executeTakeFirstOrThrow();

    // User counts
    const userCounts = await db
      .selectFrom('users')
      .select([sql<number>`COUNT(*)::int`.as('total')])
      .executeTakeFirstOrThrow();

    // Product counts by status
    const productStats = await db
      .selectFrom('products')
      .select([
        sql<string>`status`.as('status'),
        sql<number>`COUNT(*)::int`.as('count'),
      ])
      .groupBy('status')
      .orderBy('status')
      .execute();

    // Review stats
    const reviewStats = await db
      .selectFrom('reviews')
      .select([
        sql<number>`COUNT(*)::int`.as('total'),
        sql<string | null>`CAST(AVG(rating) AS TEXT)`.as('averageRating'),
      ])
      .executeTakeFirstOrThrow();

    // Revenue
    const revenue = await db
      .selectFrom('payments')
      .select([
        sql<string | null>`CAST(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) AS TEXT)`.as('completedRevenue'),
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('totalPayments'),
      ])
      .executeTakeFirstOrThrow();

    res.json({
      orders: orderStats,
      payments: paymentStats,
      users: {
        total: userCounts.total,
        backendUsers: backendUserCount.count,
      },
      products: productStats,
      reviews: {
        total: reviewStats.total,
        averageRating: reviewStats.averageRating,
      },
      revenue: {
        completedRevenue: revenue.completedRevenue,
        totalPayments: revenue.totalPayments,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/analytics/orders', async (req, res, next) => {
  try {
    const db = getDatabase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const statusFilter = req.query.status as string | undefined;

    let query = db
      .selectFrom('orders')
      .select([
        sql<string>`COALESCE(COUNT(*)::int, 0)`.as('count'),
        sql<string>`status`.as('status'),
        sql<string | null>`CAST(SUM(total) AS TEXT)`.as('total'),
      ])
      .groupBy('status')
      .orderBy('status');

    if (statusFilter) {
      query = query.where('orders.status', '=', statusFilter);
    }

    const rows = await query.execute();

    res.json({ orders: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/analytics/revenue', async (_req, res, next) => {
  try {
    const db = getDatabase();

    const rows = await db
      .selectFrom('payments')
      .select([
        sql<string>`status`.as('status'),
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('total'),
        sql<number>`COUNT(*)::int`.as('count'),
      ])
      .groupBy('status')
      .orderBy('status')
      .execute();

    const completedPayment = rows.find((r) => r.status === 'completed');
    const breakdown = rows;
    const byCurrency = await db
      .selectFrom('payments')
      .select([
        sql<string>`'USD'`.as('currency'),
        sql<string | null>`CAST(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) AS TEXT)`.as('completed'),
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('total'),
      ])
      .execute();

    res.json({
      payments: rows,
      completedRevenue: completedPayment?.total ?? null,
      completedPaymentCount: completedPayment?.count ?? 0,
      breakdown,
      byCurrency,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/analytics/products', async (req, res, next) => {
  try {
    const db = getDatabase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    const rows = await db
      .selectFrom('order_items')
      .select([
        'order_items.product_id',
        'order_items.product_name',
        sql<number>`COALESCE(SUM(order_items.quantity), 0)::int`.as('totalSold'),
        sql<string | null>`CAST(SUM(order_items.line_total) AS TEXT)`.as('totalRevenue'),
      ])
      .groupBy(['order_items.product_id', 'order_items.product_name'])
      .orderBy('totalSold', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({ products: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ===================== Admin Order Management =====================

// Read: backend_read, backend_write, or backend_admin
// Write: backend_write or backend_admin
// Sensitive (refunds): backend_admin

/**
 * GET /admin/orders
 * List orders with filtering, search, and pagination.
 */
router.get('/admin/orders', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await listAdminOrders({
      limit,
      offset,
      search: req.query.search as string | undefined,
      status: req.query.status as string | undefined,
      paymentStatus: req.query.paymentStatus as string | undefined,
      shippingStatus: req.query.shippingStatus as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      sort: req.query.sort as 'newest' | 'oldest' | 'total_asc' | 'total_desc' | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/orders/:orderId
 * Get full order detail (no ownership filter).
 */
router.get('/admin/orders/:orderId', async (req, res, next) => {
  try {
    const result = await getAdminOrder(req.params.orderId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/orders/:orderId/status
 * Transition order status with validation.
 */
router.patch('/admin/orders/:orderId/status', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { status, reason } = req.body as { status?: unknown; reason?: unknown };
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
      return;
    }

    const result = await updateOrderStatus(
      req.params.orderId,
      status,
      req.user!.id,
      typeof reason === 'string' ? reason : undefined,
    );

    await recordAudit(req.user!.id, 'order.status_change', 'order', req.params.orderId, {
      newStatus: status,
      reason,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/orders/:orderId/shipping-status
 * Update the shipping record's status.
 */
router.patch('/admin/orders/:orderId/shipping-status', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { status } = req.body as { status?: unknown };
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
      return;
    }

    await updateShippingStatus(req.params.orderId, status);

    await recordAudit(req.user!.id, 'order.shipping_status_change', 'order', req.params.orderId, {
      shippingStatus: status,
    });

    res.json({ message: 'Shipping status updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/orders/:orderId/cancel
 * Cancel an order (idempotent).
 */
router.post('/admin/orders/:orderId/cancel', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { reason } = req.body as { reason?: unknown };

    const result = await cancelOrder(
      req.params.orderId,
      req.user!.id,
      typeof reason === 'string' ? reason : undefined,
    );

    await recordAudit(req.user!.id, 'order.cancel', 'order', req.params.orderId, {
      reason,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/orders/:orderId/refunds
 * Record a refund (backend_admin only).
 */
router.post('/admin/orders/:orderId/refunds', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_admin');

    const { amount, currency, reason } = req.body as {
      amount?: unknown; currency?: unknown; reason?: unknown;
    };

    if (amount === undefined || amount === null || typeof amount !== 'number') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'amount is required and must be a number' } });
      return;
    }

    const result = await createRefund(
      req.params.orderId,
      amount,
      (typeof currency === 'string' ? currency : 'USD'),
      typeof reason === 'string' ? reason : undefined,
      req.user!.id,
    );

    await recordAudit(req.user!.id, 'order.refund_created', 'order', req.params.orderId, {
      refundId: result.id,
      amount: result.amount,
      currency: result.currency,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Customer Management =====================

/**
 * GET /admin/customers
 * List customers (users without backend roles).
 */
router.get('/admin/customers', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_read', 'backend_write', 'backend_admin');

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await listCustomers({
      limit,
      offset,
      search: req.query.search as string | undefined,
      status: req.query.status as string | undefined,
      mobileVerified: req.query.mobileVerified === 'true' ? true : req.query.mobileVerified === 'false' ? false : undefined,
      sort: req.query.sort as 'newest' | 'oldest' | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/customers/:customerId
 * Get customer detail including profile, identities, order summary.
 */
router.get('/admin/customers/:customerId', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_read', 'backend_write', 'backend_admin');
    const result = await getCustomerDetail(req.params.customerId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/customers/:customerId/status
 * Enable or disable a customer account (backend_admin only).
 */
router.patch('/admin/customers/:customerId/status', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_admin');

    const { status } = req.body as { status?: unknown };
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required (active or disabled)' } });
      return;
    }

    const result = await updateCustomerStatus(
      req.params.customerId,
      status,
      req.user!.id,
    );

    await recordAudit(req.user!.id, 'customer.status_change', 'customer', req.params.customerId, {
      newStatus: status,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/customers/:customerId/orders
 * List orders for a specific customer.
 */
router.get('/admin/customers/:customerId/orders', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_read', 'backend_write', 'backend_admin');

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await listCustomerOrders(req.params.customerId, limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Store Settings =====================

/**
 * GET /admin/settings/store
 * Read the store configuration (backend_read or higher).
 */
router.get('/admin/settings/store', async (req, res, next) => {
  try {
    const result = await getStoreSettings();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/settings/store
 * Update store configuration (backend_admin only).
 */
router.patch('/admin/settings/store', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_admin');

    const result = await updateStoreSettings(req.body as Record<string, unknown>);

    await recordAudit(req.user!.id, 'settings.store_update', 'settings', null, {
      changes: Object.keys(req.body as Record<string, unknown>),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===================== Returns & Tracking =====================

/**
 * GET /admin/returns
 * List return requests (backend_read or higher).
 */
router.get('/admin/returns', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await listReturns(limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/returns/:returnId
 * Get return request detail.
 */
router.get('/admin/returns/:returnId', async (req, res, next) => {
  try {
    const result = await getReturnDetail(req.params.returnId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/returns/:returnId/status
 * Approve, reject, or progress a return (backend_write or backend_admin).
 */
router.patch('/admin/returns/:returnId/status', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { status } = req.body as { status?: unknown };
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
      return;
    }

    const result = await updateReturnStatus(req.params.returnId, status, req.user!.id);

    await recordAudit(req.user!.id, 'return.status_change', 'return', req.params.returnId, {
      newStatus: status,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/orders/:orderId/shipping/tracking
 * Update shipment tracking info.
 */
router.put('/admin/orders/:orderId/shipping/tracking', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

    const { provider, trackingNumber, trackingUrl } = req.body as {
      provider?: string; trackingNumber?: string; trackingUrl?: string;
    };

    await updateShipmentTracking(req.params.orderId, {
      provider,
      number: trackingNumber,
      url: trackingUrl,
    });

    await recordAudit(req.user!.id, 'order.tracking_updated', 'order', req.params.orderId, {
      provider,
    });

    res.json({ message: 'Tracking info updated' });
  } catch (err) {
    next(err);
  }
});

// ===================== User Management (user_management role only) =====================

const userMgmtAuth = [authenticate, requireAllRoles('user_management')];

/**
 * GET /admin/users
 * List all backend users (users with at least one backend role).
 * Optionally filter by ?role=role_name.
 */
router.get('/admin/users', ...userMgmtAuth, async (req, res, next) => {
  try {
    const db = getDatabase();
    const roleFilter = req.query.role as string | undefined;

    // Users with at least one backend role
    let query = db
      .selectFrom('users')
      .leftJoin('user_roles', 'user_roles.user_id', 'users.id')
      .leftJoin('roles', 'roles.id', 'user_roles.role_id')
      .select([
        'users.id',
        'users.email',
        'users.created_at',
        sql<string | null>`string_agg(DISTINCT roles.name, ', ' ORDER BY roles.name)`.as('roles'),
      ])
      .groupBy(['users.id', 'users.email', 'users.created_at'])
      .orderBy('users.created_at', 'desc');

    if (roleFilter) {
      if (!isBackendRole(roleFilter)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Unknown role: ${roleFilter}` } });
        return;
      }
      query = query.where('roles.name', '=', roleFilter);
    }

    const rows = await query.execute();

    res.json(rows.map((r) => ({
      id: r.id,
      email: r.email,
      roles: r.roles ? r.roles.split(', ') : [],
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/users/:id
 * View details of a single backend user.
 */
router.get('/admin/users/:id', ...userMgmtAuth, async (req, res, next) => {
  try {
    const db = getDatabase();
    const userId = req.params.id!;

    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'created_at'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw AppError.notFound('User not found');
    }

    const roles = await db
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('roles.name')
      .where('user_roles.user_id', '=', userId)
      .execute();

    res.json({
      id: user.id,
      email: user.email,
      roles: roles.map((r) => r.name),
      createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/users
 * Create a backend user and assign roles in one transaction.
 * The user must not already exist. Roles are validated against the DB.
 * At least one role is required.
 */
router.post('/admin/users', ...userMgmtAuth, async (req, res, next) => {
  try {
    const { email, password, roles } = req.body as {
      email?: unknown;
      password?: unknown;
      roles?: unknown;
    };

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email is required' } });
      return;
    }
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'password is required' } });
      return;
    }
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => typeof r === 'string')) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'roles must be a non-empty array of strings' } });
      return;
    }

    // Validate role names
    const db = getDatabase();
    const validRoles = await db
      .selectFrom('roles')
      .select(['id', 'name'])
      .execute();

    const validRoleNames = new Set(validRoles.map((r) => r.name));
    const roleNames: string[] = roles;
    for (const role of roleNames) {
      if (!validRoleNames.has(role)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Unknown role: ${role}` } });
        return;
      }
    }

    // Create user and assign roles in a transaction
    const result = await db.transaction().execute(async (trx) => {
      const passwordHash = await hashPassword(password);

      let userId: string;
      try {
        const insertResult = await sql<{ id: string }>`
          INSERT INTO users (email, password_hash, created_at, updated_at)
          VALUES (${email}, ${passwordHash}, now(), now())
          RETURNING id
        `.execute(trx);
        userId = insertResult.rows[0]!.id;
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          throw AppError.conflict('A user with this email already exists');
        }
        throw err;
      }

      // Assign roles
      for (const role of roleNames) {
        const roleRow = validRoles.find((r) => r.name === role)!;
        await trx
          .insertInto('user_roles')
          .values({ user_id: userId, role_id: roleRow.id, created_at: new Date().toISOString() })
          .execute();
      }

      return { id: userId, email, roles };
    });

    await recordAudit(req.user!.id, 'user.create', 'user', result.id, {
      email: result.email,
      roles: result.roles,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/users/:id/roles
 * Replace all roles for a user. Validates role names against the DB.
 * Prevents removing all roles if the user has user_management (prevents lockout).
 * Uses a transaction for atomicity.
 */
router.put('/admin/users/:id/roles', ...userMgmtAuth, async (req, res, next) => {
  try {
    const targetUserId = req.params.id as string;
    const { roles } = req.body as { roles?: unknown };
    const actorId = req.user!.id;

    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => typeof r === 'string')) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'roles must be a non-empty array of strings' } });
      return;
    }

    const db = getDatabase();

    // Validate role names
    const validRoles = await db
      .selectFrom('roles')
      .select(['id', 'name'])
      .execute();

    const validRoleNames = new Set(validRoles.map((r) => r.name));
    const roleNames: string[] = roles;

    for (const role of roleNames) {
      if (!validRoleNames.has(role)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Unknown role: ${role}` } });
        return;
      }
    }

    // Prevent removing user_management from the last admin who has it
    const targetHasUserMgmt = await db
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('user_roles.user_id')
      .where('user_roles.user_id', '=', targetUserId)
      .where('roles.name', '=', 'user_management')
      .executeTakeFirst();

    if (targetHasUserMgmt && !roleNames.includes('user_management')) {
      // Check if this is the last user with user_management
      const count = await db
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select(sql<number>`COUNT(DISTINCT user_roles.user_id)::int`.as('count'))
        .where('roles.name', '=', 'user_management')
        .executeTakeFirstOrThrow();

      if (count.count <= 1) {
        throw AppError.badRequest(
          'Cannot remove the last user_management role. Assign it to another user first.',
        );
      }
    }

    // Atomic role replacement
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('user_roles')
        .where('user_id', '=', targetUserId)
        .execute();

      for (const role of roleNames) {
        const roleRow = validRoles.find((r) => r.name === role)!;
        await trx
          .insertInto('user_roles')
          .values({ user_id: targetUserId, role_id: roleRow.id, created_at: new Date().toISOString() })
          .execute();
      }
    });

    await recordAudit(actorId, 'user.roles_changed', 'user', targetUserId, {
      roles: roleNames,
    });

    res.json({ id: targetUserId, roles: roleNames });
  } catch (err) {
    next(err);
  }
});

/**
 * Helper: enforce a role check inline for handlers that share
 * a read/write route pattern. Must be called inside the handler.
 */
async function enforceRole(
  req: Express.Request,
  ...requiredRoles: string[]
): Promise<void> {
  const { getUserRoles } = await import('../../auth/middleware.js');
  const roles = await getUserRoles(req.user!.id);

  if (!roles.some((r) => requiredRoles.includes(r))) {
    throw AppError.forbidden('Insufficient permissions for this operation');
  }
}

export default router;
