import { Router } from 'express';
import { listCategories, getCategoryBySlug, listProducts, getProductBySlug, searchProducts } from './service.js';

const router = Router();

/**
 * GET /products/search?q=<query>
 * Public: search active products by name and description.
 * Uses PostgreSQL ILIKE with pg_trgm GIN indexes.
 * Must be registered before /products/:slug to avoid route conflict.
 */
router.get('/products/search', async (req, res, next) => {
  try {
    const q = req.query.q;

    if (typeof q !== 'string') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Query parameter q is required' },
      });
      return;
    }

    const results = await searchProducts(q);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (_req, res, next) => {
  try {
    const categories = await listCategories();
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.get('/categories/:slug', async (req, res, next) => {
  try {
    const result = await getCategoryBySlug(req.params.slug);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const categorySlug = req.query.category as string | undefined;
    const products = await listProducts(categorySlug || undefined);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    const product = await getProductBySlug(req.params.slug);
    res.json(product);
  } catch (err) {
    next(err);
  }
});

export default router;