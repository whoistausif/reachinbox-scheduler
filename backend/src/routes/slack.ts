import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { buildAuthorizeUrl, exchangeCode, notifyUser } from '../services/slack';

export const slackRouter = Router();

// Browser navigation from the "Connect Slack" button. State is a short-lived signed token binding the flow to the user.
slackRouter.get('/connect', requireAuth, (req, res) => {
  if (!config.slack.clientId) return res.status(500).json({ error: 'SLACK_CLIENT_ID not configured' });
  const state = jwt.sign({ sub: (req as AuthedRequest).userId, purpose: 'slack' }, config.jwtSecret, { expiresIn: '10m' });
  res.redirect(buildAuthorizeUrl(state));
});

// Slack redirects here (must be HTTPS and registered in the Slack app).
slackRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  const back = (q: string) => res.redirect(`${config.frontendUrl}/dashboard?${q}`);
  if (error || !code || !state) return back('slack=denied');
  try {
    const payload = jwt.verify(state, config.jwtSecret) as { sub: string; purpose?: string };
    if (payload.purpose !== 'slack') throw new Error('bad state');
    const conn = await exchangeCode(code);
    await prisma.slackConnection.upsert({
      where: { userId: payload.sub },
      create: { userId: payload.sub, ...conn },
      update: conn,
    });
    back('slack=connected');
  } catch (err) {
    console.error('[slack] callback failed:', (err as Error).message);
    back('slack=error');
  }
});

slackRouter.get('/status', requireAuth, async (req, res) => {
  const conn = await prisma.slackConnection.findUnique({
    where: { userId: (req as AuthedRequest).userId },
    select: { teamName: true, channel: true },
  });
  res.json({ connected: !!conn, teamName: conn?.teamName ?? null, channel: conn?.channel ?? null });
});

// Disconnect: row removed => later rate-limit hits silently skip notification.
slackRouter.delete('/', requireAuth, async (req, res) => {
  await prisma.slackConnection.deleteMany({ where: { userId: (req as AuthedRequest).userId } });
  res.json({ ok: true });
});

// Demo helper: sends a real message so the integration can be verified without waiting for a limit hit.
slackRouter.post('/test', requireAuth, async (req, res) => {
  const ok = await notifyUser((req as AuthedRequest).userId, ':white_check_mark: ReachInbox Slack connection works.');
  res.status(ok ? 200 : 409).json({ sent: ok });
});
