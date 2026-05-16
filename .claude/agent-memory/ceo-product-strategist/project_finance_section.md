---
name: Finance Section — Sprint 13–16 Initiative + S28 UX Roadmap
description: India-first Finance section strategic context, data model decisions, delivery status, and UX improvement roadmap from CEO review 2026-05-13.
type: project
---

Finance section fully delivered 2026-05-02 (Sprints 13–18). Sprint 28 queued 2026-05-13 to address UX gaps.

**Positioning:** "Indian markets through a global lens." Every story — Indian or global — framed as an Indian-market-impact question. Stories with no India angle are filtered at ingestion.

**Expert sourcing:** AI-extracted paraphrases from real news articles (NOT curated). Approved v1 organizations: HDFC Securities, ICICI Securities, Morgan Stanley India, Goldman Sachs India, CNBC TV18. Named experts surface organically when AI extraction encounters attributions in articles.

**Polls strategy (call-rating reframe):** Poll A (AGREEMENT) — 5-position agree/disagree slider on analyst's view. Poll B (RETROSPECTIVE) locked until admin resolves — choices: HIT/MISS. S14 shipped the full dual-poll system including mobile UI with optimistic updates.

**Resolution scope v1:** Short-term only (≤30 days). Admin manually calls POST /api/admin/expert-opinions/[id]/resolve via curl/Postman. No admin UI in v1. Resolution triggers batch notifications to all Poll A voters.

**Credibility scoring:** Computed on-the-fly (NEVER stored). Score = hitCount / scoredCount where scoredCount = opinions with at least 1 retrospective vote. Provisional when resolvedCount < 5. Leaderboard only shows experts with resolvedCount >= 5 and returns empty [] when < 3 qualify (Finance mode hides "Top Experts" link in that case).

**Legal posture:** Disclaimer on every expert opinion — "AI-summarized from [Source URL]. For educational discussion only. Not investment advice." Paraphrased only (no verbatim). SEBI Research Analyst regulations flagged for outside-counsel review — not yet blocking but review needed before public launch of leaderboard.

**Indian market tickers/indices:** Nifty 50, Sensex, Bank Nifty, RIL, TCS, HDFC Bank, Infosys, Reliance, sector indices. Currency INR. Indian fiscal year Apr–Mar.

**Sprint 28 UX gaps identified (CEO review 2026-05-13):**

1. No analyst follow / personalization — expert feed is undifferentiated for all users. Fixed by S28-T1 (ExpertFollow schema + My Analysts filter chip row).
2. No pagination — loads 30 items once; ignores existing cursor API. Fixed by S28-T2 (10-item pages, scroll-to-bottom infinite scroll).
3. Analyst Sentiment Card is a dead-end View (not tappable). Direction filter for the expert feed missing. Fixed by S28-T3.
4. No cross-dataset insight surface showing crowd vs. expert accuracy. Fixed by S28-T4 (Crowd-vs-Expert card, hidden until 10+ resolved opinions).

**Moonshot: Crowd-vs-Expert accuracy scoreboard.** Architecture already supports it (crowd votes + expert opinions + resolution tracking). Need 50+ resolved opinions for statistical validity — est. 60-90 days at current ingestion rate. S28-T4 builds the scaffold. Do NOT build the analyst self-verification/claim-profile flow until SEBI outside-counsel review is complete.

**Things NOT to build yet:**
- Search bar (< 200 opinions = thin results feel worse than no search)
- Push notifications for new opinions from followed analysts (volume too low — ramp first)
- Analyst self-verification / claim profile flow (SEBI legal review pending)

**Technical debt to watch:**
- Prisma shadow DB limitation: adding enum values requires manual SQL migration pattern (db execute + migrate resolve --applied). Do not use migrate dev for enum changes.
- Finance markets route uses `any` cast for formatMarketSummary due to RankedMarket type incompatibility — acceptable for now.
- TypeScript narrowing for mode discriminant union in Markets tab uses IIFE pattern — fragile, should refactor when Markets tab is next touched.

**How to apply:** S28 is the active sprint. After S28, next logical priorities: (1) bulk admin opinion resolution UI to accelerate the data needed for Crowd-vs-Expert, (2) analyst verification flow only after SEBI review completes.
