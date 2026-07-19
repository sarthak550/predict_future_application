# syntax=docker/dockerfile:1
#
# Production image for the predict-future WEB app (Next.js 14, standalone output).
# Mirrors apps/api/Dockerfile. BUILD CONTEXT MUST BE THE MONOREPO ROOT:
#   docker build --platform linux/amd64 -f apps/web/Dockerfile \
#     --build-arg DATABASE_URL="$PROD_DB_URL" -t predict-future-web:local .
#
# DATABASE_URL is a build ARG because the public /analysts pages and sitemap are
# ISR/static-generated at build time with live data (same as a Vercel build would).
# It exists only in the discarded builder stage — the runner image ships no secrets;
# real runtime env comes from --env-file on `docker run` (see ~/.env.web on EC2).

# ── deps ────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
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

# ── builder ─────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DATABASE_URL
# Placeholders for modules that assert env at import; real values injected at runtime.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=${DATABASE_URL} \
    NEXTAUTH_SECRET=build-placeholder \
    NEXTAUTH_URL=http://localhost:3000
# apps/web has no prisma-generate hook of its own — it imports the workspace-hoisted
# client generated from apps/api's schema (single shared client for both apps).
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build --workspace @predict-future/web

# ── runner ──────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# HOSTNAME=0.0.0.0 is REQUIRED in a container (default localhost refuses external conns).
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Standalone output mirrors the monorepo layout; server entry = apps/web/server.js.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# Guarantee the Prisma query engine ships even if Next's file tracing missed the .so.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
