---
name: Sprint 29 complete — Analyst Tier + Feed Personalization + MSG91 Phone
description: All 6 S29 tickets done 2026-05-16; T4/T5/T6 passed QA cleanly
type: project
---

Sprint 29 is complete. All 6 tickets passed QA.

**Why:** S29 added: Leaderboard tab restore (T1), rank delta persistence (T2), call reasoning field (T3), personalized For You feed (T4), Analyst Tier system (T5), MSG91 SMS phone verification (T6).

**How to apply:** Future work touching analyst tiers should use `computeTierFromStats` in `apps/api/lib/analysts.ts`. The cron route `recalculate-analyst-tiers` runs at `0 2 * * *`. `updateAnalystTier` is already called from market resolution (`apps/api/lib/markets/resolution.ts`).

Key observations:
- The `AnalystTier` DB migration was applied before S29-T4/T5/T6 QA (leaderboard endpoint returned analystTier field correctly at runtime).
- `getPersonalizedNewsPage` in `apps/api/lib/news/queries.ts` gracefully falls back to standard feed when the user follows nobody or followed analysts have no recent positions — no crash path.
- MSG91 integration in `apps/api/app/api/users/me/verify-phone/route.ts` correctly puts `authkey` in headers (not body), wraps SMS dispatch in try/catch, and never surfaces SMS errors to the client.
- `MSG91_SENDER_ID` is documented in comments and DEPLOYMENT.md but is NOT sent in the MSG91 request body — this matches MSG91 OTP API v5 behavior (sender is configured at template level). Not a bug.
- TypeScript compilation: zero errors in both `apps/api` and `apps/mobile`.
- Server was running on port 3001 (not 3000 as stated in the ticket prompt).
