import { Router } from 'express';
import prisma from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import automationQueue from '../queue/queue.js';
import { audit } from '../middleware/audit.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { createdById: req.user.id };
  const schedules = await prisma.schedule.findMany({
    where,
    include: { module: { select: { name: true, slug: true, icon: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(schedules);
});

router.post('/', requireAuth, async (req, res) => {
  const { moduleSlug, name, cronExpression, params } = req.body;
  if (!moduleSlug || !cronExpression) {
    return res.status(400).json({ error: 'moduleSlug and cronExpression required' });
  }
  const mod = await prisma.automationModule.findUnique({ where: { slug: moduleSlug } });
  if (!mod) return res.status(404).json({ error: 'Module not found' });
  if (!mod.allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // Register repeatable job in BullMQ
  await automationQueue.add(
    'run-automation',
    {
      moduleSlug: mod.slug,
      moduleId: mod.id,
      executionType: mod.executionType,
      params: params || {},
      scheduled: true,
    },
    {
      repeat: { pattern: cronExpression },
      jobId: `schedule:${moduleSlug}:${Date.now()}`,
    }
  );

  const schedule = await prisma.schedule.create({
    data: {
      moduleId: mod.id,
      name: name || `${mod.name} (${cronExpression})`,
      cronExpression,
      params: params || {},
      createdById: req.user.id,
    },
  });

  await audit({ req, action: 'CREATE_SCHEDULE', resourceType: 'Schedule', resourceId: schedule.id });
  res.status(201).json(schedule);
});

router.delete('/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const schedule = await prisma.schedule.findUnique({ where: { id: req.params.id } });
  if (!schedule) return res.status(404).json({ error: 'Not found' });

  // Remove repeatable (simplified; in production, track repeatable job keys)
  const repeatables = await automationQueue.getRepeatableJobs();
  for (const r of repeatables) {
    if (r.id.includes(schedule.moduleId)) await automationQueue.removeRepeatableByKey(r.key);
  }

  await prisma.schedule.update({ where: { id: schedule.id }, data: { isActive: false } });
  await audit({ req, action: 'DELETE_SCHEDULE', resourceType: 'Schedule', resourceId: schedule.id });
  res.json({ ok: true });
});

export default router;
