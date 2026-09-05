/**
 * BullMQ Worker process. Run separately from the HTTP server:
 *   npm run worker
 *
 * Multiple workers can be spawned for horizontal scaling.
 */
import 'dotenv/config';
import { Worker } from 'bullmq';
import connection from '../config/redis.js';
import { processJob } from './processor.js';
import logger from '../config/logger.js';

const concurrency = Number(process.env.WORKER_CONCURRENCY) || 3;

const worker = new Worker('automations', processJob, {
  connection,
  concurrency,
  // Track progress so the UI can show % complete
  runRetryDelay: 3000,
});

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} (${job.data.moduleSlug}) completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed: ${err.message}`);
});

worker.on('active', (job) => {
  logger.info(`Job ${job.id} (${job.data.moduleSlug}) started`, { jobId: job.id });
});

logger.info(`BullMQ worker started — concurrency=${concurrency}, queue=automations`);

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down worker...');
  await worker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
