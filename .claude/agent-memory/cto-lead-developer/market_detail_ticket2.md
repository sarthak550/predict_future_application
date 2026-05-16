---
name: Mobile Market Detail — Ticket 2 Complete
description: Estimated return calculation added to betting panel in market/[id].tsx; isPoll analysis and decision
type: project
---

## What was built (2026-05-01)

Completed Ticket 2: "Complete Mobile Market Detail Page" for the Expo mobile app.

### Files changed
- `apps/mobile/src/app/market/[id].tsx` — two targeted additions:

**1. `calcEstimatedReturn` function** — inlined below `BET_PRESETS` const (line ~42). Does NOT import from `@prisma/client` or `packages/business-rules`. Formula: projects the YES/NO pool after bet placement and computes floor of proportional payout. Zero-division guarded.

**2. Estimated return row in betting panel** — renders between the custom amount TextInput and the `{betError}` line. Condition: `!isNumeric && selectedSide && betAmount >= 50`. Uses `formatPoints` from `@predict-future/utils`. Styled as a minimal `flexDirection: row` / `justifyContent: space-between` row — label in `colors.textMuted`, value in `colors.text` bold. Three new StyleSheet entries: `estimatedReturnRow`, `estimatedReturnLabel`, `estimatedReturnValue`.

### isPoll analysis
Checked `ApiMarketDetailMarket` in `packages/types/src/index.ts`. No `template`, `marketTemplate`, or poll-discriminator field exists — only `storyId`. The existing `Boolean(market.storyId)` check was confirmed correct and left unchanged.

### Pre-existing TS errors (not introduced by this ticket)
All TS errors from `npx tsc --noEmit` in `apps/mobile` are pre-existing, located in:
- `sports.tsx` — `Record<string, unknown>` types used for cricket/football detail (many TS18046 errors)
- `markets.tsx` — `"polls"` mode compared against `"public" | "private"` union (TS2367)
- `notifications.tsx` — missing `ApiNotification` type and `mobileApi` methods
- `prediction-card.tsx` — missing `yesCount`/`noCount`/`totalVotes` on `ApiMarketSummary`
- `create-prefill.ts` — missing `ApiPredictionSuggestion` export

Zero errors in `market/[id].tsx` itself.

**Why:** Estimated return is a critical UX signal during bet placement — users need to know their projected payout before committing points. Inlining the formula avoids a Prisma/server-side import that would break React Native bundling.

**How to apply:** If the pool calculation changes server-side (e.g., commission model), the inlined `calcEstimatedReturn` in the mobile component must be updated in sync with `packages/business-rules/src/markets/probability.ts`. This is a known divergence point to watch.
