---
name: Sprint 11 complete — Profile redesign Phase 2
description: Sprint 11 all 3 tickets done; kira has real resolved P&L data available for testing PerformanceCard
type: project
---

Sprint 11 (Profile redesign Phase 2) completed on 2026-05-02. All three tickets passed QA.

- S11-T1: Sticky identity strip + Performance Strip line (done)
- S11-T2: Sub-tabs Activity/Stats/Markets (done)
- S11-T3: Consolidated PerformanceCard on Stats sub-tab (done)

**Why:** Three-ticket sequential sprint, each blocked on prior passing human smoke test.

**How to apply:** When auditing profile.tsx in future sprints, be aware the file is now ~1630 lines with sticky header + sub-tab architecture. The Stats tab is fully owned by PerformanceCard + PerformanceSkeletonCard. Activity tab has a Bets/Votes pill toggle sub-nav. Markets tab has MyMarketsSection + WatchlistSection.

**Test data state as of 2026-05-02:** kira@example.com has 5 positions, 1 vote, pnl.resolvedMarketCount=2 (netPnl=-268), accuracyScore=100, 8 categoryStats, hostStats present. The PerformanceCard full path (not skeleton) renders for kira.
