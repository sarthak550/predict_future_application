---
name: project-sprint51
description: S51 Finance tab density polish — TopAnalystsCard compact, PulseRibbon collapsible, WeekToggleCard compact strip. No schema/API changes.
metadata:
  type: project
---

Sprint 51 delivered 2026-06-07. Theme: Finance tab density reduction — pre-feed stack from ~560px to ~334px.

**T1 (CRITICAL) — TopAnalystsCard compact**: `apps/mobile/src/components/top-analysts-card.tsx`
- Header text changed from `TOP ANALYSTS · This week` (uppercase bold 11px) to `Top analysts · this week` (normal weight 500, 11px, textMuted, letterSpacing 0.3)
- Row paddingVertical 8→5, skeleton row same
- Rank fontSize 13→12
- listArea gap spacing.xs(4)→3
- Card padding: padding:spacing.md → paddingHorizontal:spacing.md + paddingVertical:spacing.sm
- Footer: merged two Text nodes to one, text "See full leaderboard →"→"See all →", fontSize 14→12, marginTop spacing.sm→4
- Removed `leaderboardLinkArrow` style (no longer needed)
- AnalystCredibilityBadge NOT touched

**T2 (HIGH) — PulseRibbon collapsible**: `apps/mobile/src/components/finance-mode.tsx`, `PulseRibbon` function (~line 623)
- Added `collapsed` state (default true), AsyncStorage key `"finance_section_collapsed_pulse"`
- Heading wrapped in `<Pressable style={pulseStyles.headingRow}>` with chevron ▼/▲
- `pulseStyles.heading` had `paddingHorizontal` removed; moved to new `pulseStyles.headingRow`
- Pills ScrollView conditionally rendered: `{!collapsed && (...)}`
- No userId suffix — no auth context at PulseRibbon scope; device-level key documented in comment

**T3 (HIGH) — WeekToggleCard compact strip**: `apps/mobile/src/components/finance-mode.tsx`, `WeekToggleCard` function (~line 789)
- Added `expanded` state (default false), AsyncStorage key `"finance_section_expanded_yourweek"`
- Compact strip: `<Pressable style={digestStyles.compactStrip}>` with inline hits/misses/pending text + `›` chevron
- Expanded: existing full card with collapse affordance — tapping the currently-active toggle pill a second time collapses back to strip
- Existing `"finance.weekCardView"` toggle persistence unchanged
- No userId suffix — device-level key, consistent with T2

**Why:** Finance tab pre-feed scroll was ~560px; S50 added TopAnalystsCard without auditing vertical budget. S51 restores density.

**How to apply:** Any future component added to Finance tab landing view must include a pre-fold height accounting comment. See S51 brief for table format.
