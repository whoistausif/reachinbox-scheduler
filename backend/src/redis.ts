import IORedis from 'ioredis';
import { config } from './config';

// BullMQ requires maxRetriesPerRequest: null for blocking connections (workers).
export const createRedis = () => new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// Shared connection for queue producers and rate-limit counters.
export const redis = createRedis();
