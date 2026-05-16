---
name: Per-call resolution windows for expert opinion auto-resolution
description: Schema fields, refactored AI pipeline, preprocess script, and updated cron for per-opinion resolution timing
type: project
---

ExpertOpinion now has two new fields (added via db push, not migrate dev — shadow DB has enum issue):
- `resolutionWindowDays Int?` — days from publishedAt, populated by AI Pass 1
- `resolutionEligibleAt DateTime?` — publishedAt + windowDays, used by daily cron query
- Index: `@@index([resolutionStatus, resolutionEligibleAt])` on ExpertOpinion

**Why:** Fixed global 30-day window gave wrong verdicts — short-term calls got checked too late, long-term calls (90d, 180d) resolved before maturing.

**How to apply:**
- Always use `resolutionEligibleAt: { lte: new Date() }` not `publishedAt: { lt: cutoff }` in resolution queries
- Multi-year calls (impliedWindowDays > 365) are immediately NOT_GRADED by evaluateOpinionResolution — never reach the resolve phase
- `migrate dev` is broken due to MarketCategory enum missing in shadow DB — always use `db push` for schema changes in this project
- Preprocess must run before resolution; preprocess populates windows, resolution checks them
- Both Groq and Gemini share a rate limit that gets exhausted quickly on large batches — use DELAY_MS >= 400 for preprocess, 600 for resolution. If both 429, wait and re-run.

**Files changed:**
- `apps/api/prisma/schema.prisma` — two new ExpertOpinion fields + index
- `apps/api/lib/ai/evaluateOpinionResolution.ts` — exports `parseOpinionTimeframe()` (Pass 1 only); `evaluateOpinionResolution()` now accepts `resolutionWindowDays?` param and returns `resolutionWindowDays` in result; long-term guard (>365d) added
- `apps/api/scripts/preprocess-resolution-windows.ts` — new script, LIMIT=200 DELAY_MS=400
- `apps/api/scripts/auto-resolve-opinions.ts` — rewritten to query `resolutionEligibleAt lte now` instead of fixed window
- `apps/api/app/api/cron/auto-resolve-opinions/route.ts` — rewritten as two-phase: Phase 1 preprocess (CRON_PREPROCESS_LIMIT), Phase 2 resolve (CRON_RESOLVE_LIMIT)

**impliedWindowDays AI rules:** 7=week, 21=short-term, 30=default/1mo, 60=price target no timeframe, 90=quarter, 180=6mo/H2, 365=1yr/FY27, 730=2027/multi-year (→ NOT_GRADED immediately)
