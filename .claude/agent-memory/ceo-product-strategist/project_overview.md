---
name: Predict Future — Product Overview
description: Core product description, stack, business model direction, and key architectural decisions for Predict Future
type: project
---

Predict Future is a news-first, virtual-points prediction market platform (play-money only). Users create markets tied to news stories; "hosts" earn commission or bond-based rewards. Mobile-first (Expo Android), with a web app and central Next.js API.

**Why:** Building toward a real-money prediction market eventually, but explicitly play-money first to build audience and compliance buffer.

**How to apply:** All feature recommendations should optimize for engagement and retention in a zero-cash context. Monetization must not depend on cash transactions in near term.

## Stack
- Turborepo monorepo: apps/web (Next.js), apps/api (Next.js + Prisma/Neon), apps/mobile (Expo RN Android-first)
- Shared packages: types, validation (Zod), business-rules, api-client, ui-tokens, auth-shared
- Auth: NextAuth (web) + separate JWT endpoints (mobile); Clerk migration recommended when mobile goes live
- AI: Groq (free tier, rate-limited 15s between calls) with Gemini as fallback for poll generation
- DB: Neon Postgres via Prisma

## Key Architectural Observations
- Demo user ID passed as env var in mobile (EXPO_PUBLIC_DEMO_USER_ID) — real auth not fully wired on mobile yet
- Dual validation layer: shared Zod packages AND per-app local validation in apps/api/lib/validations/ (redundant, technical debt)
- Web app duplicates some lib files from API (prisma.ts, notifications.ts, stats.ts, auth.ts) — suggests web may have been a separate app before monorepo consolidation
- RSS ingestion with AI poll generation runs at 15s/story rate limit (Groq free tier ceiling)

## Business Model (current)
- Zero monetization — virtual points only
- No deposits, no withdrawals, no cash
- Gamification via badges, leaderboard, host trust scores
- Architecture leaves room for real-money markets later

## Key Dates
- First commit: early in project history
- Most recent refinement commit (25251e6): news ingestion and Sports section
- Strategic review conducted: 2026-05-01
