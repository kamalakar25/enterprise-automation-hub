import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { z } from 'zod';

const router = Router();

const createSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(1),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR']).default('OPERATOR'),
  department: z.string().optional(),
});

router.get('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, username: true, fullName: true,
      role: true, department: true, isActive: true, createdAt: true,
    },
  });
  res.json(users);
});

router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { password, ...rest } = parse.data;

  const exists = await prisma.user.findFirst({
    where: { OR: [{ email: rest.email }, { username: rest.username }] },
  });
  if (exists) return res.status(409).json({ error: 'Email or username already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { ...rest, passwordHash } });

  await audit({ req, action: 'CREATE_USER', resourceType: 'User', resourceId: user.id });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

router.put('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { password, role, isActive, fullName, department } = req.body;
  const data = {};
  if (role) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (fullName) data.fullName = fullName;
  if (department !== undefined) data.department = department;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  await audit({ req, action: 'UPDATE_USER', resourceType: 'User', resourceId: user.id });
  res.json({ id: user.id, email: user.email, role: user.role });
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }
  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
  await audit({ req, action: 'DEACTIVATE_USER', resourceType: 'User', resourceId: req.params.id });
  res.json({ ok: true });
});

export default router;
