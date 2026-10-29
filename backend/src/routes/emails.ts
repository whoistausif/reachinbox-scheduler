import { EmailStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../db';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { scheduleBatch } from '../services/scheduler';
import { searchEmails } from '../services/search';

export const emailsRouter = Router();
emailsRouter.use(requireAuth);

const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1),
  recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(100_000),
  startTime: z.coerce.date(),
  delayBetweenMs: z.number().int().min(0).default(config.worker.minDelayMs),
  hourlyLimit: z.number().int().min(1).default(config.rate.maxPerHourPerSender),
});

emailsRouter.post('/schedule', async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const recipients = [...new Set(parsed.data.recipients)]; // de-dupe leads
  const result = await scheduleBatch({ ...parsed.data, recipients, userId: (req as AuthedRequest).userId });
  res.status(201).json(result);
});

const listSchema = z.object({
  status: z.enum(['scheduled', 'sent']).default('scheduled'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// "scheduled" tab = scheduled + processing; "sent" tab = sent + failed.
emailsRouter.get('/', async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
  const { status, page, pageSize } = parsed.data;
  const where = {
    userId: (req as AuthedRequest).userId,
    status: { in: status === 'scheduled' ? (['scheduled', 'processing'] as EmailStatus[]) : (['sent', 'failed'] as EmailStatus[]) },
  };
  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: status === 'scheduled' ? { scheduledAt: 'asc' } : { sentAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, toEmail: true, subject: true, scheduledAt: true, sentAt: true,
        status: true, error: true, previewUrl: true,
      },
    }),
    prisma.email.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});

// Elasticsearch-backed search over scheduled + sent emails.
emailsRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json({ items: await searchEmails((req as AuthedRequest).userId, q, status) });
  } catch (err) {
    res.status(503).json({ error: 'Search unavailable', detail: (err as Error).message });
  }
});
