---
name: poll-market-separation
description: Poll/Market separation initiative — phasing, cut-line, and architectural decisions locked by founder
metadata:
  type: project
---

Poll/Market separation is a multi-phase architectural initiative to split the overloaded Market model (~55 fields) into two clean models.

**Phase 1 (Sprint 62):** Stand up Poll/PollOption/PollVote models and re-platform the RBI MPC feature onto Poll. Cut-line: ONLY the RBI feature moves. News polls (Market where storyId != null) stay on Market. Market model and all staked betting functionality is completely untouched.

**Phase 2 (future):** Migrate existing news polls (Market where storyId != null) onto Poll.

**Phase 3 (future):** Drop dead poll fields from Market (flagshipEventAt, flagshipEventType, etc.).

**Why:** Market model does double-duty — free-vote "polls" and real staked prediction "markets." This causes bugs and confusion. The product distinction is "predict vs bet."

**RBI feature surface (Sprint 61/62):**
- Admin create: apps/api/app/api/admin/rbi/mpc-pack/route.ts (OLD, Market-based — keep untouched)
- Admin create NEW: apps/api/app/api/admin/polls/rbi-mpc-pack/route.ts (Sprint 62 — Poll-based)
- Admin resolve OLD: apps/api/app/api/admin/rbi/mpc-pack/[clusterId]/resolve/route.ts (keep untouched)
- Admin resolve NEW: apps/api/app/api/admin/polls/[pollId]/resolve/route.ts (Sprint 62)
- Mobile card: apps/mobile/src/components/finance-mode.tsx — MpcPollPackCard
- Mobile detail: apps/mobile/src/app/finance/poll/[id].tsx
- Shared types: packages/types/src/index.ts — ApiMpcPollPack, groupFlagshipEventsIntoPacks

**Key codebase findings:**
- refreshUserStats() in apps/api/lib/stats.ts only queries MarketPosition, NOT MultiChoicePosition. Poll accuracy must be tracked independently via PollVote.isCorrect + new UserStat fields (totalPollPredictions, pollAccuracyScore).
- settleMultiChoiceMarket() handles free-vote case gracefully (amount=0 → no wallet ops) but still calls refreshUserStats — this behavior is KEPT for existing Market-based polls.
- Sprint 61 tickets are all pending — they create Market-based RBI demo rows that Sprint 62-T8 cleans up.

**Open product decision needing founder input:**
- Are polls strictly free-vote forever, or should there be an optional stake path added later? This affects whether Poll needs an `optionalStakeAmount` field or whether staked polls stay on the Market model forever. Sprint 62 assumes strictly free-vote (no stake fields on Poll).

**How to apply:** When planning any sprint that touches Market model, check whether the work is poll-flavored (storyId, flagshipEventAt, flagshipEventType) — if so, route it through the Poll model after Phase 1 ships.
