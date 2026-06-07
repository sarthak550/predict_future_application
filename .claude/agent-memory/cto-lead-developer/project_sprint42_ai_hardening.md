---
name: project_sprint42_ai_hardening
description: S42-T4 prompt injection hardening + S42-T10 shared callGeminiAI helper — both qa-review
metadata:
  type: project
---

S42-T4 and S42-T10 implemented and in qa-review.

**T4 — Prompt injection hardening (3 remaining AI call sites):**
- `lib/ai/extractInstrument.ts`: added `INSTRUMENT_INJECTION_SENTINELS` (`</quote>`, `</headline>`), updated system prompt with untrusted-data warning, wrapped `quote`+`headline` in `<quote>`/`<headline>` delimiter tags in user message, added sentinel check before returning result.
- `lib/ai/generateHeadline.ts`: added `HEADLINE_INJECTION_SENTINELS` (`</quote>`, `</expert_name>`), updated system prompt, wrapped quote in `<quote>` and expertName in `<expert_name>` in `buildHeadlinePrompt()`, added sentinel check on both primary and fallback paths.
- `lib/ai/evaluateOpinionResolution.ts`: moved `headline` from bare interpolation into `<article_context>` delimiter tags in both Pass 1 user messages (`parseOpinionTimeframe` export + main `evaluateOpinionResolution`). Added `</article_context>` to `RESOLUTION_INJECTION_SENTINELS`. Updated both system prompts. Added Pass 1 sentinel check in main function. Added Pass 3 verdict sentinel check.

**T10 — Shared callGeminiAI helper:**
- `lib/ai/gemini.ts`: added exported `callGeminiAI<T>(systemPrompt, userPrompt, opts)` helper with: env-pinned `GEMINI_PRIMARY_MODEL` / `GEMINI_FALLBACK_MODEL_ENV`, 404 retry to fallback, 1-hour in-memory `_primary404Until` cooldown flag (skips primary on subsequent calls during the window, resets on first successful primary call).
- `lib/ai/evaluateOpinionResolution.ts`: `callGemini()` now delegates to `callGeminiAI` (no hardcoded model). Import added.
- `lib/ai/extractExpertOpinions.ts`: `callGeminiForExtraction()` now delegates to `callGeminiAI` (no hardcoded model). Import added.
- `apps/api/.env.example`: documented `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL`.

**Pre-existing TS errors (NOT from this sprint):**
- `scripts/cleanup-invalid-tickers.ts` imports `normalizeYahooTicker` from `extractInstrument` — was never exported in the committed codebase; pre-existing out-of-scope breakage.
- Various `notifiedAt`, `lockedAt`, `analystCallAt`, etc. schema/Prisma-client mismatches in cron routes and lib files — pre-existing schema drift.

**Why:** Closes injection surface left open after S39-T3, and de-duplicates Gemini retry logic so future AI files inherit env-pinning automatically.
