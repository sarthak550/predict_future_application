---
name: project_scripting_ss4_qa_fix
description: Scripts drawer SS4 founder-feedback pass FAILED QA on 2 bugs (2026-08-05); both fixed same day. Design decisions for a viewport-can't-fit-both drawer and a mount-effect race.
metadata:
  type: project
---

Follow-on to [[project_scripting_ss4_ui_fix]]. QA's own findings:
`apps/web/.claude/agent-memory/qa-engineer/project_scripting_ss4_ui_fix_qa.md`.
Fixed both bugs it reported, code/unit-level verification only (dev-server
slot was occupied by a concurrent QA session this round — no Playwright run
by me; a live re-QA sweep at 600-800px was expected to follow).

## Bug 1 — DRAWER_MIN_HEIGHT floor overrode collision safety below ~840px viewport

`drawer-resize-handle.tsx`'s `getEffectiveMaxDrawerHeight` had
`Math.max(DRAWER_MIN_HEIGHT, vh - CHART_AREA_RESERVED_PX)` — the 320px
"comfort" floor beat the collision clamp whenever `vh < 840`, reproducing
the exact chart-paints-over-drawer defect SS4 claimed to have fixed. QA
proved it live down to 600px (a real Playwright dblclick timed out at
700px — canvas ate the handle).

**Design chosen: let the drawer legitimately shrink below `DRAWER_MIN_HEIGHT`
on short viewports** (not a "your window is too short" blocking fallback —
the brief explicitly wanted 650-750px laptop windows to stay USABLE, not
gated behind a message). Changed `getEffectiveMaxDrawerHeight` to clamp
against a much smaller `DRAWER_ABSOLUTE_MIN_HEIGHT` (40px, pure
zero/negative-CSS-height sanity floor, only reachable below ~560px
viewport — never on a real laptop) instead of `DRAWER_MIN_HEIGHT`.
`clampDrawerHeight` itself needed ZERO changes — its
`Math.min(effectiveMax, Math.max(DRAWER_MIN_HEIGHT, height))` already
degrades correctly once `effectiveMax < DRAWER_MIN_HEIGHT`, since the outer
`Math.min` always wins. Verified numerically against the REAL source (not
a re-implementation) via `tsx` + a scratch import — this repo's tsconfig
makes `.tsx` modules import as CJS-interop (`import mod from "./x.tsx"`,
named exports live under `mod.KEY`, not plain named imports — bit me once,
recorded here):

| vh  | drawerMax | drawerMax+520(reserved) |
|-----|-----------|--------------------------|
| 600 | 80        | 600 (exactly, no overlap) |
| 650 | 130       | 650 |
| 700 | 180       | 700 |
| 750 | 230       | 750 |
| 800 | 280       | 800 |
| 840 | 320       | 840 (== old floor boundary, matches design) |

## Bug 1's second half — internal editor/console budget re-derived for sub-320 drawers

The brief explicitly required this: `computeConsoleMaxHeight`/the editor's
`minHeight` used to assume the drawer was always >= 320px (that was true
only because of the old buggy floor). Redesigned in
`script-editor-drawer.tsx`:
- `computeEditorMinHeight(drawerHeightPx)` — was a flat `EDITOR_MIN_HEIGHT_PX`
  constant (100px) asserted unconditionally via inline `style`; now derives
  the REAL floor from `drawerHeightPx - chrome - consoleCollapsedHeader`,
  clamped into `[0, 100]`. Degrades to 0 on a tiny drawer rather than
  asserting a fixed minHeight bigger than the parent can give (a hard
  inline minHeight on a flex child does NOT cooperate with a too-small
  parent — it overflows past it, not shrinks to fit).
- `computeConsoleMaxHeight` now composes with the above instead of a flat
  editor constant.
- New `consoleExpandable = computeConsoleMaxHeight(drawerHeight) >=
  CONSOLE_MIN_HEIGHT` gates whether the console is allowed to actually show
  expanded — below that, the console is FORCED collapsed (reclaims its
  chrome for the editor) rather than letting editor/console text overlap
  each other. Self-heals every render off the live `drawerHeight` — no
  effect needed. The toggle handler blocks expand-attempts while
  `!consoleExpandable` but always allows collapse.
- Verified numerically (hand-transcribed formulas, matched line-for-line
  against the file immediately before writing the check — these functions
  aren't exported, importing the whole component pulls in CodeMirror):
  invariant "collapsed-console footprint (chrome+editorMin) <= drawerHeight"
  holds cleanly at every drawer height corresponding to the 650-750px
  target range (130/180/200/230px) and beyond (280/320px). **One disclosed
  residual**: at vh=600 exactly (drawer=80px, below the brief's own named
  650-750 target range), the drawer's OWN fixed chrome alone (handle+
  toolbar ≈90px + collapsed console header ≈32px = 122px) already exceeds
  an 80px drawer — genuinely too small for ANY internal content regardless
  of editor/console math, since the toolbar's own button row
  (script-toolbar.tsx, untouched, out of this pass's file scope) has an
  intrinsic minimum. The OUTER chart-collision guarantee still holds exactly
  at vh=600 (zero chart overlap) — only this deeper internal-chrome squeeze
  is unresolved there, flagged honestly rather than silently claimed fixed.

## Bug 2 — cold-mount effect race corrupted a valid saved consoleHeight

`script-editor-drawer.tsx`: the `[]` mount-restore effect correctly clamps
`consoleHeight` against the JUST-restored `drawerHeight` (a local var). The
separate `[drawerHeight]` sync effect declared right after it ALSO fires on
the SAME initial mount (React always runs a dep-array effect once after
first render, deps-changed-or-not) — but its closure still holds Render 1's
`drawerHeight` (the 360 default, not the restored value), so it re-clamps
against the WRONG height and PERSISTS the corrupted result to localStorage.
QA's repro: seeded 480/200 (both valid), reload → silently became 130
(=computeConsoleMaxHeight(360) exactly, confirming root cause) and
localStorage got overwritten — every future reload kept reconfirming 130.

**Fix**: first-render guard ref (`drawerHeightSyncedOnceRef`) on the
`[drawerHeight]` effect — skips its body on the very first post-mount
invocation only, lets every REAL later drawerHeight change (drag/reset/
window-resize) through normally. Considered merging both effects into one
but the guard-ref is the simpler diff and matches an existing pattern
elsewhere in the codebase per QA's own suggestion. Verified via a
deterministic hand-simulation of React's own effect-ordering contract
(declared-order, once-per-commit) driven by the file's exact transcribed
formulas — confirmed final state drawerHeight=480/consoleHeight=200/
localStorage untouched, matching the required post-fix behavior exactly.

## Verification method note for next time

No dev server / Playwright available this round (occupied by a concurrent
QA session). Did NOT skip verification — imported the real, unexported
`getEffectiveMaxDrawerHeight`/`clampDrawerHeight` via `tsx` directly (proved
correct against the ACTUAL source, not a hand copy) for Bug 1's outer
clamp; for the module-private inner functions (`computeEditorMinHeight`
etc., not exported — importing the whole component pulls in CodeMirror)
and for Bug 2's effect-ordering, used a hand-transcribed-and-verbatim-
checked standalone simulation instead of trusting prose reasoning alone.
Gates: `tsc --noEmit` clean (had to `git stash push --keep-index` a single
unrelated concurrent file — `paper-trading-dashboard.tsx`, a different
in-progress URL-param feature, confirmed via its own doc-comment banner —
to isolate a pre-existing unrelated TS error from my own scope; restored
immediately after), `next lint` clean on both touched files, `ta:check`
514/514 unchanged. No commits made.
