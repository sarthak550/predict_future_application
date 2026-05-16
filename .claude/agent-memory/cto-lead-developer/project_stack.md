---
name: Project Stack & Layout
description: Monorepo tech stack, package layout, key architectural constraints for Predict Future
type: project
---

Predict Future is a news-first virtual-points prediction market app targeting Android-first.

## Monorepo structure (npm workspaces + Turborepo)
- `apps/mobile` — Expo React Native, expo-router v6, Android-first
- `apps/api` — Next.js API backend, Prisma ORM, Postgres/Neon
- `packages/api-client` — shared typed fetch client (`createApiClient`)
- `packages/auth-shared` — `buildAuthHeaders`, `AuthTokenProvider` type
- `packages/types` — shared DTOs (ApiMarketSummary, ApiNewsFeedItem, etc.)
- `packages/ui-tokens` — colors, radius, spacing, shadows
- `packages/validation` — zod schemas for market creation
- `packages/business-rules` — market policy logic

## Key constraints
- Token auth is JWT, 30-day expiry, issued by `POST /api/auth/mobile/login` and `/register`
- Mobile uses `expo-secure-store` for token persistence
- The API-client `auth: true` flag triggers `buildAuthHeaders` which calls `getAuthToken` and sets `Authorization: Bearer <token>`
- No Clerk, no OAuth — pure credential auth against `apps/api`

**Why:** CEO chose lightweight, self-hosted auth to avoid vendor lock-in and reduce cost at early stage.

**How to apply:** All new authenticated API endpoints should use the Bearer token pattern. Never pass userId as a query param for auth; rely on the token on the server.
