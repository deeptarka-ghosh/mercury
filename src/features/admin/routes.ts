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
} from './service.js';

const router = Router();

// All admin routes require authentication + admin role
router.use('/admin', authenticate, authorize('admin'));

/**
 * GET /admin/categories
 * List all categories.
 */
router.get('/admin/categories', async (_req, res, next) => {
  try {
    const categories = await listAllCategories();
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/categories
 * Create a new category.
 */
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

    const result = await createCategory({
      name: body.name,
      slug: body.slug,
      description: body.description === undefined ? null : (body.description as string | null),
      parentId: body.parentId === undefined ? null : (body.parentId as string | null),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/categories/:id
 * Get a category by ID.
 */
router.get('/admin/categories/:id', async (req, res, next) => {
  try {
    const result = await getCategoryById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/categories/:id
 * Update a category.
 */
router.patch('/admin/categories/:id', async (req, res, next) => {
  try {
    const { name, slug, description, parentId } = req.body as {
      name?: string; slug?: string; description?: string | null; parentId?: string | null;
    };
    const result = await updateCategory(req.params.id, { name, slug, description, parentId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/categories/:id
 * Delete a category.
 */
router.delete('/admin/categories/:id', async (req, res, next) => {
  try {
    await deleteCategory(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/products
 * List all products (any status). Optional ?status= filter.
 */
router.get('/admin/products', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const products = await listAllProducts(status || undefined);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/products
 * Create a new product.
 */
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

    const result = await createProduct({
      name: body.name,
      slug: body.slug,
      description: body.description === undefined ? null : (body.description as string | null),
      status: body.status === undefined ? 'draft' : (body.status as string),
      categoryId: body.categoryId === undefined ? null : (body.categoryId as string | null),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/products/:id
 * Get a product by ID (any status).
 */
router.get('/admin/products/:id', async (req, res, next) => {
  try {
    const result = await getProductById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/products/:id
 * Update a product.
 */
router.patch('/admin/products/:id', async (req, res, next) => {
  try {
    const { name, slug, description, status, categoryId } = req.body as {
      name?: string; slug?: string; description?: string | null; status?: string; categoryId?: string | null;
    };
    const result = await updateProduct(req.params.id, { name, slug, description, status, categoryId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/products/:id
 * Delete a product.
 */
router.delete('/admin/products/:id', async (req, res, next) => {
  try {
    await deleteProduct(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/products/:id/status
 * Change product status.
 */
router.patch('/admin/products/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body as { status?: unknown };

    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
      return;
    }

    const result = await setProductStatus(req.params.id, status);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/products/:slug/inventory
 * Get inventory for a product by slug.
 */
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

/**
 * PUT /admin/products/:slug/inventory
 * Set inventory for a product by slug. Reuses existing setInventory logic.
 */
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
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/products/:slug/price
 * Get price for a product by slug.
 */
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

/**
 * PUT /admin/products/:slug/price
 * Set price for a product by slug. Reuses existing setPrice logic.
 */
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
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;