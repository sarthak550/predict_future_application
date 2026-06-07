---
name: cto-assignment-brief-sprint52
description: Sprint 52 — Finance tab iteration (CombinedAnalystCard merge, See-all removal, 8px gap, Pulse pills 2-line redesign). Written retroactively after the sprint shipped — the actual sprint was driven by rapid in-session iteration with CTO direct (no formal CEO brief at the time).
metadata:
  type: project
  retroactive: true
---

> **NOTE:** This brief is **retroactive**. Sprint 52 ran as a rapid in-session iteration where the CEO step was skipped per user direction ("skip CEO, send direct to CTO"). The user made design calls live (merge vs separate, See-all kept vs removed, Pulse pill ambition level) and CTO implemented immediately. This document captures what shipped so future readers don't see a gap between S51 and S53. Original tickets were direct CTO calls, not CEO-issued.

Sprint 52 issued and shipped 2026-06-07. Theme: post-S51 visual iteration on the Finance tab analyst surfaces.

**Sprint thesis (reconstructed):** Following the Finance density polish in S51, the user surfaced four iterative refinements during live smoke-test. Each was scoped on demand and shipped same-day: (1) merge the two adjacent analyst cards into one visual unit if they're conceptually coupled, (2) remove the leaderboard footer link if Top 3 is the value, (3) tighten the resulting inter-card gap to a uniform value, (4) make the Pulse pills do something instead of being labels-with-chevrons.

**User-visible outcome:** The Finance tab analyst region is one card (Big Call dark hero + divider + ranked rows + nothing else), inter-card vertical rhythm is uniform 8px, and the Today's Pulse pills surface the implied market question, crowd consensus %, and urgency tint when the event is today/tomorrow.

---

## Tickets

### S52-T1 (HIGH): CombinedAnalystCard — merge Call of the Week + Top 3 Analysts

**Files:**
- New: `apps/mobile/src/components/combined-analyst-card.tsx`
- Modified: `apps/mobile/src/components/finance-mode.tsx` (mount-site swap)

**What shipped:** Single component renders both surfaces inside one card chrome: dark hero strip (event type label + analyst avatar/name/time + direction badge + instrument + Vote-→ hint pill, tap → opens opinion detail) → 1px divider → "Top this week" header → up to 3 ranked rows using `AnalystCredibilityBadge` size="sm" layout="inline".

**Decision locked at design time:** Built as a new component (not via composition of `BigCallHeroCard` + `TopAnalystsCard`) because both originals owned their own card chrome that would need to be undone. Easier to render fresh inside one chrome. Originally kept `BigCallHeroCard` + `TopAnalystsCard` intact as a documented revert path; that path was retired during the Sprint 53 cleanup pass.

**Edge cases:** opinion null → only bottom section renders; entries empty + not loading → empty-state copy; divider only renders when BOTH sections are present.

### S52-T2 (MED): Remove "See all" link from CombinedAnalystCard

**Files:** `combined-analyst-card.tsx`, `finance-mode.tsx` (drop `onLeaderboardPress` prop pass).

**What shipped:** User call: Top 3 is the value, the leaderboard link was a completeness gesture more than a real user need. Removed the link JSX, the `onLeaderboardPress` prop from `CombinedAnalystCardProps`, the `handleLeaderboardPress` handler, and the `analysts_leaderboard_card_tapped` analytics fire. Dead `leaderboardLink*` style entries were left in the StyleSheet at ship time and swept in the Sprint 53 cleanup.

**Tradeoff accepted:** `/expert-leaderboard` route is no longer reachable from this surface. Users find more analysts via expert search or by tapping into an individual analyst's profile.

### S52-T3 (LOW): Tighten inter-card vertical gap on Finance tab

**Files:** `combined-analyst-card.tsx`, `finance-mode.tsx` (pulseStyles).

**What shipped:** Both `CombinedAnalystCard.card` and `pulseStyles.card` had `marginTop: spacing.sm` (8) + `marginBottom: spacing.xs` (4). WeekToggleCard's `digestStyles.card` was already xs+xs. Dropped both `marginTop` values to `spacing.xs` (4) — uniform 8px gap between any two adjacent cards (down from 12px between Combined and Pulse).

### S52-T4 (HIGH): Pulse pills redesign — 2-line vertical with question + crowd % + urgency tint

**Files:** `finance-mode.tsx` (PulseRibbon function, mount-site prop change).

**Prop change:** `PulseRibbon` `clustersCount: number` → `clusters: { name: string }[]`. Mount site passes `clusters={data?.eventClusters ?? []}` instead of `.length`.

**What shipped:**
- **Pill A (Next Event):** vertical card with three internal rows. Row 1: `🔥 {flagshipEventType}` (left) + countdown `in Xd / tomorrow / today` (right). Row 2: market title (`numberOfLines={1}`, ~13px). Row 3: `{crowdYesPercent}% YES · {totalVotes} voted ›` (uses `crowdProbability["YES"]` × 100, rounded; falls back to vote count only when `crowdProbability` is null). **Urgency tint** on pill background: `#fef2f2`/`#fecaca` when today, `#fffbeb`/`#fde68a` when tomorrow, default otherwise. **Tap routes direct to `/market/{nextEvent.id}`** — bypasses the PulseSheet entirely.
- **Pill B (Policy Calendar):** vertical card with 2 internal rows. Row 1: `💼 Policy calendar` + `{N} events`. Row 2: preview of first 2 cluster names joined by ` · `, plus `· {N-2} more` when N>2. **Tap opens existing PulseSheet** (unchanged behavior).
- Pills are now stacked vertically with `spacing.xs` gap; the horizontal `ScrollView` is gone.

**Edge case:** `crowdProbability` is `Record<string, number>` keyed by outcome (e.g. `"YES"`). Pill always reads `"YES"`. For non-binary flagship markets (multi-choice), the percent is silently dropped — flagged for future as a known limitation in the audit.

---

## Out of scope (explicitly deferred)

- Onboarding copy refresh to the 2026-05-06 GTM lock — still parked.
- Shareable win card (CEO had recommended as the Sprint 53 candidate but user redirected to in-session iteration).
- iOS build, web parity for S49–S52 features, expert-follow push, groups discovery — all on backlog.
- SEBI Research Analyst legal review (admin gate before production deploy of named-firm rankings).

---

## Lesson logged

When skipping CEO for rapid iteration, the brief gap compounds — future readers see "S51 → S53" with no S52 record. The right discipline is to write a 5-minute retroactive brief at sprint close, OR keep a "session log" inline in the CEO MEMORY.md when bypassing the formal pipeline. Going forward: when the user says "skip CEO," write a one-paragraph retroactive note before the day ends.

**Written:** 2026-06-07 (retroactive)
