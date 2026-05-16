---
name: S19-T1 Poll A Magnitude Slider
description: Sprint 19 Poll A implication vote upgraded from 3-button to 5-bucket slider; schema/API/mobile/types all changed in one ticket
type: project
---

S19-T1 replaced the 3-button BULLISH/NEUTRAL/BEARISH Poll A with a snapped 5-position magnitude slider on Expert Opinion cards.

**Why:** SEBI exposure concern on directional labels; cleaner UX; histogram overlay enables richer post-vote visualization.

**How to apply:** All new IMPLICATION votes use STRONG_DROP / MILD_DROP / FLAT / MILD_GAIN / STRONG_GAIN. Legacy values (BULLISH/BEARISH/NEUTRAL) are mapped server-side in the vote route and in tallies aggregation — do NOT remove legacy mapping logic as stale clients may still send them.

Key files changed:
- `apps/api/lib/finance/tallies.ts` — new 5-bucket aggregation + medianBucket computation
- `apps/api/app/api/finance/expert-opinions/[id]/vote/route.ts` — accepts 5 new + 3 legacy; maps legacy to canonical before persist
- `apps/api/scripts/migrate-poll-a-buckets.ts` — one-off backfill script (ran clean, 0 rows in dev)
- `packages/types/src/index.ts` — ApiExpertOpinionTallies.implication shape: removed bullish/bearish/neutral, added strongDrop/mildDrop/flat/mildGain/strongGain + medianBucket
- `apps/mobile/src/components/news-feed-card.tsx` — PollA component rewritten with @react-native-community/slider; pre-vote = interactive slider + Submit button; post-vote = read-only slider + histogram bars + median flag
