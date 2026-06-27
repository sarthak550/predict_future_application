# syntax=docker/dockerfile:1
#
# Production image for the predict-future API (Next.js 14, standalone output).
# BUILD CONTEXT MUST BE THE MONOREPO ROOT, not apps/api:
#   docker build -f apps/api/Dockerfile -t predict-future-api .
#
# Why: this is an npm-workspace monorepo. apps/api depends on the @predict-future/*
# packages, so the build needs the whole tree and the root lockfile.

# ── deps: install all workspace deps (cached until a package.json/lockfile change) ──
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy only manifests first so `npm ci` is cached across source-only changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/auth-shared/package.json packages/auth-shared/package.json
COPY packages/business-rules/package.json packages/business-rules/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui-tokens/package.json packages/ui-tokens/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN npm ci

# ── builder: prisma generate (via prebuild hook) + next build (standalone) ──────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time PLACEHOLDERS only. Several modules assert these env vars at import time
# (redis.ts, auth.ts, …) and `next build` imports every route, so the build needs
# non-empty values. These are NON-SECRET and exist ONLY in this builder stage, which is
# discarded — the final runner image ships none of them. REAL values are injected at
# RUNTIME by App Runner (see DEPLOY_AWS.md §4).
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXTAUTH_SECRET=build-placeholder \
    DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    UPSTASH_REDIS_REST_URL=https://placeholder.upstash.io \
    UPSTASH_REDIS_REST_TOKEN=placeholder \
    BLOB_READ_WRITE_TOKEN=vercel_blob_placeholder \
    MSG91_AUTH_KEY=placeholder \
    MSG91_TEMPLATE_ID=placeholder \
    KV_REST_API_URL=https://placeholder.kv.io \
    KV_REST_API_TOKEN=placeholder
# `build` runs the `prebuild` hook first → `prisma generate` (emits the Debian engine
# per schema binaryTargets) → then `next build` (standalone output).
RUN npm run build --workspace @predict-future/api

# ── runner: minimal always-on image ────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The Next standalone server reads PORT + HOSTNAME. HOSTNAME=0.0.0.0 is REQUIRED in a
# container (the default 'localhost' would refuse external/App Runner connections).
ENV HOSTNAME=0.0.0.0
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Standalone output mirrors the monorepo layout under .next/standalone, so the server
# entry lands at apps/api/server.js once copied to the workdir root.
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/static ./apps/api/.next/static
# Belt-and-suspenders: guarantee the Prisma query engine is present even if Next's
# file-tracing missed the .so (a common standalone+Prisma gotcha).
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3001
# App Runner sends traffic to PORT 3001 (set the service's port to 3001 to match).
CMD ["node", "apps/api/server.js"]
