import { DelayedError, Job, Worker } from 'bullmq';
import { config, QUEUE_NAME } from './config';
import { prisma } from './db';
import { EmailJobData } from './queue';
import { createRedis } from './redis';
import { sendEmail } from './services/mailer';
import { markNotified, nextWindowStart, releaseSlot, tryTakeSlot } from './services/rateLimiter';
import { indexEmail } from './services/search';
import { notifyRateLimitHit } from './services/slack';

const STALE_PROCESSING_MS = 2 * 60 * 1000;

async function processEmail(job: Job<EmailJobData>, token?: string) {
  const { emailId } = job.data;

  // ---- Idempotency: atomically claim the row. Only one worker can move scheduled -> processing.
  const claimed = await prisma.email.updateMany({
    where: {
      id: emailId,
      OR: [
        { status: 'scheduled' },
        // reclaim a row abandoned by a crashed worker
        { status: 'processing', updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
      ],
    },
    data: { status: 'processing', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { skipped: true }; // already sent / failed / in-flight elsewhere

  const email = await prisma.email.findUniqueOrThrow({ where: { id: emailId }, include: { sender: true } });

  // ---- Hourly rate limit (Redis counter, atomic across all workers/instances).
  const limit = Math.min(email.hourlyLimit, config.rate.maxPerHourPerSender);
  const gotSlot = await tryTakeSlot(email.senderId, limit);
  if (!gotSlot) {
    const resumeAt = nextWindowStart();
    // Not dropped, not failed: put it back and push it to the start of the next hour window.
    // The small offset keeps original order (earlier scheduledAt => earlier retry within the window).
    const orderOffsetMs = Math.max(0, Math.min(email.scheduledAt.getTime() % 60000, 59000));
    await prisma.email.update({ where: { id: emailId }, data: { status: 'scheduled' } });
    await job.moveToDelayed(resumeAt + orderOffsetMs, token);

    if (await markNotified(email.senderId)) {
      const sent = await notifyRateLimitHit(email.userId, {
        senderEmail: email.sender.email,
        limit,
        resumeAt: new Date(resumeAt),
      });
      console.log(`[worker] rate limit hit for ${email.sender.email}; slack notified: ${sent}`);
    }
    throw new DelayedError();
  }

  // ---- Send.
  try {
    const { messageId, previewUrl } = await sendEmail(email.sender, {
      to: email.toEmail,
      subject: email.subject,
      body: email.body,
    });
    const updated = await prisma.email.update({
      where: { id: emailId },
      data: { status: 'sent', sentAt: new Date(), messageId, previewUrl, error: null },
    });
    await indexEmail(updated);
    return { messageId };
  } catch (err) {
    const message = (err as Error).message;
    await releaseSlot(email.senderId); // nothing left the building, give the slot back
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const updated = await prisma.email.update({
      where: { id: emailId },
      data: { status: finalAttempt ? 'failed' : 'scheduled', error: message, ...(finalAttempt ? { sentAt: new Date() } : {}) },
    });
    if (finalAttempt) await indexEmail(updated);
    throw err; // BullMQ handles retry/backoff
  }
}

export function startWorker() {
  const worker = new Worker<EmailJobData>(QUEUE_NAME, processEmail, {
    connection: createRedis(),
    concurrency: config.worker.concurrency,
    // Minimum delay between sends: at most 1 job started per MIN_DELAY_BETWEEN_SENDS_MS,
    // enforced in Redis so it holds across all worker instances.
    limiter: { max: 1, duration: config.worker.minDelayMs },
  });

  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));
  worker.on('error', (err) => console.error('[worker] error:', err.message));
  console.log(
    `[worker] started: concurrency=${config.worker.concurrency}, minDelay=${config.worker.minDelayMs}ms, ` +
      `maxPerHourPerSender=${config.rate.maxPerHourPerSender}`,
  );
  return worker;
}
