# ReachInbox Email Scheduler

A production-style email scheduler service with a dashboard. Emails are accepted over an API, stored in Postgres, and sent at their scheduled time by **BullMQ delayed jobs on Redis** (no cron anywhere). It sends through **Ethereal** fake SMTP from multiple senders, enforces a per-sender hourly rate limit, survives restarts without losing or duplicating emails, and alerts **Slack** when a limit is hit.

## Contents
1. [Tech stack](#tech-stack)
2. [Project structure](#project-structure)
3. [Running the project](#1-running-the-project)
4. [Ethereal Email and environment variables](#2-ethereal-email-and-environment-variables)
5. [Architecture overview](#3-architecture-overview)
6. [Features implemented](#4-features-implemented)
7. [Trying it out](#5-trying-it-out)
8. [API reference](#api-reference)
9. [Troubleshooting](#troubleshooting)
10. [Trade-offs and known gaps](#trade-offs-and-known-gaps)

## Tech stack

| Layer | Technology |
|---|---|
| API | Node.js, Express, TypeScript, Zod validation |
| Queue | BullMQ on Redis (AOF persistence) |
| Database | PostgreSQL via Prisma |
| Email | Nodemailer + Ethereal (fake SMTP) |
| Search | Elasticsearch |
| Queue dashboard | Bull Board |
| Notifications | Slack OAuth + incoming webhook |
| Auth | Google OAuth 2.0, httpOnly JWT session cookie |
| Frontend | React 18, Vite, Tailwind CSS v4, TypeScript, React Router |
| Infra | Docker Compose (Postgres, Redis, Elasticsearch) |

## Project structure

```
.
├── docker-compose.yml        Postgres, Redis (AOF on), Elasticsearch
├── backend/
│   ├── prisma/schema.prisma  User, Sender, Email, SlackConnection
│   └── src/
│       ├── index.ts          Express app, Bull Board, startup, worker boot
│       ├── worker.ts         BullMQ worker: claim, rate limit, send
│       ├── workerMain.ts     Standalone worker entrypoint
│       ├── queue.ts          BullMQ queue and default job options
│       ├── config.ts         All env-driven configuration
│       ├── routes/           auth, emails, slack
│       ├── services/         scheduler, rateLimiter, mailer, slack, search
│       └── middleware/       session auth
└── frontend/
    └── src/
        ├── pages/            Login, Dashboard
        ├── components/       Header, ComposeModal, EmailTables, SlackConnect
        ├── components/ui/    Button, Field, Modal, DataTable, Badge, Toast, Spinner
        ├── hooks/            useAuth, useEmails (polling)
        ├── api/client.ts     Typed API client
        └── types/            Shared TypeScript types
```

---

## 1. Running the project

**Prerequisites:** Node.js 20+, Docker Desktop (running), Git.

### Step 1: Infrastructure (Postgres, Redis, Elasticsearch)

```bash
docker compose up -d
docker compose ps        # postgres, redis, elasticsearch should be "running"
```

### Step 2: Backend (Express API + BullMQ worker)

```bash
cd backend
cp .env.example .env     # PowerShell: copy .env.example .env
# edit .env and fill in your values (see section 2)
npm install
npm run db:generate      # generate the Prisma client
npm run db:push          # create the database tables
npm run dev              # API + worker on http://localhost:4000
```

On first boot you should see Ethereal senders being created and a line like
`[worker] started: concurrency=5, minDelay=2000ms, maxPerHourPerSender=100`.

- Live BullMQ dashboard: http://localhost:4000/admin/queues
- Health check: http://localhost:4000/health

By default the worker runs inside the API process. To run workers separately, set `RUN_WORKER=false` for the API and start any number of extra workers with `npm run worker`. They coordinate through Redis, so concurrency, rate limits and idempotency still hold across processes.

Production build: `npm run build && npm start`.

### Step 3: Frontend

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`, so the login cookie stays same-origin. Production build: `npm run build`.

---

## 2. Ethereal Email and environment variables

### Ethereal

No manual signup is needed. On first boot the backend calls Ethereal's API (`nodemailer.createTestAccount()`) and saves `SENDER_COUNT` fake SMTP accounts (default 3) in the `Sender` table. They are reused across restarts, and outgoing emails are assigned to them round-robin, so the system sends from multiple senders.

Nothing reaches a real inbox. Each sent email stores an Ethereal **preview URL**, and you can also open https://ethereal.email/login with a sender's SMTP username and password (found in the `Sender` table) to read the messages.

### Environment variables

Copy `backend/.env.example` to `backend/.env` and fill it in. **Never commit `.env`.** It is in `.gitignore`, and `.env.example` must stay free of real secrets.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | `4000` |
| `BACKEND_URL` | Public URL of the API (used for the Google redirect) | `http://localhost:4000` |
| `FRONTEND_URL` | Dashboard URL (CORS and post-login redirect) | `http://localhost:5173` |
| `JWT_SECRET` | Signs the session cookie, set a long random value | dev placeholder |
| `DATABASE_URL` | Postgres connection | matches docker-compose |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | Elasticsearch | `http://localhost:9200` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth login | required |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack OAuth app | needed for Slack alerts |
| `SLACK_REDIRECT_URI` | HTTPS Slack callback (tunnel URL + `/api/slack/callback`) | `BACKEND_URL` based |
| `WORKER_CONCURRENCY` | Parallel jobs per worker process | `5` |
| `MIN_DELAY_BETWEEN_SENDS_MS` | Minimum gap between sends | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Hourly cap per sender | `100` |
| `MAX_SEND_ATTEMPTS` | Attempts per email (exponential backoff) | `3` |
| `SENDER_COUNT` | Number of Ethereal senders | `3` |
| `RUN_WORKER` | Run the worker inside the API process | `true` |

### Google OAuth setup

1. Google Cloud Console → **OAuth consent screen**: choose External and add your Gmail as a test user.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Add the authorized redirect URI `http://localhost:4000/api/auth/google/callback` (it must match exactly).
4. Put the client ID and secret into `backend/.env`.

### Slack OAuth setup

Slack only accepts HTTPS redirect URLs, so tunnel the backend first.

1. Run `ngrok http 4000` and copy the `https://...` URL.
2. https://api.slack.com/apps → **Create New App → From scratch**.
3. **OAuth & Permissions**: add the redirect URL `https://<tunnel>/api/slack/callback` and the `incoming-webhook` scope.
4. Put the app's client ID and secret in `.env` and set `SLACK_REDIRECT_URI=https://<tunnel>/api/slack/callback`. Keep `BACKEND_URL` as `http://localhost:4000`, because Google login still uses it.
5. Restart the backend. In the dashboard click **Connect Slack**, choose a channel, then **Test** to confirm a real message arrives.

---

## 3. Architecture overview

```
React ──/api──> Express ──> Postgres (source of truth)
                   │──> BullMQ delayed job per email (jobId = email.id) ──> Redis
                   └──> Elasticsearch (best-effort index)

BullMQ worker(s):
   claim DB row atomically ──> take hourly slot (Redis) ──> send via Ethereal SMTP
        │                              │
        │                              └─ limit hit: move job to next hour + Slack message
        └─ already sent/claimed: skip
```

### How scheduling works

`POST /api/emails/schedule` takes the subject, body, recipients, start time, delay between emails and hourly limit. For each recipient it:

1. Inserts an `Email` row in Postgres (status `scheduled`).
2. Adds a BullMQ **delayed job** with `delay = scheduledAt - now` and `jobId = email.id`.

Email *i* of a batch is scheduled at `start + i × delay`, and senders are assigned round-robin. When a job's delay expires, BullMQ hands it to a worker. The system uses no cron: no OS cron, no `node-cron`, no `agenda`.

### How persistence on restart is handled

- **Redis AOF persistence:** delayed jobs live in Redis with append-only persistence on, so they survive API, worker and Redis restarts. After a restart they still fire at the right time and nothing restarts from scratch.
- **Postgres as the source of truth:** every email and its status is stored in the database. On startup `reconcile()` re-enqueues any `scheduled` row that has lost its job (for example if Redis was wiped) and releases rows stuck in `processing` after a worker crash.
- **No duplicate sends (idempotency):**
  - `jobId = email.id`, so adding the same job twice is ignored.
  - Before sending, the worker claims the row with `UPDATE ... WHERE status = 'scheduled'`. If it updates zero rows, the email was already handled and the job exits.
  - Only the success path writes `sent`.

### How rate limiting and concurrency are implemented

- **Worker concurrency:** `WORKER_CONCURRENCY` (default 5) jobs run in parallel per worker process. This is safe because each job claims its row atomically and the rate-limit counter is atomic in Redis.
- **Minimum delay between sends:** default **2000 ms**, using BullMQ's worker `limiter: { max: 1, duration: MIN_DELAY_BETWEEN_SENDS_MS }`. It is enforced in Redis, so it holds across all worker instances.
- **Emails per hour:** the limit is per sender and per clock hour (`MAX_EMAILS_PER_HOUR_PER_SENDER`, default 100). A batch may request a lower limit in the compose form, never a higher one. A **Redis Lua script** on the key `rl:count:{senderId}:{hourWindow}` increments, compares and rolls back in one atomic step, so it is correct across any number of workers or instances. Nothing is kept in memory, and keys expire after two hours.
- **When the limit is reached:** jobs are never dropped or failed. The job goes back to `scheduled` and is moved to the start of the **next hour window**, with a small offset based on its original time so earlier emails retry first. Order is preserved as far as practical.
- **1000+ emails at once:** all rows are inserted and queued as delayed jobs in chunks of 500. Throughput is bounded by the limiter and the per-sender hourly caps. With 3 senders at 100 per hour, about 300 go out in the first hour, and the rest roll into later hours automatically with no loss and no duplicates.
- **Slack on a limit hit:** the first limited job per sender per hour (deduplicated with Redis `SET NX`) posts a real message to the user's connected channel. If Slack is not connected, the notifier returns quietly. Connecting later works immediately without a redeploy, because the connection is looked up on every hit.

### Search

Emails are indexed in Elasticsearch when scheduled and re-indexed when sent or failed. `GET /api/emails/search?q=...` runs a fuzzy multi-field search scoped to the signed-in user. Indexing is best-effort, so an Elasticsearch outage never blocks scheduling or sending.

---

## 4. Features implemented

### Backend

| Area | What was built | Where |
|---|---|---|
| Scheduler | API stores emails in Postgres and creates BullMQ delayed jobs, no cron | `routes/emails.ts`, `services/scheduler.ts`, `queue.ts` |
| Persistence | Redis AOF, DB source of truth, startup `reconcile()`, stale-claim recovery | `services/scheduler.ts`, `docker-compose.yml` |
| Idempotency | `jobId = email.id` plus atomic row claim | `worker.ts` |
| Rate limiting | Per-sender hourly cap, Redis Lua counter, env-configurable, multi-instance safe | `services/rateLimiter.ts` |
| Deferral | Over-limit jobs move to the next hour window, never dropped | `worker.ts` |
| Concurrency | Configurable worker concurrency | `worker.ts`, `WORKER_CONCURRENCY` |
| Minimum delay | BullMQ limiter, configurable | `worker.ts`, `MIN_DELAY_BETWEEN_SENDS_MS` |
| Multiple senders | Ethereal accounts created automatically, round-robin | `services/mailer.ts` |
| Retries | Exponential backoff, final `failed` status stored | `queue.ts`, `worker.ts` |
| Search | Elasticsearch indexing and search endpoint | `services/search.ts` |
| Queue visibility | Live Bull Board | `index.ts` at `/admin/queues` |
| Slack | OAuth connect, live message on limit hit, disconnect and reconnect | `routes/slack.ts`, `services/slack.ts` |
| Auth | Google OAuth, httpOnly session cookie | `routes/auth.ts`, `middleware/auth.ts` |

### Frontend

| Area | What was built | Where |
|---|---|---|
| Login | Real Google OAuth, redirect to the dashboard | `pages/Login.tsx` |
| Header | User name, email, avatar, logout | `components/Header.tsx` |
| Dashboard | Scheduled and Sent tabs plus a Compose New Email button | `pages/Dashboard.tsx` |
| Compose | Subject, body, CSV or text lead upload with detected-address count, start time, delay, hourly limit, Schedule | `components/ComposeModal.tsx`, `lib/csv.ts` |
| Scheduled table | Email, subject, scheduled time, status | `components/EmailTables.tsx` |
| Sent table | Email, subject, sent time, status (`sent` or `failed`) | `components/EmailTables.tsx` |
| UX states | Loading indicators, empty states, error messages, toasts, live polling | `components/ui/DataTable.tsx`, `ui/Toast.tsx`, `hooks/useEmails.ts` |
| Slack | Connect, test and disconnect buttons | `components/SlackConnect.tsx` |
| Code quality | Reusable UI components, typed API client and props, DRY tables | `components/ui/*`, `api/client.ts`, `types/` |

---

## 5. Trying it out

**Basic flow**
1. Sign in with Google, click **Compose New Email**, upload a CSV or text file containing addresses, set the start time a few minutes ahead, and click **Schedule**.
2. Watch the emails in **Scheduled Emails**, and in Bull Board under **Delayed**. At the start time they move to **Sent Emails** (Bull Board **Completed**).

**Check restart persistence**
1. Schedule a few emails about 3 minutes ahead.
2. Stop the backend with `Ctrl+C`, wait a moment, then start it again with `npm run dev`.
3. The emails still appear as delayed and are sent at the original time, each exactly once.

**Check the rate limit and Slack alert**
1. Set `MAX_EMAILS_PER_HOUR_PER_SENDER=2` in `.env` and restart the backend.
2. Schedule about 10 leads starting now.
3. Only a few are sent. The rest stay scheduled and move to the next hour window, nothing fails, and a message arrives in your connected Slack channel.

---

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/google`, `/api/auth/google/callback` | Google OAuth |
| GET, POST | `/api/auth/me`, `/api/auth/logout` | Session |
| POST | `/api/emails/schedule` | `{ subject, body, recipients[], startTime, delayBetweenMs, hourlyLimit }` |
| GET | `/api/emails?status=scheduled\|sent` | Tab data (sent includes failed) |
| GET | `/api/emails/search?q=` | Elasticsearch search |
| GET | `/api/slack/connect`, `/api/slack/callback` | Slack OAuth |
| GET, DELETE, POST | `/api/slack/status`, `/api/slack`, `/api/slack/test` | Slack connection |
| GET | `/admin/queues` | Bull Board |
| GET | `/health` | Health check |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `docker compose` fails or cannot connect | Start Docker Desktop and wait until it says running, then retry |
| `run : The term 'run' is not recognized` | Type only `docker compose up -d`, without the word `run` |
| `Unique constraint failed on the fields: (email)` at startup | Use the latest code (senders are saved with an upsert), and make sure only one backend is running |
| `SLACK_CLIENT_ID not configured` | Fill in the Slack variables in `backend/.env` and restart, or skip Slack for now |
| `redirect_uri_mismatch` from Google | The redirect URI in Google Cloud must be exactly `http://localhost:4000/api/auth/google/callback` |
| Google blocks the login | Add your Gmail as a test user on the OAuth consent screen |
| Elasticsearch warning on startup | Harmless while it is still starting. Search is simply disabled until it is up |
| GitHub blocks a push (secret detected) | Keep real keys only in `.env`, never in `.env.example`, then amend the commit |

## Trade-offs and known gaps

- **Fixed hourly window:** limits reset on the clock hour rather than sliding, which is simple and predictable but allows a burst across an hour boundary.
- **Crash window:** if a worker dies after SMTP accepted a message but before the database write, the stale-claim recovery (2 minutes) can resend that single email. Closing this fully needs an SMTP-side idempotency key, which Ethereal does not offer.
- **Bull Board is unauthenticated.** Put it behind authentication before exposing it publicly.
- **Design file:** the Figma file was not included with the brief, so the UI follows the written requirements with a clean layout instead of a pixel match.
