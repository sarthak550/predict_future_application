---
name: Sprint 11 Profile Redesign
description: S11 is a 3-ticket sequential profile redesign. T1=sticky header+perf strip (done), T2=sub-tabs (done), T3=consolidated Performance card (qa-review). Sprint 11 complete pending QA verdict on T3.
type: project
---

Sprint 11 is Phase 2 of the Profile screen redesign. All three tickets are single-file edits to `apps/mobile/src/app/(tabs)/profile.tsx`. No API changes allowed.

Sequence: T1 (sticky header + Performance Strip) -> T2 (sub-tabs) -> T3 (consolidated Performance card on Stats tab).

**T1 — done:** Sticky header card outside ScrollView. Performance Strip replaces 3-stat tile row. Reputation bar removed.

**T2 — done:** Sub-tab bar (Activity | Stats | Markets) immediately below sticky header. Activity tab = merged positions+votes with Bets|Votes pill toggle. Stats tab = PnlSummaryCard + CategoryBreakdownSection + HostStats. Markets tab = MyMarkets + Watchlist. GetStartedCard on Activity tab only when fully brand-new.

**T3 — qa-review:** Consolidated Stats tab into one PerformanceCard. Replaces PnlSummaryCard + CategoryBreakdownSection + separate HostStats card with:
- Row 1: Dominant netPnl number (font-size 36, colored green/red/neutral)
- Row 2: 4-stat pill grid — Accuracy%, Predictions (positions.length only), Win Rate (from positions array), Top Category (from categoryStats)
- Row 3: Category Breakdown collapsible (collapsed by default, shows chevron + teaser)
- Row 4: Host Stats collapsible (only when hostStats != null, collapsed by default)
- Skeleton card for users with activity but no resolved predictions (CTA: "Make 3 predictions to unlock your stats")
- Brand-new users (positions.length === 0 AND votes.length === 0): show simple empty message, suppress card

**Why:** Final ticket of Sprint 11. QA must STOP after T3 PASS and report to user — no further auto-spawning.

**How to apply:** Sprint 11 is the last sprint in this series. QA should report PASS + smoke-test checklist + "Sprint 11-T3 ready for user verification — last ticket of Sprint 11".
