# ReachInbox Email Scheduler

Production-style email scheduler: Express + TypeScript API, BullMQ/Redis delayed jobs (no cron), Postgres (Prisma), Ethereal SMTP, Elasticsearch search, Bull Board dashboard, Slack rate-limit alerts, and a React + Tailwind dashboard with Google login.

## Quick start

```bash
docker compose up -d                      # Postgres, Redis (AOF on), Elasticsearch

cd backend
cp .env.example .env                      # fill in Google + Slack credentials
npm install
npm run db:generate && npm run db:push    # Prisma client + schema
npm run dev                               # API + worker on :4000

cd ../frontend
npm install
npm run dev                               # http://localhost:5173
```

- Bull Board (live queue view): http://localhost:4000/admin/queues
- Ethereal accounts are created automatically on first boot (`SENDER_COUNT`, default 3). Each sent email stores an Ethereal `previewUrl`.

### OAuth setup
- **Google**: create an OAuth client; authorized redirect URI `http://localhost:4000/api/auth/google/callback`.
- **Slack**: create an app, add the `incoming-webhook` scope. Slack requires an **HTTPS** redirect URL, so expose the backend with ngrok/cloudflared, set `BACKEND_URL` to that https URL and register `<BACKEND_URL>/api/slack/callback`. (Google's redirect then also uses `BACKEND_URL`, so register that too.)

## Architecture

```
React ──/api──> Express ──> Postgres (source of truth)
                   │──> BullMQ delayed job per email (jobId = email.id) ──> Redis
                   └──> Elasticsearch (best-effort index)
BullMQ Worker(s) ──> claim row ──> Redis hourly counter ──> Ethereal SMTP ──> update DB + ES
                                       └─ limit hit ──> reschedule next hour + Slack message
```

### Scheduling & persistence (no cron)
`POST /api/emails/schedule` writes each email to Postgres, then adds a BullMQ **delayed job** (`delay = scheduledAt - now`). Email *i* of a batch is scheduled at `start + i × delay`; senders are assigned round-robin. Jobs live in Redis (AOF enabled), so a server restart changes nothing: delayed jobs fire at the right time. On boot, `reconcile()` additionally re-enqueues any `scheduled` DB row that has no job (e.g. Redis wiped) and releases rows stuck in `processing` from a crashed worker. No `cron`, `node-cron` or `agenda` anywhere.

### Idempotency (never send twice)
1. `jobId = email.id`, so a duplicate enqueue is ignored by BullMQ.
2. The worker atomically claims the row with `UPDATE … WHERE status='scheduled'` (`scheduled → processing`). If zero rows change (already sent, or another worker has it), the job exits without sending.
3. Only the success path writes `sent`.

Trade-off: if a worker crashes *after* SMTP accepted but *before* the DB write, the stale-claim recovery (2 min) can resend that one email. Closing that gap fully needs an SMTP-side idempotency key, which Ethereal doesn't offer.

### Concurrency & minimum delay
- `WORKER_CONCURRENCY` (default **5**) parallel jobs per worker process. Safe because each job claims its row atomically and the rate limiter is atomic in Redis.
- **Minimum delay between sends: `MIN_DELAY_BETWEEN_SENDS_MS` = 2000 ms** (default, i.e. at most one send start per 2 s). Implemented with the BullMQ worker `limiter: { max: 1, duration }`, which is enforced in Redis and therefore holds across all worker instances. The compose form's "delay between emails" additionally spaces the scheduled times within a batch.

### Hourly rate limit
- Per **sender**, per clock hour: `MAX_EMAILS_PER_HOUR_PER_SENDER` (default **100**). A batch can request a lower limit in the compose form, never a higher one.
- Enforced with a **Redis Lua script** on key `rl:count:{senderId}:{hourWindow}` (INCR, compare, roll back if over). Being atomic in Redis, it is correct across any number of workers/instances; nothing is held in memory. Keys expire after 2 h.
- When the limit is hit the job is **not dropped or failed**: it is moved back to `scheduled` and `moveToDelayed` to the start of the **next hour window** (plus a sub-minute offset derived from its original `scheduledAt`, so earlier emails retry first). Because delayed jobs are ordered by time, order is preserved as far as practical.
- Trade-off: the counter is per clock hour (fixed window), not sliding, so a sender can send up to the limit at 10:59 and again at 11:00. Simple and predictable; a sliding window would cost more Redis work.

### Behavior under load (1000+ emails at the same time)
All 1000+ rows are inserted (chunks of 500) and queued as delayed jobs. Throughput is then bounded by the limiter (1 start / 2 s) and per-sender hourly caps. With 3 senders × 100/hour, ~300 go out in the first hour; the rest keep bouncing to the next hour window automatically, with no losses and no duplicate sends. Slack is pinged once per sender per hour window (deduped via `SET NX`), not once per deferred job.

### Slack notifications
Header → **Connect Slack** → real Slack OAuth (`incoming-webhook`); the returned webhook URL is stored per user. When a sender's hourly limit is hit, the worker posts a real message to that webhook. If the user has no connection, the notifier returns early (no error); connecting later works immediately, no redeploy (looked up on every hit). **Disconnect** deletes the row. A **Test** button sends a live message so you can verify the integration without waiting for a limit.

To demo quickly: set `MAX_EMAILS_PER_HOUR_PER_SENDER=2`, schedule 10 leads, and watch Slack.

### Search (Elasticsearch)
Emails are indexed on schedule and re-indexed on send/fail (`emails` index). `GET /api/emails/search?q=…&status=sent` does fuzzy multi-field search scoped to the logged-in user. Indexing is best-effort: if Elasticsearch is down, scheduling and sending still work.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/google` / `/callback` | Google OAuth |
| GET | `/api/auth/me`, POST `/logout` | Session |
| POST | `/api/emails/schedule` | `{subject, body, recipients[], startTime, delayBetweenMs, hourlyLimit}` |
| GET | `/api/emails?status=scheduled\|sent` | Tabs (sent includes failed) |
| GET | `/api/emails/search?q=` | Elasticsearch search |
| GET/DELETE/POST | `/api/slack/status`, `/`, `/test` | Slack connection |
| GET | `/admin/queues` | Bull Board |

## Config reference (`backend/.env`)
`WORKER_CONCURRENCY`, `MIN_DELAY_BETWEEN_SENDS_MS`, `MAX_EMAILS_PER_HOUR_PER_SENDER`, `MAX_SEND_ATTEMPTS`, `SENDER_COUNT`, `RUN_WORKER` (set `false` on the API and run `npm run worker` separately to scale workers out).

## Known gaps
- The Figma file was not included in the brief, so the UI follows the written requirements with a clean generic layout rather than pixel-matching a design.
- Bull Board is unauthenticated; put it behind auth before exposing it publicly.
