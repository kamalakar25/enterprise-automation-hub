import { Router } from 'express';
import prisma from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

/** List all automation modules visible to the current user */
router.get('/', requireAuth, async (req, res) => {
  const modules = await prisma.automationModule.findMany({
    where: { isEnabled: true },
    orderBy: { name: 'asc' },
  });

  // Filter by RBAC — users see only modules they can run
  const visible = modules.filter((m) => m.allowedRoles.includes(req.user.role));
  res.json(visible);
});

router.get('/:slug', requireAuth, async (req, res) => {
  const mod = await prisma.automationModule.findUnique({ where: { slug: req.params.slug } });
  if (!mod) return res.status(404).json({ error: 'Module not found' });
  if (!mod.allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not authorized for this module' });
  }
  res.json(mod);
});

/** Admin: create/update modules */
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const mod = await prisma.automationModule.create({ data: req.body });
  res.status(201).json(mod);
});

router.put('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const mod = await prisma.automationModule.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(mod);
});

export default router;
