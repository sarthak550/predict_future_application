# Deploying the API to AWS App Runner

> **Launching on a zero budget?** This App Runner path costs ~$5–25/mo (no free tier).
> For a **$0-for-12-months** launch on the AWS free tier (EC2 `t3.micro`), use
> **[`DEPLOY_AWS_FREE_TIER.md`](./DEPLOY_AWS_FREE_TIER.md)** instead. App Runner is the
> easier, paid option to graduate to once you can afford it.

Always-on, autoscaling, managed-HTTPS hosting for `apps/api` (Next.js 14). Your data
layer (Neon Postgres, Upstash Redis, Vercel Blob, Groq/Gemini, MSG91) is already
external and stays put — App Runner just runs the server and connects to it via env vars.

Files that make this work (already in the repo):
- `apps/api/Dockerfile` — monorepo-aware multi-stage build (build context = repo root)
- `apps/api/next.config.mjs` — `output: "standalone"` + `outputFileTracingRoot`
- `apps/api/prisma/schema.prisma` — `binaryTargets` includes the Debian container engine
- `.dockerignore` — keeps the image small and secret-free

---

## 0. Prerequisites
- AWS account + AWS CLI configured (`aws configure`)
- Docker Desktop running
- Your existing prod secret values (mirror them from your old Vercel project / `.env.prod`)

```bash
export AWS_REGION=ap-south-1          # Mumbai — closest to your India users
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=predict-future-api
```

---

## 1. Test the build locally first (catch problems before AWS)

```bash
# From the MONOREPO ROOT (not apps/api):
docker build --platform linux/amd64 -f apps/api/Dockerfile -t predict-future-api:local .

# Smoke-test it with your prod env file:
docker run --rm -p 3001:3001 --env-file apps/api/.env.prod predict-future-api:local
# In another terminal:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health   # expect 200
```

> **Critical:** `--platform linux/amd64`. You're on an Apple-silicon Mac (arm64); App
> Runner runs amd64. Build the wrong arch and the image won't start on AWS.

---

## 2. Push the image to ECR

```bash
aws ecr create-repository --repository-name $ECR_REPO --region $AWS_REGION || true

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker tag predict-future-api:local \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
```

---

## 3. Create the App Runner service (Console — easiest)

App Runner → **Create service**:
1. **Source**: Container registry → Amazon ECR → pick `predict-future-api:latest`.
2. **Deployment**: Manual (or Automatic to redeploy on every `:latest` push).
   - Let it auto-create the **ECR access role** when prompted.
3. **Service settings**:
   - **Port**: `3001` (matches the Dockerfile).
   - **CPU/Memory**: 0.25 vCPU / 0.5 GB is fine to start.
   - **Health check**: HTTP, path `/api/health`.
   - **Environment variables**: add the ones in §4.
4. Create. You'll get a URL like `https://xxxx.ap-south-1.awsapprunner.com`.

---

## 4. Environment variables

**Required for the server to run** (set `NEXTAUTH_URL` to your new App Runner URL):

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** prod URL — `...-pooler.../neondb?sslmode=require` |
| `NEXTAUTH_SECRET` | (same secret you used on Vercel — asserted at boot) |
| `NEXTAUTH_URL` | `https://<your-app-runner-url>` |
| `CRON_SECRET` | (used by the EventBridge schedules in §5) |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | AI extraction |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limiting (fails open if absent) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob cover-image uploads |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | phone OTP |

**Optional (set only if you use the feature):** `GNEWS_API_KEY`, `NEWSAPI_API_KEY`,
`FINANCE_AI_DAILY_CAP`, `GEMINI_MODEL`. `NODE_ENV=production` is already baked into the image.

> Fastest path: open your old Vercel project's Environment Variables, and copy each
> value into App Runner. They're the same keys.

> **Neon for an always-on container:** use the **pooled** connection string (host has
> `-pooler`). App Runner can run multiple instances; the pooler prevents connection
> exhaustion.

---

## 5. Recreate the cron jobs (EventBridge Scheduler) — don't skip this

Vercel Cron was firing these 14 routes. On AWS nothing fires them until you recreate
them, so scheduled work (auto-resolving opinions, digests, reminders, news ingestion)
silently stops.

**One-time setup** — an EventBridge **Connection** that holds the auth header:
```bash
aws events create-connection \
  --name predict-future-cron \
  --authorization-type API_KEY \
  --auth-parameters '{"ApiKeyAuthParameters":{"ApiKeyName":"Authorization","ApiKeyValue":"Bearer YOUR_CRON_SECRET"}}' \
  --region $AWS_REGION
```

Then, for **each** route below, create an EventBridge Scheduler schedule whose target is
an HTTP API destination `https://<app-runner-url>/api/cron/<name>` (method GET, using the
connection above). Easiest in the **EventBridge Scheduler console**: Create schedule →
recurring (cron expression) → target "EventBridge API destination" → reuse the connection.

| Route | Suggested schedule (UTC — tune to taste) |
|---|---|
| `/api/cron/news-ingestion` | every 30 min |
| `/api/cron/auto-resolve-opinions` | hourly |
| `/api/cron/retry-stuck-opinions` | every 2 h |
| `/api/cron/finance-opinions-catchup` | every 6 h |
| `/api/cron/probability-snapshot` | hourly |
| `/api/cron/market-lifecycle` | every 15 min |
| `/api/cron/big-call-push` | daily 03:30 (09:00 IST) |
| `/api/cron/flagship-reminder` | daily |
| `/api/cron/retire-expired-flagships` | hourly |
| `/api/cron/award-reasoning-badges` | daily |
| `/api/cron/recalculate-analyst-tiers` | daily |
| `/api/cron/leaderboard-snapshot` | daily |
| `/api/cron/weekly-calls-digest` | weekly (Sun) |
| `/api/cron/sync-manifold-resolutions` | every 6 h |

(These are sensible defaults — match whatever cadence you ran on Vercel if it differed.)

---

## 6. Point the mobile app at the new backend

`apps/mobile/.env.prod`:
```
EXPO_PUBLIC_API_BASE_URL=https://<your-app-runner-url>
```
Then rebuild the prod app (EAS). For a quick device test against AWS without a full
build, temporarily set the same var in `.env`/`.env.local` and reload Expo.

---

## 7. Redeploys (after the first time)

```bash
docker build --platform linux/amd64 -f apps/api/Dockerfile -t predict-future-api:local .
docker tag predict-future-api:local $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
# If you chose Manual deployment, click "Deploy" in App Runner (or `aws apprunner start-deployment`).
```

---

## Cost & notes
- App Runner ≈ $5–25/mo at low traffic (it stays warm — no cold starts, good for Prisma).
- Custom domain: App Runner → Custom domains → add `api.yourdomain.com` (managed cert).
- DB migrations still run from your machine against prod (`npm run prisma:push:prod`) —
  App Runner only runs the app, it doesn't migrate.
