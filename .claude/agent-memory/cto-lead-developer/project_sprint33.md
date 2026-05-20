---
name: Sprint 33 Finance Resolution Loop + Live Consensus Bar
description: S33 all 4 tickets implemented — resolution push loop, weekly digest endpoint+cron, digest mobile card+screen, live consensus bar
type: project
---

Sprint 33 shipped all 4 tickets in one pass. All at qa-review status as of 2026-05-20.

**Why:** CEO greenlit two Finance-section initiatives — Resolution Loop (foundational for user retention via accurate push after admin resolves expert opinion) and Live Consensus Bar (social proof on every ExpertOpinionCard).

**S33-T1 — Resolution Loop (CRIT)**
- `apps/api/app/api/admin/expert-opinions/[id]/resolve/route.ts` — fully rewritten
- Now computes per-voter agree/disagree/neutral from their stored choice (all v1/v2/v3 mappings handled)
- Fetches `computeUserOpinionAccuracy()` for each voter (all their resolved Poll A votes, NEUTRAL excluded from scoring)
- Creates `type: "OPINION_RESOLVED"` in-app notifications with copy: `"<expertLabel> — <DIRECTION> on <instrument|headline>. Resolved <HIT|MISS>. You agreed. Your accuracy is now <N>%."` 
- Fires Expo push in batches of 100 (fire-and-forget)
- OPINION_RESOLVED was already in NotificationType enum — no migration needed
- Returns `{ ok, opinion, notified, pushQueued }` for observability

**S33-T2 — Weekly Digest: API + cron**
- `apps/api/app/api/finance/my-calls-digest/route.ts` — new, auth required (Bearer JWT via getUserIdFromRequest)
- Returns `{ hits, misses, neutrals, pending, totalVoted, resolvedOpinions[] }` — all-time, not just 7 days
- `apps/api/app/api/cron/weekly-calls-digest/route.ts` — CRON_SECRET guarded, runs Sunday 03:30 UTC (09:00 IST)
- Cron scopes to resolved opinions in past 7 days, groups by userId, creates SYSTEM in-app notification
- `vercel.json` has `"30 3 * * 0"` cron entry
- Types added: `ApiDigestOpinion`, `ApiMyCallsDigest` in packages/types
- API client: `getMyCallsDigest()` method added with `auth: true`

**S33-T3 — Weekly Digest: mobile card + screen**
- `WeeklyCallsDigestCard` component added to finance-mode.tsx (between PulseRibbon and heroHeader)
- Only renders when `callsDigest.resolvedOpinions.length > 0` — hidden for users with no resolved votes
- Shows HIT / MISS / Pending stat blocks + colour-coded bar (green/red)
- Taps → `/finance/my-calls` (new screen)
- `apps/mobile/src/app/finance/my-calls.tsx` — new screen with summary card + per-opinion rows
- Each row: expert name, direction badge, HIT/MISS badge, instrument or quote, "You agreed — Correct" / "You disagreed — Incorrect", resolved date
- Pull-to-refresh via `useApiQuery`

**S33-T4 — Live Consensus Bar**
- `ConsensusBar` component added to `news-feed-card.tsx` (before PollA component)
- Pre-vote: 3px single green bar + "X% of N readers agreed" text (renders immediately after tallies load, total > 0)
- Post-vote: 5px split bar — agree (bright green) / neutral (grey) / disagree (red), user's side highlighted
- Zero extra API calls — uses tallies already fetched in ExpertOpinionRow's useEffect
- `consensusStyles` StyleSheet added alongside component

**Key recon findings vs memory:**
- Resolve endpoint was emitting generic "Cast your retrospective vote" copy (not personalized) — fixed
- No push was being fired from resolve at all — fixed
- OPINION_RESOLVED enum value already existed in schema — no migration needed
- Expo push fully wired: expoPushToken on User, registration endpoint, PushTokenRegistrar in _layout.tsx
- Poll A aggregate NOT on the opinion payload (tallies are a separate endpoint) — for consensus bar we use the tallies state already fetched in ExpertOpinionRow
- ExpertOpinionCard lives at apps/mobile/src/components/expert-opinion-card.tsx — delegates to ExpertOpinionRow in news-feed-card.tsx; consensus bar went into ExpertOpinionRow
