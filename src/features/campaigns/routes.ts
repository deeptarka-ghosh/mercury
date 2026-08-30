import { Router } from 'express';
import { authenticate, requireAnyRole } from '../../auth/middleware.js';
import { recordAudit } from '../admin/service.js';
import { createCampaign, createPromotion, getCampaign, listCampaigns, listPromotions, replaceCampaignCollections, updateCampaign, updatePromotion, type PromotionInput, type ScheduleInput } from './service.js';

const router = Router();
const read = [authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin', 'user_management')] as const;
const write = [authenticate, requireAnyRole('backend_write', 'backend_admin')] as const;
const at = (value: unknown) => typeof value === 'string' ? new Date(value) : new Date();

router.get('/campaigns', async (req, res, next) => { try { res.json(await listCampaigns(false, at(req.query.at))); } catch (error) { next(error); } });
router.get('/campaigns/:slug', async (req, res, next) => { try { res.json(await getCampaign(String(req.params.slug), at(req.query.at))); } catch (error) { next(error); } });
router.get('/promotions', async (req, res, next) => { try { res.json(await listPromotions(false, at(req.query.at))); } catch (error) { next(error); } });
router.get('/admin/campaigns', ...read, async (_req, res, next) => { try { res.json(await listCampaigns(true)); } catch (error) { next(error); } });
router.post('/admin/campaigns', ...write, async (req, res, next) => { try { const result = await createCampaign(req.body as ScheduleInput); await recordAudit(req.user!.id, 'campaign.create', 'campaign', result.id, { slug: result.slug }); res.status(201).json(result); } catch (error) { next(error); } });
router.patch('/admin/campaigns/:id', ...write, async (req, res, next) => { try { const body = req.body as Partial<ScheduleInput>; const result = await updateCampaign(String(req.params.id), body); await recordAudit(req.user!.id, 'campaign.update', 'campaign', result.id, { changes: body }); res.json(result); } catch (error) { next(error); } });
router.put('/admin/campaigns/:id/collections', ...write, async (req, res, next) => { try { const body = req.body as { collectionIds?: unknown }; const id = String(req.params.id); const result = await replaceCampaignCollections(id, body.collectionIds); await recordAudit(req.user!.id, 'campaign.collections.replace', 'campaign', id, { collectionIds: result.collectionIds }); res.json(result); } catch (error) { next(error); } });
router.get('/admin/promotions', ...read, async (_req, res, next) => { try { res.json(await listPromotions(true)); } catch (error) { next(error); } });
router.post('/admin/promotions', ...write, async (req, res, next) => { try { const body = req.body as PromotionInput; const id = await createPromotion(body); await recordAudit(req.user!.id, 'promotion.create', 'promotion', id, { code: body.code ?? null }); res.status(201).json({ id }); } catch (error) { next(error); } });
router.patch('/admin/promotions/:id', ...write, async (req, res, next) => { try { const body = req.body as Partial<PromotionInput>; const result = await updatePromotion(String(req.params.id), body); await recordAudit(req.user!.id, 'promotion.update', 'promotion', result.id, { changes: body }); res.json(result); } catch (error) { next(error); } });

export default router;
