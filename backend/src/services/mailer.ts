import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { prisma } from '../db';

const transporters = new Map<string, Transporter>();

/** Ensure SENDER_COUNT Ethereal accounts exist in the DB (created once, reused after restarts). */
export async function ensureSenders() {
  let attempts = 0;
  while ((await prisma.sender.count()) < config.senderCount && attempts < config.senderCount * 3) {
    attempts++;
    const acct = await nodemailer.createTestAccount();
    try {
      // upsert: an already-saved account is a no-op instead of a crash
      await prisma.sender.upsert({
        where: { email: acct.user },
        update: {},
        create: {
          email: acct.user,
          smtpUser: acct.user,
          smtpPass: acct.pass,
          smtpHost: acct.smtp.host,
          smtpPort: acct.smtp.port,
        },
      });
      console.log(`[mailer] sender ready: ${acct.user}`);
    } catch (err) {
      console.warn('[mailer] could not save sender, retrying:', (err as Error).message);
    }
  }
  return prisma.sender.findMany({ orderBy: { email: 'asc' } });
}

function transporterFor(sender: { id: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string }) {
  let t = transporters.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: false,
      auth: { user: sender.smtpUser, pass: sender.smtpPass },
    });
    transporters.set(sender.id, t);
  }
  return t;
}

export async function sendEmail(
  sender: { id: string; email: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string },
  msg: { to: string; subject: string; body: string },
) {
  const info = await transporterFor(sender).sendMail({
    from: sender.email,
    to: msg.to,
    subject: msg.subject,
    text: msg.body,
    html: msg.body.replace(/\n/g, '<br/>'),
  });
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null };
}
