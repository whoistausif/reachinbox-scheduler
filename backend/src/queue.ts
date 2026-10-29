import { Queue } from 'bullmq';
import { config, QUEUE_NAME } from './config';
import { redis } from './redis';

export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // Failed jobs are retried with exponential backoff; the DB row is the source of truth.
    attempts: config.worker.maxAttempts,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
