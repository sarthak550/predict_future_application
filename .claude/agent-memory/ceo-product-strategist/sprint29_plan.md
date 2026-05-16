---
name: Sprint 29 Plan — Make the Scoreboard Real
description: Sprint 29 strategic rationale and ticket summary. Theme is closing first-impression gaps, activating personalization, and giving analyst identity a progression arc. Written 2026-05-16.
type: project
---

## Sprint 29 — "Make the Scoreboard Real"

**Date planned:** 2026-05-16
**Status:** Active — 6 tickets, all pending

**Theme rationale:** Sprints 7–28 built the product skeleton, social graph, Finance credibility engine, and daily engagement loops. Sprint 29 focuses on three first-impression gaps that will cause D1 churn and two strategic features that activate the social graph and give analyst identity a progression arc.

## Three First-Impression Gaps Identified

1. **Leaderboard hidden from tab bar (S29-T1, CRIT):** The Leaderboard tab has `href: null` in _layout.tsx. The product is branded "India's Analyst Scorecard" but the scoreboard is buried behind Profile > Social card. Fatal discoverability failure.

2. **Delta badge always null (S29-T2, CRIT):** `rankDelta` is hardcoded to null in the leaderboard API (lines 125, 247, 259 of leaderboard/route.ts). The mobile UI already renders up/down badges when non-null — the frontend is complete. Missing: `LeaderboardSnapshot` model, weekly cron, and delta computation in the API response.

3. **Calls have no reasoning (S29-T3, HIGH):** Users make market predictions with no optional rationale field. `MarketPosition` has no `reasoning` field. The entire "Analyst Scorecard" brand equity requires calls to carry accountability beyond points. GJ Open's rationale badges are a proven retention driver.

## Two Strategic Features

4. **For You feed (S29-T4, HIGH):** Feed is purely chronological. Users who follow analysts get nothing back for following. Lightweight personalization: boost stories linked to markets where followed analysts have positions. Two-pill toggle: For You / All. Kalshi identified this as their top D7 retention driver.

5. **Analyst Tier system (S29-T5, HIGH):** No persistent analyst identity progression tied to accuracy + participation. Proposed tiers: ROOKIE (default) / ANALYST (10+ predictions, 55% accuracy) / SENIOR_ANALYST (50+, 60%) / CHIEF_ANALYST (200+, 65%, requires isVerifiedAnalyst=true). Tier badge on all public surfaces. This is the product's LinkedIn "All-Star Profile" mechanic — drives behavior change toward making more calls with better quality.

## Infrastructure Closure

6. **MSG91 SMS wiring (S29-T6, MED):** Phone verification is 95% built — OTP routes, DB store, +100 bonus, mobile UI all exist. Only gap: MSG91 API v5 format needs audit and `PHONE_VERIFY_MODE=prod` path needs QA validation. Phone OTP is the trust signal Indian users expect from every app (Zerodha, Swiggy, etc.).

## Tab Bar Restructure Decision (Locked in S29-T1)

Old tab order: Feed / Finance / Create / Markets / Profile
New tab order: Feed / Finance / Leaderboard / Create / Profile

Markets tab hidden (`href: null`) — accessible via Feed category chips, Finance tab Markets link, and deep links. Leaderboard restored as primary tab.

**Why:** Leaderboard is the brand. Markets is discovery. Discovery has multiple entry points. The brand has one.

## Key Schema Changes in Sprint 29

- `LeaderboardSnapshot` model (new table)
- `MarketPosition.reasoning String?` (nullable field)
- `AnalystTier` enum + `User.analystTier AnalystTier @default(ROOKIE)`

## New Cron Routes in Sprint 29

- `POST /api/cron/leaderboard-snapshot` (Sunday 23:59 IST = `59 18 * * 0` UTC)
- `POST /api/cron/recalculate-analyst-tiers` (daily 07:30 IST = `0 2 * * *` UTC)

**How to apply:** In future sprints, the Analyst Tier system is a prerequisite for any "Analyst Duel" mechanic (previously identified as a strategic bet). CHIEF_ANALYST tier creates the elite tier that makes duels narratively meaningful.
