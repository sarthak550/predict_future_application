---
name: project_sprint42_t0
description: S42-T0: Upstash Redis provisioning — lib/redis.ts, redis-smoke endpoint, health check, env vars
metadata:
  type: project
---

S42-T0 (CRITICAL): Upstash Redis infrastructure layer implemented and in qa-review.

**Why:** S42-T7 (distributed rate-limit) and S42-T11 (push-token bucket) both require durable key-value store across Vercel cold starts. In-memory Maps are wiped per instance.

**Files created:**
- `apps/api/lib/redis.ts` — exports `redis = Redis.fromEnv()`, warns in dev if env vars absent, throws in production if missing
- `apps/api/app/api/admin/redis-smoke/route.ts` — CRON_SECRET-gated, INCRs `smoke:counter` each call; verifies cross-cold-start durability
- `apps/api/app/api/health/route.ts` — updated: lazy-imports redis, does set+get round-trip; returns `redis: "ok"` | `"skipped"` | `"error"` with 503 on error

**Env vars added to both `.env.example` files:**
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

**Schema fix bundled:** `GRANT_VERIFIED_ANALYST` and `REVOKE_VERIFIED_ANALYST` added to `AdminActionType` enum (required by migration `s42_admin_action_types` which was already present but not reflected in schema.prisma).

**Runtime verification needed (follow-up for user):**
1. Create free Upstash database at https://console.upstash.com
2. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to local `.env` and Vercel project env vars
3. `curl http://localhost:3001/api/health` → expect `{"ok":true,"redis":"ok",...}`
4. `curl "http://localhost:3001/api/admin/redis-smoke?secret=<CRON_SECRET>"` → expect `{"ok":true,"counter":1}`

**Pre-existing typecheck failures:** 30+ errors in other files (notifiedAt, preprocessAttempts, analystCallAt, etc.) are schema fields from other parallel S42 bundles not yet generated. My files are error-free.

**How to apply:** When T7 or T11 need Redis, import `redis` from `@/lib/redis`. Client is already configured.
