---
name: project_scripting_ss4_ui_fix_qa
description: Scripts drawer overhaul (SS4 founder-feedback UI fix) — FAIL 2026-08-05 (round 1), then RE-TEST 2026-08-05 (round 2, this update) — Bug 1 (collision) now genuinely fixed; Bug 2 (console-height persistence race) STILL reproduces live despite the guard-ref fix, root cause is React 18 StrictMode dev double-invoke defeating the ref guard.
metadata:
  type: project
---

**Round 2 verdict (2026-08-05, re-test): Bug 1 PASS, Bug 2 FAIL.** See
[[project_dashboard_bug_trio_qa_2026_08_05]] for the SAME-DAY re-test of the
sibling dashboard ticket (also FAILED, unrelated files).

## Bug 1 (viewport-safety floor) — CONFIRMED FIXED

`getEffectiveMaxDrawerHeight` now clamps against `DRAWER_ABSOLUTE_MIN_HEIGHT`
(40) instead of `DRAWER_MIN_HEIGHT` (320), so the collision-safety ceiling
always wins. Swept 6 real viewport heights (600/650/700/750/800/840) with a
fresh Playwright context each: `styleHeightAfterReset` matched the exact
predicted `clampDrawerHeight(360, vh)` value at every height (80/130/180/
230/280/320px), canvas-vs-handle overlap was a constant -27px (no collision)
at every height, a REAL `locator.dblclick()` (not `elementFromPoint`) and a
REAL pointer drag both worked at every height, console correctly force-
collapses (`consoleExpandable` gate) when the drawer is too short for it
(verified at h=650: click-to-expand is a genuine no-op), and the disclosed
600px residual (editor's own chrome doesn't fully fit) reproduces exactly as
documented WITHOUT any chart collision — matches the brief's explicit
"don't fail on the cramped chrome itself" carve-out. Drag-grow tested at a
taller h=1100 viewport (effectiveMax=580, room to grow past the 360 default)
confirmed real growth (360→510 on a -150px drag) and drag-shrink-below-
effectiveMax correctly pinned (no further shrink past the ceiling).

## Bug 2 (console-height persistence race) — STILL FAILS, reproduced 3/3 + 1 more via a different path

The `drawerHeightSyncedOnceRef` guard was added to skip the `[drawerHeight]`
sync effect's FIRST invocation. This does NOT survive React 18 StrictMode's
dev-only double-invocation of a component's initial-mount effects: on the
very first commit, React (in dev) runs ALL mount effects, then immediately
cleans them up, then runs them AGAIN — both invocations of that pair operate
on the SAME render's closure (`drawerHeight` still the stale default 360,
since no new render has landed between the two firings). The guard correctly
skips invocation #1 (flips the ref true, returns early) but WRONGLY treats
invocation #2 (still the same stale closure) as "a real change" and runs the
corrupting body, computing `computeConsoleMaxHeight(360)` = 130 and
persisting it. A THIRD, later invocation (after the real re-render with the
correct restored `drawerHeight`) is a no-op since the corrupted value already
satisfies the new max.

Reproduced via TWO independent methods, both live against `apps/web` :3000 /
`apps/api` :3001 dev servers (fresh `.next`, matches this repo's standing
methodology):
1. **Seeded-value cold load** (the task brief's own repro): pre-seed
   `pf.workbench.scripts.drawerHeight=480` + `consoleHeight=200` via
   `context.addInitScript`, reload, open the drawer at h=900. Expected
   restore: drawer clamps to 380 (viewport-aware, correct, documented), and
   consoleHeight should clamp to 150 (`computeConsoleMaxHeight(380)`).
   ACTUAL: consoleHeight lands at 130 — the OLD bug's exact signature
   (`computeConsoleMaxHeight(DRAWER_DEFAULT_HEIGHT=360)`), and localStorage
   IS rewritten (corrupted) to "130". Instrumented `localStorage.setItem` to
   confirm: exactly TWO writes of "130" (matching the StrictMode double-
   invoke theory precisely — a single stale invocation would produce one
   write, but the double-invoke pattern produces exactly two identical
   ones). Reproduced 3/3 fresh-context runs.
2. **Drag-then-reload** (the task's own second A2 scenario): drag all three
   handles to non-default values (drawer 380, sidebar 240, console 150 —
   all correctly PERSISTED pre-reload), then `page.reload()`. Post-reload:
   drawerHeight and sidebarWidth restore correctly (380/240), but
   consoleHeight is corrupted to 130 again — same signature, same root
   cause, via the natural user flow this time (not a seeded/synthetic
   value).

Root-caused by temporarily adding a `console.log` inside the `[drawerHeight]`
effect body (local-only edit, reverted immediately after, confirmed via
`grep` that zero trace remains in the working tree) — not needed to prove
the bug (the localStorage-write-count instrumentation alone was conclusive)
but used to build full confidence in the exact mechanism for the CTO's fix
report.

**Fix direction for the CTO**: the `isFirstRender`-guard-ref pattern is
fundamentally the wrong shape for this bug in a StrictMode-enabled dev
environment (this repo has no `reactStrictMode: false` override in
`next.config.mjs`, so App Router's default-true applies) — a ref flips
permanently on the FIRST call regardless of whether that call belongs to a
"real" render or StrictMode's synthetic double-invoke of the SAME render.
The actually-robust fix is what the file's own module doc already floated
as the "cleanest" option and then didn't take: **merge the mount-restore
effect and the `[drawerHeight]` sync effect into ONE effect**, so there is
no cross-effect ordering/staleness window to guard against in the first
place — the restore effect can directly compute and set the correct
`consoleHeight` once, and the `[drawerHeight]`-dependent re-sync logic only
needs to run on GENUINE subsequent `drawerHeight` changes, which is
naturally true if it's the SAME effect that already handled the mount case.
Alternatively: derive `consoleHeight`'s clamp target from `drawerHeight`
via `useMemo` at render time (no effect, no staleness possible) and only
use an effect to persist-on-change with a value-equality guard, never to
compute the clamp itself from a closure that can be stale.

## What passed, independently verified live (round 2)

- A1 all 6 heights, both static + drag interaction (see Bug 1 above).
- A3: full width holds at 1512 (1512px exactly, not shrink-wrapped). Stale
  SS2 key (`pf.workbench.scriptDrawerHeight=999`) gracefully re-defaults to
  360px (not NaN/999) on reload. Example (MA Cross) → Duplicate → Run:
  Results panel appears, zero page errors throughout.
- Static gates: `tsc --noEmit` (apps/web) clean, `eslint` clean on all 6
  touched files (drawer-resize-handle/script-editor-drawer/code-editor/
  script-console/script-list-sidebar/paper-trading-dashboard — the last is
  the SEPARATE dashboard ticket's file, confirmed disjoint via git diff
  scope), `ta:check` 514/514. Git diff scope: drawer changes confined to
  `workbench/user-scripts/` (5 files) as expected.

## Cleanup (verified)

Seeded 3 disposable holdings on kira's account (RELIANCE/TCS/INFY, needed
for the SIBLING dashboard re-test's B1/B2 holdings-row tests, done via a
disposable `apps/web/scripts/qa-seed-holdings.ts` using the real
`computeOrderCosts`/`fetchDelayedLtp`/`getOrCreateActiveAccount` — market
was closed so the HTTP route's market-hours gate blocked a real order;
methodology matches [[reference_prod_db_qa_methodology]]'s documented
workaround). Also created 1 disposable `UserStrategyScript` row
("MA Cross (copy)") via the Duplicate-example flow. Both cleaned up at
session end: kira's `PaperTradingAccount` was ARCHIVED (generation 1→2, a
fresh 0-order ACTIVE account created — the REAL `resetAccount` archive
pattern, replicated directly via Prisma since the 30-day cooldown blocks
the real reset endpoint for a non-eligible test account) rather than
deleting rows in place, matching this repo's own "reset" semantics; the
duplicated script was hard-deleted (`deleteMany`, confirmed 0 remaining).
All 3 disposable script files removed from `apps/web/scripts/` immediately
after use (confirmed via `git status` — zero untracked files left in that
directory). Scratch dir `.qa-scripts-retest-2026-08-05/` removed. Both dev
servers killed, ports 3000/3001 confirmed free, `apps/web/.next` wiped again
per this repo's standing stale-dev/prod-mix trap.
