import { Router } from 'express';
import { authenticate, requireAnyRole } from '../../auth/middleware.js';
import { recordAudit } from '../admin/service.js';
import { createBanner, listBanners, updateBanner, type BannerInput } from './service.js';

const router = Router(); const read = [authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin', 'user_management')] as const; const write = [authenticate, requireAnyRole('backend_write', 'backend_admin')] as const;
const at = (v: unknown) => typeof v === 'string' ? new Date(v) : new Date();
router.get('/banners', async (req, res, next) => { try { res.json(await listBanners(false, typeof req.query.placement === 'string' ? req.query.placement : undefined, at(req.query.at))); } catch (error) { next(error); } });
router.get('/admin/banners', ...read, async (req, res, next) => { try { res.json(await listBanners(true, typeof req.query.placement === 'string' ? req.query.placement : undefined)); } catch (error) { next(error); } });
router.post('/admin/banners', ...write, async (req, res, next) => { try { const result = await createBanner(req.body as BannerInput); await recordAudit(req.user!.id, 'banner.create', 'banner', result.id, { placement: result.placement }); res.status(201).json(result); } catch (error) { next(error); } });
router.patch('/admin/banners/:id', ...write, async (req, res, next) => { try { const body = req.body as Partial<BannerInput>; const result = await updateBanner(String(req.params.id), body); await recordAudit(req.user!.id, 'banner.update', 'banner', result.id, { changes: body }); res.json(result); } catch (error) { next(error); } });
export default router;
