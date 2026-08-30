import { Router } from 'express';
import { authenticate, requireAnyRole } from '../../auth/middleware.js';
import { recordAudit } from '../admin/service.js';
import { createLayout, getLayout, getPublicHomepage, listAdminLayouts, replaceSections, updateLayout, type HomepageLayoutInput } from './service.js';

const router = Router();
const read = [authenticate, requireAnyRole('backend_read', 'backend_write', 'backend_admin', 'user_management')] as const;
const write = [authenticate, requireAnyRole('backend_write', 'backend_admin')] as const;
router.get('/homepage', async (req, res, next) => { try { res.json(await getPublicHomepage(typeof req.query.at === 'string' ? new Date(req.query.at) : new Date())); } catch (error) { next(error); } });
router.get('/admin/homepage-layouts', ...read, async (_req, res, next) => { try { res.json(await listAdminLayouts()); } catch (error) { next(error); } });
router.get('/admin/homepage-layouts/:id', ...read, async (req, res, next) => { try { res.json(await getLayout(String(req.params.id))); } catch (error) { next(error); } });
router.post('/admin/homepage-layouts', ...write, async (req, res, next) => { try { const result = await createLayout(req.body as HomepageLayoutInput); await recordAudit(req.user!.id, 'homepage_layout.create', 'homepage_layout', result.id, { slug: result.slug }); res.status(201).json(result); } catch (error) { next(error); } });
router.patch('/admin/homepage-layouts/:id', ...write, async (req, res, next) => { try { const body = req.body as Partial<HomepageLayoutInput>; const result = await updateLayout(String(req.params.id), body); await recordAudit(req.user!.id, 'homepage_layout.update', 'homepage_layout', result.id, { changes: body }); res.json(result); } catch (error) { next(error); } });
router.put('/admin/homepage-layouts/:id/sections', ...write, async (req, res, next) => { try { const id = String(req.params.id); const result = await replaceSections(id, (req.body as { sections?: unknown }).sections); await recordAudit(req.user!.id, 'homepage_layout.sections.replace', 'homepage_layout', id, { sectionKeys: result.sections.map((section) => section.sectionKey) }); res.json(result); } catch (error) { next(error); } });
export default router;
