import { Router } from 'express';
import { listCategories, getCategoryBySlug, listProducts, getProductBySlug, searchProducts } from './service.js';

const router = Router();

/**
 * GET /products/search
 * Public: search active products by name and description.
 * Supports filtering, sorting, and pagination.
 *
 * Query params:
 *   q         - search query (optional, max 200 chars)
 *   category  - filter by category slug
 *   minPrice  - minimum price filter
 *   maxPrice  - maximum price filter
 *   inStock   - filter to in-stock products only ('true')
 *   sort      - sort order: relevance, price_asc, price_desc, newest, name_asc, name_desc
 *   limit     - page size (default 50, max 200)
 *   offset    - pagination offset (default 0)
 */
router.get('/products/search', async (req, res, next) => {
  try {
    const { q, category, minPrice, maxPrice, inStock, sort, limit, offset } = req.query;

    const filters: Record<string, unknown> = {};

    if (typeof q === 'string') {
      if (q.trim().length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Search query is required' } });
        return;
      }
      filters.q = q;
    }
    if (typeof category === 'string') filters.category = category;
    if (typeof minPrice === 'string') {
      const num = Number(minPrice);
      if (Number.isNaN(num) || num < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'minPrice must be a non-negative number' } });
        return;
      }
      filters.minPrice = num;
    }
    if (typeof maxPrice === 'string') {
      const num = Number(maxPrice);
      if (Number.isNaN(num) || num < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'maxPrice must be a non-negative number' } });
        return;
      }
      filters.maxPrice = num;
    }
    if (inStock === 'true') filters.inStock = true;
    if (typeof sort === 'string') {
      const validSorts = ['relevance', 'merchandised', 'price_asc', 'price_desc', 'newest', 'name_asc', 'name_desc'];
      if (!validSorts.includes(sort)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `sort must be one of: ${validSorts.join(', ')}` } });
        return;
      }
      filters.sort = sort;
    }
    if (typeof limit === 'string') {
      const num = parseInt(limit, 10);
      if (Number.isNaN(num) || num < 1) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'limit must be a positive integer' } });
        return;
      }
      filters.limit = num;
    }
    if (typeof offset === 'string') {
      const num = parseInt(offset, 10);
      if (Number.isNaN(num) || num < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'offset must be a non-negative integer' } });
        return;
      }
      filters.offset = num;
    }

    // If q is present, use searchProducts (ILiKE + relevance); otherwise use listProducts
    const result = filters.q
      ? await searchProducts(filters)
      : await listProducts(filters);

    // Return total as a separate field for pagination headers
    res.json(result);
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

/**
 * GET /products
 * Public: list active products with filtering, sorting, and pagination.
 *
 * Same query params as /products/search except `q`.
 */
router.get('/products', async (req, res, next) => {
  try {
    const { category, minPrice, maxPrice, inStock, sort, limit, offset } = req.query;

    const filters: Record<string, unknown> = {};

    if (typeof category === 'string') filters.category = category;
    if (typeof minPrice === 'string') {
      const num = Number(minPrice);
      if (Number.isNaN(num) || num < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'minPrice must be a non-negative number' } });
        return;
      }
      filters.minPrice = num;
    }
    if (typeof maxPrice === 'string') {
      const num = Number(maxPrice);
      if (Number.isNaN(num) || num < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'maxPrice must be a non-negative number' } });
        return;
      }
      filters.maxPrice = num;
    }
    if (inStock === 'true') filters.inStock = true;
    if (typeof sort === 'string') {
      const validSorts = ['relevance', 'merchandised', 'price_asc', 'price_desc', 'newest', 'name_asc', 'name_desc'];
      if (!validSorts.includes(sort)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `sort must be one of: ${validSorts.join(', ')}` } });
        return;
      }
      filters.sort = sort;
    }
    if (typeof limit === 'string') {
      const num = parseInt(limit, 10);
      if (Number.isNaN(num) || num < 1) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'limit must be a positive integer' } });
        return;
      }
      filters.limit = num;
    }
    if (typeof offset === 'string') {
      const num = parseInt(offset, 10);
      if (Number.isNaN(num) || num < 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'offset must be a non-negative integer' } });
        return;
      }
      filters.offset = num;
    }

    const result = await listProducts(filters);
    res.json(result);
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
