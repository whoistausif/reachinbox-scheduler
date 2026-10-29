import { randomBytes } from 'crypto';
import { Router } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { COOKIE, requireAuth, signSession, AuthedRequest } from '../middleware/auth';

export const authRouter = Router();
const STATE_COOKIE = 'ri_oauth_state';

// Step 1: send the browser to Google's real consent screen.
authRouter.get('/google', (_req, res) => {
  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step 2: exchange the code, read the profile, create/update the user, start a session.
authRouter.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) {
      return res.redirect(`${config.frontendUrl}/?error=oauth_state`);
    }
    res.clearCookie(STATE_COOKIE);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens: any = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens.error_description ?? 'token exchange failed');

    const profRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile: any = await profRes.json();
    if (!profRes.ok || !profile.sub) throw new Error('could not read Google profile');

    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      create: { googleId: profile.sub, email: profile.email, name: profile.name ?? profile.email, avatar: profile.picture },
      update: { email: profile.email, name: profile.name ?? profile.email, avatar: profile.picture },
    });

    res.cookie(COOKIE, signSession(user.id), { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    res.redirect(`${config.frontendUrl}/dashboard`);
  } catch (err) {
    console.error('[auth] google callback failed:', (err as Error).message);
    res.redirect(`${config.frontendUrl}/?error=oauth_failed`);
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: (req as AuthedRequest).userId },
    select: { id: true, name: true, email: true, avatar: true },
  });
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
