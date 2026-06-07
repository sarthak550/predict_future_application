---
name: project_sprint47
description: S47 F1 detail modal — full leaderboard with lap times, gaps, tire badges — all 3 tickets in one PR
metadata:
  type: project
---

Sprint 47 delivered as one commit (CEO strategy): T1 backend, T2 mobile UI, T3 polish all merged.

**What was built:**
- `apps/api/lib/sports/f1.ts` — `fetchF1SessionDetail(sessionKey)` using Promise.allSettled across 5 OpenF1 endpoints. Gracefully degrades on partial failures. Intervals gated to Race/Sprint only (isRaceSession check). Global fastest lap computed across all drivers; exactly one `fastestLapOverall: true`.
- `apps/api/app/api/sports/f1/session/[sessionKey]/route.ts` — public GET, Cache-Control: public, max-age=300, s-maxage=300. Returns 400 on invalid key, 404 on unknown session, 503 on upstream error.
- `packages/types/src/index.ts` — `ApiF1Driver` and `ApiF1SessionDetail` types added at bottom.
- `packages/api-client/src/index.ts` — `getF1SessionDetail(sessionKey: number)` added (no auth).
- `apps/mobile/src/components/f1-detail-modal.tsx` — full leaderboard FlatList with session-type gating, tire compound badges (official F1 colours), FL badge (purple #9B59B6), formatLapTime() helper.
- `apps/mobile/src/app/(tabs)/sports.tsx` — F1 guard at top of MatchDetailModal: `if (match.sport === "F1") return <F1DetailModal .../>`.

**Session-type gating in modal:**
- Race/Sprint: gap column, last lap, best lap, tire chip, FL badge
- Qualifying: best lap only, labelled "Q Time"; no gap, no tire, no last lap
- Practice: last lap, best lap, tire chip, FL badge; no gap

**Token issues found:**
- `radius.xl` does not exist — use `radius.lg` (max available: sm/md/lg/pill)
- `colors.textSecondary` does not exist — use `colors.textMuted`

**Live test (Monaco Qualifying, session_key=11295):**
- 22 drivers returned, P1 = Kimi ANTONELLI, intervals correctly gated (Qualifying)
- FL badge correctly on ANTONELLI (72.051s fastest)
- Stints available (100 records), but not shown for Qualifying per spec

**Why:** All four tsc checks exit 0. Commit SHA: 532c5c5
