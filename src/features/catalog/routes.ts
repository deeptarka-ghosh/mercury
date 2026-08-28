import { Router } from 'express';
import { listCategories, getCategoryBySlug, listProducts, getProductBySlug } from './service.js';

const router = Router();

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