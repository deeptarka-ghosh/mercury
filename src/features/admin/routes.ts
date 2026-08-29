import { Router } from 'express';
import { authenticate, requireAnyRole, requireAllRoles, isBackendRole } from '../../auth/middleware.js';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { recordAudit } from './service.js';
import { setInventory } from '../inventory/service.js';
import { setPrice } from '../pricing/service.js';
import { hashPassword } from '../../auth/password.js';
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

router.patch('/admin/categories/:id', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

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

router.patch('/admin/products/:id', async (req, res, next) => {
  try {
    await enforceRole(req, 'backend_write', 'backend_admin');

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