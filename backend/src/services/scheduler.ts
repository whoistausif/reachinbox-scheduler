import { randomUUID } from 'crypto';
import { config } from '../config';
import { prisma } from '../db';
import { emailQueue } from '../queue';
import { bulkIndexEmails } from './search';

export interface ScheduleInput {
  userId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenMs: number;
  hourlyLimit: number;
}

const CHUNK = 500;

/**
 * 1. Persist every email in Postgres (source of truth).
 * 2. Enqueue a BullMQ *delayed* job per email with jobId === email.id (idempotent: BullMQ ignores
 *    a second add with the same id, so retries of this request can't double-queue).
 * Email i is scheduled at start + i * delayBetweenMs, senders are assigned round-robin.
 */
export async function scheduleBatch(input: ScheduleInput) {
  const senders = await prisma.sender.findMany({ orderBy: { email: 'asc' } });
  if (!senders.length) throw new Error('No senders configured');

  const batchId = randomUUID();
  const hourlyLimit = Math.min(input.hourlyLimit, config.rate.maxPerHourPerSender);

  const rows = input.recipients.map((to, i) => ({
    id: randomUUID(),
    userId: input.userId,
    senderId: senders[i % senders.length].id,
    batchId,
    toEmail: to,
    subject: input.subject,
    body: input.body,
    scheduledAt: new Date(input.startTime.getTime() + i * input.delayBetweenMs),
    hourlyLimit,
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.email.createMany({ data: chunk });
    const now = Date.now();
    await emailQueue.addBulk(
      chunk.map((r) => ({
        name: 'send',
        data: { emailId: r.id },
        opts: { jobId: r.id, delay: Math.max(0, r.scheduledAt.getTime() - now) },
      })),
    );
    await bulkIndexEmails(chunk.map((r) => ({ ...r, status: 'scheduled' })));
  }

  return { batchId, count: rows.length, hourlyLimit };
}

/**
 * Startup reconciliation (belt and braces on top of Redis persistence):
 * - rows stuck in `processing` from a crashed worker go back to `scheduled`
 * - any `scheduled` row without a live job (e.g. Redis was wiped) is re-enqueued
 * Re-adding with the same jobId is a no-op when the job already exists, so nothing is duplicated.
 */
export async function reconcile() {
  await prisma.email.updateMany({
    where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
    data: { status: 'scheduled' },
  });

  let requeued = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.email.findMany({
      where: { status: 'scheduled' },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, scheduledAt: true },
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;

    const missing: typeof page = [];
    for (const e of page) if (!(await emailQueue.getJob(e.id))) missing.push(e);
    if (missing.length) {
      const now = Date.now();
      await emailQueue.addBulk(
        missing.map((e) => ({
          name: 'send',
          data: { emailId: e.id },
          opts: { jobId: e.id, delay: Math.max(0, e.scheduledAt.getTime() - now) },
        })),
      );
      requeued += missing.length;
    }
  }
  if (requeued) console.log(`[scheduler] re-enqueued ${requeued} missing jobs`);
}
