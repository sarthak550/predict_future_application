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
- Portfolio tracker / holdings sync (broker API cost, inferior to Groww/Zerodha native)
- Analyst chat/comments section (noise kills credibility signal; StockTwits cautionary tale)
- Live price widgets or charts (licensing cost, unfavorable comparison to Bloomberg/Moneycontrol)
- "Trending stocks" or watchlist (commodity feature, dilutes Analyst Scorecard positioning)

**CEO review 2026-05-20 — Next Evolution Decisions:**

Top 3 CEO Priorities (commit this month):
1. RESOLUTION LOOP: Push notification fires on admin resolution — "Citi BUY on Reliance resolved HIT. You agreed — accuracy now 71%." + weekly in-app digest card at position 2 in Finance feed. One sprint build. This is foundational — all retention mechanics downstream depend on users experiencing outcomes.
2. LIVE CONSENSUS BAR: Add live social proof bar to every ExpertOpinionCard — "64% of 312 readers agreed." Show before vote (subtle) and after vote (expanded). No new API endpoint needed, vote aggregate already computed. Drives conversion from browser to voter.
3. OPERATIONAL MILESTONE: 50 resolved opinions by 2026-07-01. Not a feature — a founder/ops commitment. Every unlock (Crowd-vs-Expert, weekly leaderboard drop, B2B data) is gated on this. Admin must treat resolution as a daily habit.

Ranked feature backlog added 2026-05-20:
- Quick Win: Resolution Alerts + Personal Accuracy Digest (push + weekly digest card). Two-sprint build.
- Quick Win: Live Consensus Bar on ExpertOpinionCard (no new API). One-sprint build.
- Strategic Bet: Weekly "Who Called It Right" Leaderboard Drop (Sunday auto-card + shareable screenshot). Build surface now, populate as data accumulates.
- Q3 Backlog (DO NOT BUILD YET): User "Callout" mechanic — challenge an analyst call with a competing call. Only viable after 50+ resolved opinions and functioning admin resolution workflow.

Business model path agreed 2026-05-20:
- Tier 1 (launch-ready): Brokerage affiliate referrals. Zerodha/Groww/Angel One INR 300–1000/activated account. Insert CTA after HIT resolution: "Want to act on the next call? Open a Groww account."
- Tier 2 (6 months): Pro subscription INR 99/month — instant resolution alerts, immediate follow-analyst push, personal accuracy breakdown by sector. Free tier: feed access + voting.
- Tier 3 (12+ months): B2B aggregated crowd-sentiment data feed to asset managers. Requires 10,000+ active voters. Do NOT build surface yet — just preserve vote timestamps + sector tags in DB.
- Do NOT monetize with ads. Signals low quality to the prosumer user; kills editorial credibility.

**Technical debt to watch:**
- Prisma shadow DB limitation: adding enum values requires manual SQL migration pattern (db execute + migrate resolve --applied). Do not use migrate dev for enum changes.
- Finance markets route uses `any` cast for formatMarketSummary due to RankedMarket type incompatibility — acceptable for now.
- TypeScript narrowing for mode discriminant union in Markets tab uses IIFE pattern — fragile, should refactor when Markets tab is next touched.

**How to apply:** S28 is the active sprint. After S28, next logical priorities: (1) bulk admin opinion resolution UI to accelerate the data needed for Crowd-vs-Expert, (2) analyst verification flow only after SEBI review completes.
