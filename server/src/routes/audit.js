import { Router } from 'express';
import prisma from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { fullName: true, email: true, role: true } } },
  });
  res.json(logs);
});

export default router;
