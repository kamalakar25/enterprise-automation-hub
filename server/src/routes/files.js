import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

/** Download a stored file (output report). Enforces ownership/RBAC. */
router.get('/:id/download', requireAuth, async (req, res) => {
  const file = await prisma.storedFile.findUnique({
    where: { id: req.params.id },
    include: { outputJobs: true, inputJobs: true },
  });
  if (!file) return res.status(404).json({ error: 'File not found' });

  // Authorization: only the user who triggered the job or admin may download
  const ownerIds = new Set([
    ...file.outputJobs.map((j) => j.triggeredById),
    ...file.inputJobs.map((j) => j.triggeredById),
  ]);
  if (req.user.role !== 'ADMIN' && !ownerIds.has(req.user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (!fs.existsSync(file.storedPath)) {
    return res.status(404).json({ error: 'File missing on disk' });
  }

  await audit({
    req,
    action: 'DOWNLOAD_FILE',
    resourceType: 'StoredFile',
    resourceId: file.id,
  });

  res.download(file.storedPath, file.originalName);
});

export default router;
