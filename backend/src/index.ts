import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { prisma } from './db';
import { emailQueue } from './queue';
import { authRouter } from './routes/auth';
import { emailsRouter } from './routes/emails';
import { slackRouter } from './routes/slack';
import { ensureSenders } from './services/mailer';
import { reconcile } from './services/scheduler';
import { ensureIndex } from './services/search';
import { startWorker } from './worker';

async function main() {
  const app = express();
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '10mb' })); // large lead lists
  app.use(cookieParser());

  // Live BullMQ dashboard
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
  app.use('/admin/queues', serverAdapter.getRouter());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/emails', emailsRouter);
  app.use('/api/slack', slackRouter);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  await prisma.$connect();
  await ensureSenders();
  await ensureIndex();
  await reconcile();
  if (config.runWorker) startWorker();

  app.listen(config.port, () => {
    console.log(`API on ${config.backendUrl}  |  Bull Board: ${config.backendUrl}/admin/queues`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
