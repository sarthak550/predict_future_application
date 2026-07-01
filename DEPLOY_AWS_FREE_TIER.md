# Deploy the mobile backend (`apps/api`) to AWS — **FREE TIER (EC2)**

Goal: run the Predict Future backend for **~$0/month for 12 months** on the AWS free tier, so you can launch the **mobile app** on a zero budget. More control than a PaaS, at the cost of running the box yourself.

**Scope for launch:** only **`apps/api`** deploys (it's the backend the mobile app hits). **`apps/web` is NOT launched yet** — leave it parked. Because only `apps/api` runs, there's no cron duplication to worry about.

**What stays external (all on their own free tiers — nothing to migrate):** Neon (Postgres), Upstash (Redis), Vercel Blob (image uploads), Groq/Gemini (AI). This box only runs the API container + fires the crons.

```
Mobile app ──HTTPS──▶ Caddy (auto-TLS) ──▶ Docker: apps/api :3001 ──▶ Neon · Upstash · Blob · Groq/Gemini
                          (on one free t3.micro EC2 box; its crontab fires the 14 cron routes)
```

Repo already has what makes this work: `apps/api/Dockerfile` (monorepo multi-stage, `output: standalone`), `apps/api/prisma/schema.prisma` (`binaryTargets` for the Debian engine), `.dockerignore`.

---

## 💸 Honest cost
| Item | Cost |
|---|---|
| EC2 `t3.micro` (750 hrs/mo = 24/7) | **$0 for 12 months**, then ~$8–12/mo |
| 30 GB gp3 storage | free-tier included |
| Data transfer out | 100 GB/mo free — trivial at launch |
| Neon / Upstash / Vercel Blob / Groq / Gemini | free tiers, $0 at low scale |
| **Domain** (needed for HTTPS — mobile requires it) | ~$1–12 / **year** (one-time-ish), or a free DuckDNS subdomain |

⚠️ **Free-tier surprise bills are the #1 AWS complaint.** Step 1 sets a billing guard — do NOT skip it.
⚠️ **12-month cliff:** after a year the box costs ~$8–12/mo. Want $0 *forever* instead? Do this exact runbook on an **Oracle Cloud always-free ARM VM** (beefier specs, no cliff; the only catch is Oracle's finicky signup).

---

## 0. Prerequisites
- AWS account + AWS CLI (`aws configure`), Docker Desktop running locally.
- A domain you control (e.g. `api.yourdomain.com`) — or a free `*.duckdns.org` subdomain.
- Your prod env values (copy from the current Vercel project's Environment Variables).

```bash
export AWS_REGION=ap-south-1     # Mumbai — closest to India users
```

---

## 1. FIRST: set a billing guard (before launching anything)
Console → **Billing → Budgets → Create budget → "Zero spend budget"** (or a $1 cap) → email alert. Also **Billing → Preferences → enable Free Tier usage alerts.**

```bash
# CLI equivalent (zero-spend budget):
aws budgets create-budget --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --budget '{"BudgetName":"free-tier-guard","BudgetLimit":{"Amount":"1","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":1},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"you@example.com"}]}]'
```

---

## 2. Launch a free-tier EC2 instance (Console is easiest)
EC2 → **Launch instance**:
- **Region:** ap-south-1. **AMI:** Ubuntu 22.04 LTS. **Type:** `t3.micro` (or `t2.micro` — whichever shows *"Free tier eligible"*).
- **Key pair:** create + download `your-key.pem` (for SSH).
- **Storage:** 30 GB gp3 (free-tier max).
- **Security group** (inbound):
  - SSH `22` — source **My IP** only.
  - HTTP `80` — anywhere (Caddy needs it to fetch the TLS cert).
  - HTTPS `443` — anywhere.
- Launch. Note the **public IP**. (Optional: allocate an **Elastic IP** and attach it so the IP is stable — free *while attached to a running instance*.)

---

## 3. DNS
Add an **A record**: `api.yourdomain.com → <EC2 public IP>`. (Or set up DuckDNS.)

---

## 4. Prepare the box
```bash
ssh -i your-key.pem ubuntu@<EC2_IP>

# Docker
sudo apt-get update && sudo apt-get install -y docker.io
sudo usermod -aG docker ubuntu    # then log out/in once

# 2 GB swap — t3.micro has only 1 GB RAM; this prevents the container from OOMing
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Caddy (auto-HTTPS reverse proxy) — official apt repo
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Unattended security updates (keep the box patched)
sudo apt-get install -y unattended-upgrades
```

---

## 5. Build the image locally, ship it to the box
Build on your **Mac** (amd64) — a t3.micro can OOM on a Next.js build. No registry needed (`save | ssh | load`):

```bash
# From the MONOREPO ROOT:
docker build --platform linux/amd64 -f apps/api/Dockerfile -t predict-future-api:latest .

# Ship it straight to the box (no ECR/Docker Hub required):
docker save predict-future-api:latest | gzip | ssh -i your-key.pem ubuntu@<EC2_IP> 'gunzip | docker load'
```
*(Alternatives: ECR free tier = 500 MB/12 mo, or a free Docker Hub repo.)*

---

## 6. Env file on the box
Create `~/.env.prod` on the EC2 box — same keys/values as the current Vercel project:
```
DATABASE_URL=<Neon POOLED prod url — host has "-pooler", ...?sslmode=require>
NEXTAUTH_SECRET=<same secret as before>
NEXTAUTH_URL=https://api.yourdomain.com
CRON_SECRET=<your secret>
GROQ_API_KEY=...
GEMINI_API_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
BLOB_READ_WRITE_TOKEN=...
# MSG91_* NOT needed for launch — phone verify is off (email+password login).
```
> Use Neon's **pooled** URL (host contains `-pooler`) — it prevents connection exhaustion.

---

## 7. Run the container
```bash
docker run -d --name pf-api --restart always \
  -p 127.0.0.1:3001:3001 --env-file ~/.env.prod predict-future-api:latest

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health   # expect 200
```

---

## 8. HTTPS via Caddy
`/etc/caddy/Caddyfile`:
```
api.yourdomain.com {
    reverse_proxy 127.0.0.1:3001
}
```
```bash
sudo systemctl reload caddy
curl -s -o /dev/null -w "%{http_code}\n" https://api.yourdomain.com/api/health   # expect 200 (Caddy auto-fetches a Let's Encrypt cert)
```

---

## 9. Apply DB migrations to prod Neon, then run the one-time tier recalc
From your machine (the Vercel build did `prisma generate`, but never applied migrations):
```bash
cd apps/api
DATABASE_URL="<Neon prod url>" npx prisma migrate deploy

# S67 one-time recalc so stored Analyst tiers reflect the new net-PnL gate:
curl -X POST "https://api.yourdomain.com/api/admin/users/recalc-tiers?secret=YOUR_CRON_SECRET"
```

---

## 10. Crons — fire them from the box's own crontab (replaces Vercel Cron)
Only `apps/api` is deployed, so these 14 routes need a scheduler. Cheapest/simplest: the box's `crontab` curls each route with the `CRON_SECRET`. `crontab -e` (times are UTC):

```cron
CRON=Authorization:\ Bearer\ YOUR_CRON_SECRET
BASE=https://api.yourdomain.com/api/cron
*/30 * * * *  curl -s -H "$CRON" $BASE/news-ingestion            >/dev/null
*/15 * * * *  curl -s -H "$CRON" $BASE/market-lifecycle          >/dev/null
0 * * * *     curl -s -H "$CRON" $BASE/auto-resolve-opinions     >/dev/null
0 */2 * * *   curl -s -H "$CRON" $BASE/retry-stuck-opinions      >/dev/null
0 */6 * * *   curl -s -H "$CRON" $BASE/finance-opinions-catchup  >/dev/null
0 * * * *     curl -s -H "$CRON" $BASE/probability-snapshot      >/dev/null
0 * * * *     curl -s -H "$CRON" $BASE/retire-expired-flagships  >/dev/null
30 3 * * *    curl -s -H "$CRON" $BASE/big-call-push             >/dev/null
15 9 * * *    curl -s -H "$CRON" $BASE/flagship-reminder         >/dev/null
30 3 * * *    curl -s -H "$CRON" $BASE/award-reasoning-badges    >/dev/null
0 2 * * *     curl -s -H "$CRON" $BASE/recalculate-analyst-tiers >/dev/null
0 18 * * 0    curl -s -H "$CRON" $BASE/leaderboard-snapshot      >/dev/null
30 3 * * 0    curl -s -H "$CRON" $BASE/weekly-calls-digest       >/dev/null
0 4 * * *     curl -s -H "$CRON" $BASE/sync-manifold-resolutions >/dev/null
```
*(Cadences mirror the old Vercel schedule — tune to taste.)*

---

## 11. Point the mobile app at the backend
`apps/mobile/.env.prod`:
```
EXPO_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```
Then build/submit via EAS. (For a quick device test first, set the same var in `.env`/`.env.local` and reload Expo.)

---

## 12. Auth for launch
Login is **email + password** — no phone step. The phone-verify prompt is hidden via `SHOW_PHONE_VERIFY=false` (`apps/mobile/src/lib/feature-flags.ts`). No MSG91/DLT needed. Flip the flag back on once DLT clears.

---

## 13. Redeploys (after the first time)
```bash
# local:
docker build --platform linux/amd64 -f apps/api/Dockerfile -t predict-future-api:latest .
docker save predict-future-api:latest | gzip | ssh -i your-key.pem ubuntu@<EC2_IP> 'gunzip | docker load'
# on the box:
docker stop pf-api && docker rm pf-api && \
docker run -d --name pf-api --restart always -p 127.0.0.1:3001:3001 --env-file ~/.env.prod predict-future-api:latest
```

---

## 14. Month-11 reminder
Set a calendar reminder ~11 months out: the free tier ends → the box becomes ~$8–12/mo. By then you'll know if you have traction (upgrade the instance) or want to move (Oracle free-forever, or back to Vercel Pro). Nothing here locks you in — standard Docker + Neon + Upstash.
