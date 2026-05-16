---
name: Expert Opinion Auto-Resolution System
description: AI-powered two-pass resolution for ExpertOpinion records — replaces keyword-map + mechanical threshold with semantic AI evaluation
type: project
---

Auto-resolution pipeline fully rewritten (2026-05-13) to fix systematic misresolution bugs.

**Root cause of bad resolutions (old system):**
- Keyword-map `extractInstrumentFromQuote` matched "crude" in one expert's quote and stamped Crude Oil on ALL opinions from that batch — cross-opinion ticker contamination.
- Mechanical `resolveFromPriceMove` applied the same 2% threshold to sector commentary, mutual fund flow quotes, and psychology-of-investors quotes that had no verifiable price claim.
- `HIT_THRESHOLD` env var was blunt: any 2%+ move = HIT/MISS regardless of stated horizon.

**New architecture:**

`apps/api/lib/ai/evaluateOpinionResolution.ts` — core evaluation function:
- `evaluateOpinionResolution(opinion)` → `OpinionResolutionResult | null`
- Pass 1 (Groq → Gemini fallback): parse quote → instrument, ticker, isResolvable, specificClaim, impliedWindowDays
- Pass 2: `getPriceWindow(ticker, publishedAt, impliedWindowDays)` from priceHistory.ts
- Pass 3 (Groq → Gemini fallback): render HIT/MISS/NOT_GRADED verdict given price data and specific claim
- Returns null on unrecoverable error — caller skips, opinion stays PENDING

`apps/api/scripts/auto-resolve-opinions.ts` — script rewritten:
- Removed: `extractInstrumentFromQuote`, direct `getPriceWindow`, `HIT_THRESHOLD`, `resolveFromPriceMove`
- Persists `instrument` + `instrumentTicker` from AI result in same update as resolution
- Env vars: `DRY_RUN`, `RESOLUTION_WINDOW`, `LIMIT`, `DELAY_MS` (default 600ms; use 3000+ for batch runs)
- Script is idempotent: skipped opinions stay PENDING for next run

**Correctness improvements verified in first rerun:**
- Eternal Limited → ETERNAL.NS (not Crude Oil)
- Mutual fund flow / SIP / investor psychology quotes → NOT_GRADED (not resolvable)
- Broad sector calls without specific stock (pharma, defence, consumer discretionary) → NOT_GRADED (not resolvable)
- Price target calls ("target ₹360") → HIT only if within 5% of target during window
- Gold BEARISH -7.85% → RESOLVED_HIT (correct)

**Second run results (2026-05-13 — after resetting 22 bad records):**
- 9 resolved as NOT_GRADED (correct: vague sector/macro calls)
- 13 still PENDING due to Groq+Gemini rate-limit exhaustion from session overuse — will resolve on next cron run (idempotent)

**Infrastructure unchanged:**
- `apps/api/lib/finance/priceHistory.ts` — `getPriceWindow()` unchanged
- `apps/api/lib/ai/extractInstrument.ts` — still exists but no longer called by the script
- `apps/api/app/api/cron/auto-resolve-opinions/route.ts` — daily cron route unchanged
- `apps/api/scripts/cron-auto-resolve.ts` — thin wrapper unchanged

**Why:** Keyword-map approach broke when multiple opinions from the same article shared a single extracted ticker (batch contamination). Two-pass AI reads the actual semantics of each individual quote.

**How to apply:** Run `DELAY_MS=3000 npx tsx scripts/auto-resolve-opinions.ts` for remaining eligible PENDING opinions. Yahoo Finance still needs `User-Agent` header. Use `db push` not `migrate dev` for schema changes.
