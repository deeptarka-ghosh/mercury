import { Router } from 'express';
import { authenticate, requireAnyRole } from '../../auth/middleware.js';
import { recordAudit } from '../admin/service.js';
import { createCollection, getPublicCollection, listAdminCollections, listPublicCollections, replaceCollectionProducts, updateCollection, type CollectionInput } from './service.js';

const router = Router();
const readAuth = [authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin', 'user_management')] as const;
const writeAuth = [authenticate, requireAnyRole('backend_write', 'backend_admin')] as const;
const atFromQuery = (value: unknown) => typeof value === 'string' ? new Date(value) : new Date();

router.get('/collections', async (req, res, next) => { try { res.json(await listPublicCollections(atFromQuery(req.query.at))); } catch (error) { next(error); } });
router.get('/collections/:slug', async (req, res, next) => { try { res.json(await getPublicCollection(String(req.params.slug), atFromQuery(req.query.at))); } catch (error) { next(error); } });
router.get('/admin/collections', ...readAuth, async (_req, res, next) => { try { res.json(await listAdminCollections()); } catch (error) { next(error); } });
router.post('/admin/collections', ...writeAuth, async (req, res, next) => {
  try { const result = await createCollection(req.body as CollectionInput); await recordAudit(req.user!.id, 'collection.create', 'collection', result.id, { slug: result.slug }); res.status(201).json(result); } catch (error) { next(error); }
});
router.patch('/admin/collections/:id', ...writeAuth, async (req, res, next) => {
  try { const body = req.body as Partial<CollectionInput>; const result = await updateCollection(String(req.params.id), body); await recordAudit(req.user!.id, 'collection.update', 'collection', result.id, { changes: body }); res.json(result); } catch (error) { next(error); }
});
router.put('/admin/collections/:id/products', ...writeAuth, async (req, res, next) => {
  try { const body = req.body as { productIds?: unknown }; const id = String(req.params.id); const result = await replaceCollectionProducts(id, body.productIds); await recordAudit(req.user!.id, 'collection.products.replace', 'collection', id, { productIds: result.productIds }); res.json(result); } catch (error) { next(error); }
});

export default router;
