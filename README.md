# Predict Future Monorepo

News-first, virtual-points prediction platform refactored into a shared-codebase multi-platform architecture.

This repo now separates:

- `apps/web`: the Next.js web product
- `apps/api`: the central backend/API and Prisma boundary
- `apps/mobile`: the Expo React Native app for Android now, iOS later
- `packages/*`: shared TypeScript logic, types, validation, API client, and design tokens

The product remains play-money only:

- no deposits
- no withdrawals
- no cash conversion
- virtual points only

## Why this architecture

This product has non-trivial server-controlled logic:

- RSS news ingestion
- market creation and moderation
- host trust scoring
- commission and bond-backed hosting
- resolution and challenge windows
- payouts, timeouts, and refunds
- group/private market access

Because of that, the backend must remain authoritative. Web and mobile consume APIs; they do not own business rules.

## Why Neon Postgres

Neon is the recommended production database target because it keeps the stack simple:

- standard PostgreSQL semantics for Prisma
- strong relational querying and indexing
- easy scaling for feeds, markets, groups, and analytics
- clean fit for server-side jobs and moderation workflows

Locally you can still use any PostgreSQL instance. In production, point `DATABASE_URL` at Neon.

## Monorepo structure

```text
apps/
  web/                  Next.js web app
  api/                  Next.js API/backend app with Prisma
  mobile/               Expo React Native app

packages/
  api-client/           typed fetch client used by web/mobile
  auth-shared/          token/header helpers for cross-platform auth
  business-rules/       pure host trust, policy, ranking, and probability logic
  config/               shared product constants
  types/                shared DTOs and API shapes
  ui-tokens/            shared colors, spacing, typography, shadows
  utils/                formatting and generic helpers
  validation/           shared Zod schemas
```

## Current migration status

This is an incremental refactor, not a rewrite.

What is already moved:

- `apps/web` contains the current Next.js site
- `apps/api` contains copied API routes, Prisma schema/seed, ingestion, and server logic
- `apps/mobile` contains the first Expo scaffold with:
  - full-screen vertical feed
  - public markets list
  - market detail shell
  - create/groups/profile scaffolds
- shared packages now own the pure logic that should not diverge:
  - host trust
  - market policy helpers
  - ranking/probability helpers
  - shared validation
  - shared API client
  - shared design tokens

What remains for later passes:

- move more server-only logic out of `apps/web` and fully converge on `apps/api`
- unify auth across web/mobile more deeply
- expand mobile create/participation flows
- move more DTO shaping into `packages/types`

## App responsibilities

### `apps/web`

Keeps the stronger desktop/browser surfaces:

- landing page
- swipeable news feed
- market detail
- advanced create flow
- groups
- profile
- admin/moderation/resolution tools

### `apps/api`

Primary backend boundary:

- Prisma access
- news ingestion orchestration
- public/mobile-ready read endpoints
- host trust and eligibility
- ranking and resolution services
- cron endpoints for lifecycle and ingestion
- shared database seed scripts

### `apps/mobile`

Android-first Expo app:

- full-screen vertical news feed
- public market discovery
- market detail shell
- profile trust display
- route structure for create/groups/deep links

The mobile app is native, not a wrapped website.

## Shared packages

### `@predict-future/business-rules`

Use this for pure reusable logic only:

- host trust scoring
- public host eligibility thresholds
- market participation/access helpers
- ranking helpers
- probability helpers
- numeric-market math

Do not put Prisma or notification side effects here.

### `@predict-future/validation`

Shared Zod schemas for:

- market creation
- group creation/join
- auth payloads
- story/news payloads

### `@predict-future/api-client`

Typed fetch wrapper used by mobile now and ready for gradual web adoption.

Currently wraps:

- `/api/news`
- `/api/news/debug`
- `/api/markets/public`
- `/api/markets/:id`
- `/api/hosts/eligibility`
- `/api/users/:id/host-stats`
- `/api/groups/:id`
- `/api/markets/create`

### `@predict-future/ui-tokens`

Cross-platform design primitives:

- colors
- spacing
- radii
- shadows
- typography scales

These are safe to share between DOM and React Native. UI components are not shared.

## Auth strategy

Current state:

- the web app already uses Auth.js / NextAuth credentials
- `apps/api` is structured to stay compatible with that model
- `packages/auth-shared` now provides the shared request-header layer for future token forwarding

Recommended production direction:

- move to Clerk or a more unified token strategy when mobile auth goes live
- keep backend verification centralized in `apps/api`

For this pass, the architecture is ready for that move without forcing a risky auth rewrite today.

## Environment

Copy the root env file:

```bash
cp .env.example .env
```

Important variables:

```bash
DATABASE_URL="postgresql://..."
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="replace-me"
CRON_SECRET="replace-me"
NEXT_PUBLIC_API_BASE_URL="http://localhost:3001"
EXPO_PUBLIC_API_BASE_URL="http://localhost:3001"
EXPO_PUBLIC_DEMO_USER_ID=""
```

RSS/news variables remain supported, including optional GNews / NewsAPI fallback keys.

## Local development

### 1. Install workspace dependencies

```bash
npm install
```

### 2. Generate Prisma client and push schema from the API workspace

```bash
npm run prisma:generate
npm run prisma:push
```

### 3. Seed data

```bash
npm run prisma:seed
```

### 4. Start apps

Web:

```bash
npm run dev:web
```

API:

```bash
npm run dev:api
```

Mobile:

```bash
npm run dev:mobile
```

Or start the full workspace:

```bash
npm run dev
```

Expected local URLs:

- web: `http://localhost:3000`
- api: `http://localhost:3001`
- mobile: Expo dev server / Android emulator

## Prisma and database workflow

Prisma is now owned by `apps/api`.

Commands:

```bash
npm run prisma:generate
npm run prisma:push
npm run prisma:migrate
npm run prisma:seed
```

The web app still contains legacy Prisma references during the transition, but the intended database owner is now `apps/api`.

## News ingestion

Run a one-shot ingestion:

```bash
npm run ingest:news
```

The ingestion job is RSS-first and writes normalized short-form stories to the database. Web and mobile then consume the cleaned API output.

## Mobile notes

The first Expo scaffold already includes:

- full-screen vertical feed cards
- infinite/paged feed loading via shared API client
- public markets screen
- market detail route
- groups/create/profile navigation structure

This is enough to begin Android iteration without coupling mobile to the database or web rendering.

For iOS later:

- keep using Expo Router
- keep API calls inside `packages/api-client`
- keep business rules in shared packages or `apps/api`
- avoid moving market logic into the mobile client

## Host trust and market logic

The shared architecture supports the current product model:

- public/private markets
- commission-based and bond-based host models
- challenge windows
- host timeouts
- public trusted-host eligibility
- host trust score formula
- feed ranking

Put pure logic in `packages/business-rules`.
Put side effects, Prisma access, and admin actions in `apps/api`.

## Demo accounts

Seeded defaults:

- admin: `admin@predictfuture.local` / `Admin12345!`
- users: `kira@example.com`, `dev@example.com`, `maya@example.com`
- seeded user password: `Password123!`

## Extending the monorepo

When adding new shared logic:

1. decide if it is pure or server-bound
2. put pure logic in `packages/business-rules` or `packages/utils`
3. put DTOs in `packages/types`
4. put input schemas in `packages/validation`
5. keep Prisma/database access in `apps/api`
6. consume the endpoint from web/mobile through `packages/api-client`

That keeps business rules single-sourced and avoids drift between platforms.
