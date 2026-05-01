# Sprint Board

> Human-readable view of `.claude/sprint-board.json`. Auto-maintained by the CEO/CTO/QA agents — do not edit by hand.

**Current sprint:** 12
**Status:** BLOCKED — all 4 tickets FAILED QA (2026-05-02). Two failures shared across all tickets: (1) leaderboard API leaks full user rows including passwordHash/email/expoPushToken; (2) getLeaderboard() missing auth:true, making userContext permanently null for all mobile users. CTO must fix both before sprint can close.

---

## Legend

| Symbol | Meaning |
|---|---|
| pending | waiting for CTO |
| in-progress | CTO implementing |
| qa-review | waiting for QA verdict |
| done | QA passed |
| failed | QA blocked, CTO must fix |

| Priority | Label |
|---|---|
| critical | CRIT |
| high | HIGH |
| medium | MED |
| low | LOW |

---

## Sprint 7

| ID | Pri | Status | Title |
|---|---|---|---|
| S7-T1 | CRIT | done | Feed: Inline poll voting directly on news cards |
| S7-T2 | CRIT | done | Market detail: sticky betting panel (bottom sheet or fixed footer) |
| S7-T3 | CRIT | done | Onboarding: first-run tooltip walkthrough for new users |
| S7-T4 | HIGH | done | Streak and daily engagement mechanic |
| S7-T5 | HIGH | done | Sports tab: tap a match to see linked markets and create a prediction |
| S7-T6 | HIGH | done | Profile: P&L summary card — net points won/lost across resolved markets |
| S7-T7 | HIGH | done | Share a market: native share sheet with deep link URL |
| S7-T8 | HIGH | done | Markets tab: sort controls and trending markets surface |

---

## Sprint 8

| ID | Pri | Status | Title |
|---|---|---|---|
| S8-T1 | CRIT | done | Groups tab: replace placeholder with functional group browse and join flow |
| S8-T2 | CRIT | done | Resolution payoff: win/loss modal with points delta when a market resolves |
| S8-T3 | CRIT | done | Notifications: make each notification tappable and route to the relevant screen |
| S8-T4 | HIGH | done | Leaderboard tab: restore as a full-screen dedicated tab visible in the nav |
| S8-T5 | HIGH | done | Public user profiles: tap a username anywhere to view their stats |
| S8-T6 | HIGH | done | Create market: post-submission success screen and draft recovery UX |
| S8-T7 | MED | done | Feed: skeleton loading cards on initial load instead of a blank spinner |
| S8-T8 | MED | done | Market detail: resolution rationale and resolver identity in the resolved view |

---

## Sprint 9

| ID | Pri | Status | Title |
|---|---|---|---|
| S9-T1 | CRIT | done | Fix feed userVote persistence: add auth:true to getNews API client call |
| S9-T2 | CRIT | done | Fix Profile Bets tab: wire real positions or remove the dead tab |
| S9-T3 | HIGH | done | Deep-link group join: /join/[inviteCode] mobile route + web stub + app config |
| S9-T4 | HIGH | done | Profile screen: surface Leaderboard and Groups links above the empty-state walls |
| S9-T5 | HIGH | done | Create wizard: Simple vs Advanced split to collapse power-user steps |
| S9-T6 | MED | done | QA process: add mandatory smoke-test checklist to every QA report |
| S9-T7 | CRIT | done | Hotfix: mobile register wallet gap — verify fix, backfill integrity, audit all create-user paths, regression test |

---

## Sprint 10

| ID | Pri | Status | Title |
|---|---|---|---|
| S10-T1 | HIGH | done | Profile empty-state cleanup: suppress hollow cards, add GetStartedCard, reorder activity above P&L, drop Streak tile |

---

## Sprint 11

| ID | Pri | Status | Title |
|---|---|---|---|
| S11-T1 | HIGH | done | Sticky identity strip + Performance Strip line |
| S11-T2 | HIGH | done | Sub-tabs inside Profile (Activity \| Stats \| Markets) — revised again: pill toggle for Activity |
| S11-T3 | HIGH | done | Consolidated Performance card on Stats sub-tab |

---

## Sprint 12

| ID | Pri | Status | Title |
|---|---|---|---|
| S12-T1 | CRIT | failed | Leaderboard: dynamic subtitle + sort-order consistency fix |
| S12-T2 | HIGH | failed | Leaderboard: time-window selector (This Week / This Month / All Time) |
| S12-T3 | HIGH | failed | Leaderboard: sticky 'Your Rank' card pinned below selectors |
| S12-T4 | MED | failed | Leaderboard: row chevron, delta badge, and category-aware empty state |
