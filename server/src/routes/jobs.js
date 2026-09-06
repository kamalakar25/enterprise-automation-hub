import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import prisma from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import automationQueue from '../queue/queue.js';
import logger from '../config/logger.js';

const router = Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './storage/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024 },
});

/**
 * POST /api/jobs/run
 * Multipart form:
 *   - moduleSlug  (string)
 *   - params      (JSON string, optional)
 *   - inputFile   (file, optional)
 */
router.post('/run', requireAuth, upload.single('inputFile'), async (req, res) => {
  const { moduleSlug, params: paramsJson } = req.body;
  if (!moduleSlug) return res.status(400).json({ error: 'moduleSlug is required' });

  const mod = await prisma.automationModule.findUnique({ where: { slug: moduleSlug } });
  if (!mod) return res.status(404).json({ error: 'Module not found' });
  if (!mod.isEnabled) return res.status(400).json({ error: 'Module is disabled' });
  if (!mod.allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Not authorized to run this module' });
  }

  let params = {};
  try {
    if (paramsJson) params = JSON.parse(paramsJson);
  } catch {
    return res.status(400).json({ error: 'params must be valid JSON' });
  }

  // Persist input file
  let inputFile = null;
  if (req.file) {
    inputFile = await prisma.storedFile.create({
      data: {
        originalName: req.file.originalname,
        storedPath: req.file.path,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedById: req.user.id,
      },
    });
  }

  const socketRoom = `job:${uuid()}`;

  const jobRun = await prisma.jobRun.create({
    data: {
      moduleId: mod.id,
      triggeredById: req.user.id,
      params,
      inputFileId: inputFile?.id || null,
      logStream: socketRoom,
      status: 'QUEUED',
    },
  });

  await automationQueue.add(
    'run-automation',
    {
      jobId: jobRun.id,
      moduleId: mod.id,
      moduleSlug: mod.slug,
      executionType: mod.executionType,
      params,
      inputFile: inputFile
        ? { id: inputFile.id, storedPath: inputFile.storedPath, originalName: inputFile.originalName }
        : null,
      triggeredBy: req.user.id,
      socketRoom,
    },
    { jobId: jobRun.id }
  );

  await audit({
    req,
    action: 'RUN_JOB',
    resourceType: 'JobRun',
    resourceId: jobRun.id,
    metadata: { moduleSlug },
  });

  logger.info(`Queued job ${jobRun.id} for ${moduleSlug} by ${req.user.email}`);
  res.status(202).json({ jobId: jobRun.id, socketRoom, status: 'QUEUED' });
});

/**
 * POST /api/jobs/record-local-run
 * Allows local desktop agent runs to sync directly into Central Database & Audit Trail
 */
router.post(
  '/record-local-run',
  requireAuth,
  upload.fields([
    { name: 'inputFile', maxCount: 1 },
    { name: 'outputFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { moduleSlug, status = 'COMPLETED', params: paramsJson, logs: logsJson, errorMessage, startedAt, finishedAt } = req.body;
      const mod = await prisma.automationModule.findUnique({ where: { slug: moduleSlug } });
      if (!mod) return res.status(404).json({ error: 'Module not found' });

      let params = {};
      try {
        if (paramsJson) params = JSON.parse(paramsJson);
      } catch {}

      let logs = [];
      try {
        if (logsJson) logs = JSON.parse(logsJson);
      } catch {}

      let inputFileRecord = null;
      if (req.files?.inputFile?.[0]) {
        const f = req.files.inputFile[0];
        inputFileRecord = await prisma.storedFile.create({
          data: {
            originalName: f.originalname,
            storedPath: f.path,
            mimeType: f.mimetype,
            sizeBytes: f.size,
            uploadedById: req.user.id,
          },
        });
      }

      let outputFileRecord = null;
      if (req.files?.outputFile?.[0]) {
        const f = req.files.outputFile[0];
        outputFileRecord = await prisma.storedFile.create({
          data: {
            originalName: f.originalname,
            storedPath: f.path,
            mimeType: f.mimetype,
            sizeBytes: f.size,
            uploadedById: req.user.id,
          },
        });
      }

      const jobRun = await prisma.jobRun.create({
        data: {
          moduleId: mod.id,
          triggeredById: req.user.id,
          params: { ...params, logs, executionTarget: 'LOCAL_DESKTOP_AGENT' },
          status: status === 'FAILED' ? 'FAILED' : 'COMPLETED',
          errorMessage: errorMessage || null,
          inputFileId: inputFileRecord?.id || null,
          outputFileId: outputFileRecord?.id || null,
          startedAt: startedAt ? new Date(startedAt) : new Date(),
          finishedAt: finishedAt ? new Date(finishedAt) : new Date(),
        },
      });

      await audit({
        req,
        action: 'LOCAL_DESKTOP_JOB_RUN',
        resourceType: 'JobRun',
        resourceId: jobRun.id,
        metadata: { moduleSlug, status },
      });

      logger.info(`Recorded local desktop job ${jobRun.id} for ${moduleSlug} by ${req.user.email}`);
      res.json({ ok: true, job: jobRun });
    } catch (err) {
      logger.error(`Error recording local run: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  }
);

/** List recent jobs (admin sees all; users see their own) */
router.get('/', requireAuth, async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { triggeredById: req.user.id };
  const jobs = await prisma.jobRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      module: { select: { name: true, slug: true, icon: true } },
      triggeredBy: { select: { fullName: true, email: true } },
    },
  });
  res.json(jobs);
});

router.get('/:id', requireAuth, async (req, res) => {
  const job = await prisma.jobRun.findUnique({
    where: { id: req.params.id },
    include: {
      module: true,
      triggeredBy: { select: { fullName: true, email: true } },
      inputFile: true,
      outputFile: true,
    },
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (req.user.role !== 'ADMIN' && job.triggeredById !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  res.json(job);
});

router.post('/:id/cancel', requireAuth, async (req, res) => {
  const job = await prisma.jobRun.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const bullJob = await automationQueue.getJob(job.id);
  if (bullJob) await bullJob.remove();

  await prisma.jobRun.update({
    where: { id: job.id },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });

  await audit({ req, action: 'CANCEL_JOB', resourceType: 'JobRun', resourceId: job.id });
  res.json({ ok: true });
});

export default router;
