import { Queue } from 'bullmq';
import connection from '../config/redis.js';

export const automationQueue = new Queue('automations', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export default automationQueue;
