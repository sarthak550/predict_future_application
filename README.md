# Predict Future

**An India-first, play-money app that pairs expert financial opinion with community prediction markets.**

Tagline: _"Swipe through the news. Predict what happens next."_

Predict Future is a mobile-first product (Android via Expo, web + admin via Next.js) built around two pillars. Everything is **virtual points only** — no deposits, no withdrawals, no cash conversion.

---

## What the product is

### Pillar A — Finance (the moat)

The core differentiator is **aggregating expert market opinions in one place**. We ingest Indian financial news, use LLMs to extract structured **analyst opinions** (an expert, an instrument like _Nifty 50 / Bank Nifty / Reliance / Gold_, and a direction — BULLISH / BEARISH / NEUTRAL — with a rationale), and present them as a searchable, filterable feed with a **Market Sentiment** gauge (bullish/bearish/neutral counts, scopeable to a chosen instrument).

Around that sits **Market Pulse** — real-time, ticker-tagged stock news:

- **Top Movers** — all-market NSE gainers/losers (served from a warm snapshot written by a cron; every stock, not a cap).
- **Announcements** — NSE corporate filings, ticker-first.
- **Stock news** — per-ticker Google News, filtered to material, price-relevant items.

Rates/events (RBI, Budget, "flagship events") are secondary commodity context — the expert-opinion aggregation is the value, not raw data richness.

### Pillar B — Prediction markets

Users spend virtual points to take positions on BINARY / NUMERIC / MULTIPLE_CHOICE questions across categories (Finance, Sports, Entertainment, Tech, Politics, etc.). Markets have a lifecycle: open → close → resolve, with source-cited or host resolution, challenge windows, host bonds/commission, payouts, timeouts, and refunds.

### The play-money economy

- Every user starts with **10,000 points** (`ONBOARDING_BONUS`).
- Betting is atomically blocked when balance < stake (wallet floors at 0, never negative).
- Points are replenished by: **daily login bonus (+100/day, once per IST calendar day)**, quests, referrals, level rewards, winning positions, and tips. The daily bonus guarantees no user is ever permanently locked out.

---

## What we're building now

Current direction (this is a living product; check git log / `.claude/agent-memory/` for the latest):

- **Finance-first**: deepen expert-opinion coverage (more sources, higher extraction recall) and Market Pulse quality (material news only, correct all-market movers).
- **Market backlog reseed** (in progress): the old market backlog was seeded by importing from Manifold — being **replaced by an admin-authored, long-dated, India-relevant question set** (finance, sports, entertainment, tech, India politics/current-affairs, human-interest), presented as fully in-house with no external attribution. A `reset-markets.ts` script (refund open positions → back up → wipe) plus attribution scrubbing is staged for this.
- **Retention**: daily login bonus (shipped), quests, streaks (planned).

---

## Architecture

The **backend is authoritative**. Web and mobile are clients that consume APIs — they never own business rules. This matters because the product has heavy server-controlled logic: news ingestion + LLM extraction, market creation/moderation, host trust, bonds/commission, resolution + challenge windows, payouts/timeouts/refunds, and the wallet ledger.

```text
apps/
  api/                  Next.js backend + Prisma boundary (THE source of truth)
  web/                  Next.js web product + admin/moderation/resolution tools
  mobile/               Expo React Native app (Android now, iOS later) — native, not a webview

packages/
  api-client/           typed fetch client used by mobile (and web, gradually)
  auth-shared/          token/header helpers for cross-platform auth
  business-rules/       pure host-trust, policy, ranking, probability, numeric-market logic
  config/               shared product constants (APP_NAME, STARTING_BALANCE, category labels, …)
  types/                shared DTOs / API shapes (ApiFinance*, ApiMarket*, ApiNewsFeedItem, …)
  ui-tokens/            cross-platform colors, spacing, radii, shadows, typography
  utils/                formatting + generic helpers (formatRelativeTime, freshnessColor, …)
  validation/           shared Zod schemas
```

Rule of thumb: **pure logic → `packages/business-rules` / `utils`; DTOs → `packages/types`; input schemas → `packages/validation`; all Prisma/DB access + side effects → `apps/api`; clients call through `packages/api-client`.** This keeps business rules single-sourced across platforms.

---

## Domain map (where the important logic lives)

A quick index for finding your way around `apps/api`:

| Domain | Key locations |
|---|---|
| **Prediction markets & positions** | `app/api/markets/**`, `lib/markets/**` (`payouts.ts`, `bond.ts`, `create.ts`) |
| **Wallet, points & ledger** | `Wallet` / `WalletTransaction` (Prisma); credits/debits by `WalletTransactionType` |
| **Quests & daily bonus** | `lib/quests/{definitions,engine}.ts`, `app/api/quests/today`, `app/api/users/me/daily-bonus` |
| **Finance — expert opinions** | `lib/ai/extractExpertOpinions.ts`, `app/api/finance/expert-*`, `lib/finance/instrumentCatalog.ts` |
| **Market Pulse (NSE + news)** | `lib/marketMoves/**` (`nse.ts`, `googleNews.ts`, `classify.ts`), `app/api/finance/market-moves/**` |
| **News → summary pipeline** | `lib/news/**` (`rss-ingestion-service.ts`, `articleBody.ts`, `queries.ts`), `lib/ai/{groq,gemini}.ts` |
| **Cron jobs** | `app/api/cron/**` (news ingestion, market-moves-{movers,news,announcements}, finance-opinions, resolution syncs, reminders) |
| **Auth** | `lib/auth.ts` (`getUserIdFromRequest`, JWT via `NEXTAUTH_SECRET`), `app/api/auth/mobile/{login,register}` |

**News → summary pipeline note:** raw stories are ingested (RSS + keyless Google News), bodies are fetched (Google News links are opaque base64 IDs decoded via a `batchexecute` RPC), then summarized by an LLM (Groq with a Gemini fallback). Only stories with a real AI summary (`summaryReady = true`) surface in the feed; an India filter (`indiaOnly`) narrows to India-relevant sources.

**Market Pulse note:** NSE has no official public API — we use its unofficial JSON endpoints. The homepage returns a 403 challenge but still sets the session cookie the `/api/*` routes need (see the extensive doc comment in `lib/marketMoves/nse.ts`). Top Movers are served from a DB snapshot written by a cron (not fetched live on request), and enriched with full company names from NSE's published equity master CSV.

---

## Data & database

- **Postgres via Prisma.** Production DB is **Neon**. Prod uses `prisma db push` (schema-sync, no migration history); locally you can use `prisma:migrate`.
- **Use the Neon _direct_ (non-pooler) endpoint** for `DATABASE_URL` in production — the pooler breaks Prisma interactive transactions (P2028).
- The Prisma schema lives in `apps/api/prisma/schema.prisma` and is owned by `apps/api`.
- After any schema change: `npm run prisma:generate` **and** restart the dev server. TS-clean ≠ runtime healthy.

```bash
npm run prisma:generate   # regenerate client
npm run prisma:push       # sync schema to DATABASE_URL
npm run prisma:migrate    # local migration history
npm run prisma:seed       # seed data
```

---

## Production & deployment

Production is **not** Vercel for the API — it runs as a Docker container on an **AWS EC2** host:

- The API is a Next.js standalone build in a container (`pf-api`, port `3001`), fronted by a public HTTPS host.
- **Deploy = cross-build for amd64 → ship the image → replace the container:**
  ```bash
  docker build --platform linux/amd64 -f apps/api/Dockerfile -t predict-future-api:local .
  docker save predict-future-api:local | gzip | ssh <ec2> 'gunzip | docker load'
  # on EC2: rm the old container and `docker run` the new one (NOT `restart`), with --env-file ~/.env.prod
  ```
- **Crons:** `apps/api/vercel.json` defines the cron schedule; on EC2 a **crontab mirrors it** (each entry POSTs a `/api/cron/*` route with the `CRON_SECRET`). Market-hours-gated jobs (movers/news) no-op outside their window.
- **Mobile:** shipped as an Android APK (`gradlew assembleRelease`) with `EXPO_PUBLIC_API_BASE_URL` pointed at the production API host.

Exact hosts, keys, and ops runbooks live in `.claude/agent-memory/` (e.g. `project_ec2_prod_ops.md`) — check there before touching prod.

---

## Auth

- **Mobile:** email/password → JWT signed/verified with `NEXTAUTH_SECRET` (`app/api/auth/mobile/{register,login}`, verified in `lib/auth.ts`). Clients send `Authorization: Bearer <token>`; `getUserIdFromRequest` resolves the user.
- **Web:** Auth.js / NextAuth credentials.
- Keep verification centralized in `apps/api`.

---

## Local development

```bash
npm install                 # install the workspace
npm run prisma:generate     # generate the Prisma client
npm run prisma:push         # sync schema to your local DATABASE_URL
npm run prisma:seed         # seed demo data

npm run dev                 # start the whole workspace, or individually:
npm run dev:api             # api  → http://localhost:3001
npm run dev:web             # web  → http://localhost:3000
npm run dev:mobile          # Expo dev server / Android emulator

npm run ingest:news         # one-shot news ingestion
npm run typecheck           # workspace typecheck
npm run lint
```

### Environment

Copy `.env.example` to `.env` and set at least:

```bash
DATABASE_URL="postgresql://..."        # Neon direct endpoint in prod
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="replace-me"           # also signs mobile JWTs
CRON_SECRET="replace-me"               # gates /api/cron/* routes
NEXT_PUBLIC_API_BASE_URL="http://localhost:3001"
EXPO_PUBLIC_API_BASE_URL="http://localhost:3001"
```

LLM keys (Groq, Gemini) and optional news-source keys are also read from env; missing keys degrade gracefully (e.g. Groq → Gemini fallback).

### Demo accounts (from `apps/api/prisma/seed.ts`)

- admin: `admin@predictfuture.local` / `Admin12345!`
- seeded users (`kira@ / dev@ / maya@ example.com`), password `Password123!`

---

## Working conventions

- **Never let the mobile/web client own market or wallet logic** — it lives in `apps/api` / `packages/business-rules`.
- **Serialize schema writes** — never run parallel changes that touch `prisma/schema.prisma`; last writer wins.
- **Verify before claiming done** — typecheck is necessary but not sufficient; exercise the real flow (there's a `verify` skill and live-endpoint QA patterns used throughout).
- When fixing a user-facing surface, fix the **whole feature path** (list + detail + card + share), not just the one screen named.
- Product/feature scoping is routed through the CEO→CTO→QA agent pipeline; ops context and past decisions are recorded in `.claude/agent-memory/`.
```
