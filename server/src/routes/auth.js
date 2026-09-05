import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { z } from 'zod';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid credentials payload' });
  const { email, password } = parse.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken(user);
  await audit({ req, action: 'LOGIN', resourceType: 'User', resourceId: user.id });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
    },
  });
});

router.get('/me', requireAuth, (req, res) => {
  const { id, email, username, fullName, role, department } = req.user;
  res.json({ id, email, username, fullName, role, department });
});

router.post('/logout', requireAuth, async (req, res) => {
  await audit({ req, action: 'LOGOUT', resourceType: 'User', resourceId: req.user.id });
  // Stateless JWT — client discards token. Add refresh-token blocklist if needed.
  res.json({ ok: true });
});

export default router;
