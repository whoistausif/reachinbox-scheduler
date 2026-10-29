import { config } from '../config';
import { prisma } from '../db';

export function buildAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.slack.clientId,
    // incoming-webhook makes Slack ask the user to pick a channel and return a webhook URL for it.
    scope: 'incoming-webhook',
    redirect_uri: config.slack.redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string) {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.slack.clientId,
      client_secret: config.slack.clientSecret,
      redirect_uri: config.slack.redirectUri,
    }),
  });
  const data: any = await res.json();
  if (!data.ok || !data.incoming_webhook?.url) {
    throw new Error(`Slack OAuth failed: ${data.error ?? 'no incoming webhook returned'}`);
  }
  return {
    webhookUrl: data.incoming_webhook.url as string,
    channel: (data.incoming_webhook.channel as string | undefined) ?? null,
    teamName: (data.team?.name as string | undefined) ?? null,
  };
}

async function postToWebhook(webhookUrl: string, text: string) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook responded ${res.status}: ${await res.text()}`);
}

/**
 * Real Slack message to the user's connected channel.
 * Not connected => returns false, no error. Slack failures never bubble into the send pipeline.
 */
export async function notifyUser(userId: string, text: string): Promise<boolean> {
  try {
    const conn = await prisma.slackConnection.findUnique({ where: { userId } });
    if (!conn) return false;
    await postToWebhook(conn.webhookUrl, text);
    return true;
  } catch (err) {
    console.error('[slack] notify failed:', (err as Error).message);
    return false;
  }
}

export async function notifyRateLimitHit(
  userId: string,
  info: { senderEmail: string; limit: number; resumeAt: Date },
) {
  return notifyUser(
    userId,
    `:warning: *Hourly send limit reached* for sender \`${info.senderEmail}\` (${info.limit}/hour). ` +
      `Remaining emails are rescheduled and resume at ${info.resumeAt.toISOString()}.`,
  );
}
