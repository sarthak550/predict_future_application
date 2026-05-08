---
name: Finance Section — Sprint 13–16 Initiative
description: India-first Finance section strategic context, data model decisions, and delivery status. All 4 sprints COMPLETE as of 2026-05-02.
type: project
---

Finance section fully delivered 2026-05-02. All 11 tickets across S14/S15/S16 passed QA (S13 passed earlier in the same session).

**Positioning:** "Indian markets through a global lens." Every story — Indian or global — framed as an Indian-market-impact question. Stories with no India angle are filtered at ingestion.

**Expert sourcing:** AI-extracted paraphrases from real news articles (NOT curated). Approved v1 organizations: HDFC Securities, ICICI Securities, Morgan Stanley India, Goldman Sachs India, CNBC TV18. Named experts surface organically when AI extraction encounters attributions in articles.

**Polls strategy (call-rating reframe):** Poll A (IMPLICATION) opens at publish — choices: BULLISH/BEARISH/NEUTRAL. Poll B (RETROSPECTIVE) locked until admin resolves — choices: HIT/MISS. S14 shipped the full dual-poll system including mobile UI with optimistic updates.

**Resolution scope v1:** Short-term only (≤30 days). Admin manually calls POST /api/admin/expert-opinions/[id]/resolve via curl/Postman. No admin UI in v1. Resolution triggers batch notifications to all Poll A voters.

**Credibility scoring:** Computed on-the-fly (NEVER stored). Score = hitCount / scoredCount where scoredCount = opinions with at least 1 retrospective vote. Provisional when resolvedCount < 5. Leaderboard only shows experts with resolvedCount >= 5 and returns empty [] when < 3 qualify (Finance mode hides "Top Experts" link in that case).

**Legal posture:** Disclaimer on every expert opinion — "AI-summarized from [Source URL]. For educational discussion only. Not investment advice." Paraphrased only (no verbatim). SEBI Research Analyst regulations flagged for outside-counsel review — not yet blocking but review needed before public launch of leaderboard.

**Indian market tickers/indices:** Nifty 50, Sensex, Bank Nifty, RIL, TCS, HDFC Bank, Infosys, Reliance, sector indices. Currency INR. Indian fiscal year Apr–Mar.

**Technical debt to watch:**
- Prisma shadow DB limitation: adding enum values requires manual SQL migration pattern (db execute + migrate resolve --applied). Do not use migrate dev for enum changes.
- Finance markets route uses `any` cast for formatMarketSummary due to RankedMarket type incompatibility — acceptable for now.
- TypeScript narrowing for mode discriminant union in Markets tab uses IIFE pattern — fragile, should refactor when Markets tab is next touched.

**How to apply:** When planning future Finance sprints, reference these decisions as locked. Next logical sprint priorities: (1) admin UI for opinion resolution, (2) expert claim/verification flow so named analysts can verify their profiles, (3) push notification optimization for Poll B unlock.
