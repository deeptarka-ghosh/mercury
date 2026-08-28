import { Router } from 'express';
import { authenticate, authorize } from '../../auth/middleware.js';
import { setInventory } from '../inventory/service.js';
import { setPrice } from '../pricing/service.js';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import {
  listAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  listAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  setProductStatus,
  recordAudit,
} from './service.js';

const router = Router();

// All admin routes require authentication + admin role
router.use('/admin', authenticate, authorize('admin'));

// ===================== Categories =====================

router.get('/admin/categories', async (_req, res, next) => {
  try {
    const categories = await listAllCategories();
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/categories', async (req, res, next) => {
  try {
    const body = req.body as { name?: unknown; slug?: unknown; description?: unknown; parentId?: unknown };

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

router.get('/admin/categories/:id', async (req, res, next) => {
  try {
    const result = await getCategoryById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/categories/:id', async (req, res, next) => {
  try {
    const { name, slug, description, parentId } = req.body as {
      name?: string; slug?: string; description?: string | null; parentId?: string | null;
    };
    const result = await updateCategory(req.params.id, { name, slug, description, parentId });

    await recordAudit(req.user!.id, 'category.update', 'category', result.id, {
      changes: { name, slug, description, parentId },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/categories/:id', async (req, res, next) => {
  try {
    // Fetch category before deleting so we can audit what was deleted
    let categoryName = req.params.id;
    try {
      const cat = await getCategoryById(req.params.id);
      categoryName = cat.name;
    } catch { /* not found — will fail below */ }

    await deleteCategory(req.params.id);

    await recordAudit(req.user!.id, 'category.delete', 'category', req.params.id, {
      name: categoryName,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ===================== Products =====================

router.get('/admin/products', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const products = await listAllProducts(status || undefined);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/products', async (req, res, next) => {
  try {
    const body = req.body as { name?: unknown; slug?: unknown; description?: unknown; status?: unknown; categoryId?: unknown };

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

router.get('/admin/products/:id', async (req, res, next) => {
  try {
    const result = await getProductById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/products/:id', async (req, res, next) => {
  try {
    const { name, slug, description, status, categoryId } = req.body as {
      name?: string; slug?: string; description?: string | null; status?: string; categoryId?: string | null;
    };
    const result = await updateProduct(req.params.id, { name, slug, description, status, categoryId });

    await recordAudit(req.user!.id, 'product.update', 'product', result.id, {
      changes: { name, slug, description, status, categoryId },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/products/:id', async (req, res, next) => {
  try {
    await deleteProduct(req.params.id);

    await recordAudit(req.user!.id, 'product.delete', 'product', req.params.id, null);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/products/:id/status', async (req, res, next) => {
  try {
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

// ===================== Inventory (Admin) =====================

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

router.put('/admin/products/:slug/inventory', async (req, res, next) => {
  try {
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

// ===================== Pricing (Admin) =====================

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

router.put('/admin/products/:slug/price', async (req, res, next) => {
  try {
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

// ===================== Audit Log =====================

/**
 * GET /admin/audit
 * Paginated audit log. Ordered by created_at DESC.
 * Supports ?limit= and ?offset= for pagination, ?action= for filtering.
 */
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

    // Also get total count for pagination info
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

/**
 * GET /admin/analytics/summary
 * Compact dashboard overview.
 */
router.get('/admin/analytics/summary', async (_req, res, next) => {
  try {
    const db = getDatabase();

    // Order counts by status
    const orderStats = await db
      .selectFrom('orders')
      .select([
        sql<string>`status`.as('status'),
        sql<number>`COUNT(*)::int`.as('count'),
      ])
      .groupBy('status')
      .orderBy('status')
      .execute();

    // Payment stats
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

    // User counts
    const userCounts = await db
      .selectFrom('users')
      .select([
        sql<number>`COUNT(*)::int`.as('total'),
        sql<number>`SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END)::int`.as('admins'),
      ])
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

    // Total revenue from completed payments
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
        admins: userCounts.admins,
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

/**
 * GET /admin/analytics/orders
 * Order breakdown with totals. Supports ?status= filter, pagination.
 */
router.get('/admin/analytics/orders', async (req, res, next) => {
  try {
    const db = getDatabase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const statusFilter = req.query.status as string | undefined;

    let query = db
      .selectFrom('orders')
      .leftJoin('users', 'users.id', 'orders.user_id')
      .select([
        'orders.id',
        'orders.user_id',
        'users.email as user_email',
        'orders.status',
        'orders.total',
        'orders.created_at',
        'orders.updated_at',
      ])
      .orderBy('orders.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (statusFilter) {
      query = query.where('orders.status', '=', statusFilter);
    }

    const rows = await query.execute();

    // Count total orders matching filter
    let countQuery = db
      .selectFrom('orders')
      .select(sql<number>`COUNT(*)::int`.as('total'));
    if (statusFilter) {
      countQuery = countQuery.where('orders.status', '=', statusFilter);
    }
    const countResult = await countQuery.executeTakeFirstOrThrow();

    // Aggregate totals by status (always all statuses for a complete picture)
    const totalsQuery = db
      .selectFrom('orders')
      .select([
        sql<string>`status`.as('status'),
        sql<number>`COUNT(*)::int`.as('count'),
        sql<string | null>`CAST(SUM(total) AS TEXT)`.as('totalAmount'),
      ])
      .groupBy('status')
      .orderBy('status');

    const totals = await totalsQuery.execute();

    res.json({
      orders: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email ?? null,
        status: r.status,
        total: r.total,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      totals,
      total: countResult.total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/analytics/revenue
 * Revenue breakdown. Completed payments only are authoritative revenue.
 */
router.get('/admin/analytics/revenue', async (_req, res, next) => {
  try {
    const db = getDatabase();

    // Completed payments = revenue
    const completedRevenue = await db
      .selectFrom('payments')
      .select([
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('total'),
        sql<number>`COUNT(*)::int`.as('count'),
      ])
      .where('payments.status', '=', 'completed')
      .executeTakeFirstOrThrow();

    // All payments breakdown
    const paymentBreakdown = await db
      .selectFrom('payments')
      .select([
        sql<string>`status`.as('status'),
        sql<number>`COUNT(*)::int`.as('count'),
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('total'),
      ])
      .groupBy('status')
      .orderBy('status')
      .execute();

    // Revenue by currency
    const revenueByCurrency = await db
      .selectFrom('payments')
      .select([
        'currency',
        sql<string | null>`CAST(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) AS TEXT)`.as('completed'),
        sql<string | null>`CAST(SUM(amount) AS TEXT)`.as('total'),
      ])
      .groupBy('currency')
      .orderBy('currency')
      .execute();

    res.json({
      completedRevenue: completedRevenue.total,
      completedPaymentCount: completedRevenue.count,
      breakdown: paymentBreakdown,
      byCurrency: revenueByCurrency,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/analytics/products
 * Product sales quantities from order_items.
 */
router.get('/admin/analytics/products', async (req, res, next) => {
  try {
    const db = getDatabase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    // Top-selling products by quantity
    const topProducts = await db
      .selectFrom('order_items')
      .innerJoin('products', 'products.id', 'order_items.product_id')
      .select([
        'order_items.product_id',
        'products.name',
        'products.slug',
        sql<number>`SUM(order_items.quantity)::int`.as('totalSold'),
        sql<string | null>`CAST(SUM(CAST(order_items.line_total AS NUMERIC)) AS TEXT)`.as('totalRevenue'),
      ])
      .groupBy(['order_items.product_id', 'products.name', 'products.slug'])
      .orderBy('totalSold', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Total count of products sold
    const countResult = await db
      .selectFrom('order_items')
      .select(sql<number>`COUNT(DISTINCT product_id)::int`.as('total'))
      .executeTakeFirstOrThrow();

    res.json({
      products: topProducts.map((p) => ({
        productId: p.product_id,
        name: p.name,
        slug: p.slug,
        totalSold: p.totalSold,
        totalRevenue: p.totalRevenue,
      })),
      total: countResult.total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

export default router;