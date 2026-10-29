import 'dotenv/config';

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const str = (key: string, fallback = ''): string => process.env[key] ?? fallback;

const backendUrl = str('BACKEND_URL', 'http://localhost:4000');

export const config = {
  port: num('PORT', 4000),
  backendUrl,
  frontendUrl: str('FRONTEND_URL', 'http://localhost:5173'),
  jwtSecret: str('JWT_SECRET', 'dev-secret-change-me'),
  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
  elasticUrl: str('ELASTICSEARCH_URL', 'http://localhost:9200'),
  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
    redirectUri: `${backendUrl}/api/auth/google/callback`,
  },
  slack: {
    clientId: str('SLACK_CLIENT_ID'),
    clientSecret: str('SLACK_CLIENT_SECRET'),
    redirectUri: `${backendUrl}/api/slack/callback`,
  },
  runWorker: str('RUN_WORKER', 'true') !== 'false',
  worker: {
    concurrency: num('WORKER_CONCURRENCY', 5),
    // Minimum gap between ANY two sends across all worker instances (BullMQ limiter).
    minDelayMs: num('MIN_DELAY_BETWEEN_SENDS_MS', 2000),
    maxAttempts: num('MAX_SEND_ATTEMPTS', 3),
  },
  rate: {
    // Hard per-sender cap per clock hour. A batch may request a lower limit, never a higher one.
    maxPerHourPerSender: num('MAX_EMAILS_PER_HOUR_PER_SENDER', 100),
  },
  senderCount: num('SENDER_COUNT', 3),
} as const;

export const QUEUE_NAME = 'email-send';
export const HOUR_MS = 60 * 60 * 1000;
