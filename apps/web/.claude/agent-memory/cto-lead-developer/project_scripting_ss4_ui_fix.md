---
name: project_scripting_ss4_ui_fix
description: Scripts drawer UI fix + adjustability pass (founder feedback "Scripts UI also need to be fixed, and adjustable") — root-caused via live Playwright diagnosis, not guessed. Built 2026-08-04.
metadata:
  type: project
---

# Scripts Drawer — UI Fix + Adjustability Pass (2026-08-04)

Program: [[project_scripting_ss1]], [[project_scripting_ss2]], [[project_scripting_ss3]]
(all QA-passed, shipped). Founder gave ONE blunt line of feedback on the live
drawer — "Scripts UI also need to be fixed, and adjustable" — no specifics.
Diagnosed empirically with real Playwright screenshots + live DOM
measurement before touching any code, per the assignment's own instruction.
Both defects found were SEVERE, not cosmetic — this was worth taking
literally rather than guessing at polish items.

## Defect 1 — drawer not full width (the dominant visual bug)

`chart-workbench.tsx`'s wrapper around the drawer
(`<div style={{display:"flex"}} className="min-h-0">`) has no `flex-col`,
making it a ROW flex container. The drawer's own root div had no
`w-full`/`flex-1`, so as the LONE flex item in a row container it
shrink-wrapped to CONTENT width instead of stretching — measured
512-947px at a 1512px-wide viewport depending on what content was loaded
(more code in the editor -> wider content -> wider "full width," a directly
UNSTABLE width that bounced around). Left a large dead gray gap on the
right at every width tested (1512/1280/990px), confirmed via screenshot at
every one. Fix: one class, `w-full` added to the drawer's OWN root div in
`script-editor-drawer.tsx` — zero changes needed in `chart-workbench.tsx`
(width:100% on a flex item resolves against the container regardless of
flex-grow, so this didn't need touching the wrapper).

## Defect 2 — chart/drawer height collision (the "not adjustable" bug)

`kline-chart.tsx`'s chart mount container has a hard `min-h-[420px]`
(unrelated to this pass, pre-existing, NOT touched). The OLD static
`DRAWER_MAX_HEIGHT` (640px, SS2) let a user drag the drawer tall enough to
force the chart below that floor. Past that point the chart's `<canvas>`
doesn't shrink further and OVERFLOWS past its own flex container,
literally painting over the drawer's toolbar and resize handle —
confirmed via `document.elementFromPoint` at the handle's own reported
coordinates resolving to the overflowing `<canvas>`, not the handle div.
This silently broke BOTH further dragging AND the double-click reset (both
land on the wrong element). On a realistic 800px-tall browser window (not
fullscreen — very plausible on a real laptop) this collision happened with
the drawer at its DEFAULT height, ZERO user interaction — just opening the
drawer broke it. This is almost certainly most of what the founder saw.

Fix: `clampDrawerHeight` (`drawer-resize-handle.tsx`) is now
viewport-aware — caps against `window.innerHeight - CHART_AREA_RESERVED_PX`
(520, a deliberately generous reserve over the measured 473px real need —
documented in-code as NOT importing a constant from
`kline-chart.tsx`/`chart-workbench.tsx`, both outside the drawer chunk, on
purpose). Applied everywhere a height can be set: drag, double-click
reset, localStorage restore on mount, AND a new window-resize self-heal
effect (shrinks the drawer live if the user resizes their actual browser
window smaller while it's open). Verified empirically post-fix: dragging
+1000px clamps correctly, the handle stays clickable for a SECOND drag
immediately after, double-click reset works, 800/840/982px-tall viewports
all show zero chart/drawer overlap.

## A bug I introduced fixing the above, and how it was caught

First cut of the new console-height adjustability (see below) gave it a
STATIC max independent of the drawer's own (now much smaller, adjustable)
height and a NEW `EDITOR_MIN_HEIGHT_PX` (100px) floor added to the editor.
Live-testing immediately caught it: dragging the console taller at the
drawer's DEFAULT height forced the editor below its own CSS `min-height` —
which does NOT cooperate with a too-small flex parent, it just overflows —
producing visibly garbled, overlapping editor/console text. Fixed with
`computeConsoleMaxHeight(drawerHeight)` in `script-editor-drawer.tsx`,
budgeting the console's ceiling against the drawer's CURRENT height minus
reserved chrome (toolbar+disclaimer, editor's own floor, console's own
header) — all three documented constants derived from REAL live DOM
measurement (76.5/100/35.5px), not guessed. `DRAWER_MIN_HEIGHT` itself had
to be raised from an initial 240 to 320 — the EXACT point below which even
the console's OWN minimum (80px) can't fit alongside the editor's floor —
not a round number, a precisely-derived one. Verified post-fix at the
drawer's new minimum with console dragged to max: zero overlap.
**Lesson for next time touching this drawer**: any NEW min-height/max-height
constraint added to one panel inside this drawer must be checked against
EVERY sibling's own constraints under the drawer's now-adjustable total
height — they're not independent, they share one fixed budget.

## Three new adjustability mechanisms, all persisted under one namespace

`pf.workbench.scripts.*` (renamed from SS2's `pf.workbench.scriptDrawerHeight`
— a returning user just gets re-defaulted once, not migrated):
- `drawerHeight` — pre-existing (SS2), now viewport-clamped (see above).
- `sidebarWidth` — NEW. `sidebar-resize-handle.tsx`, 140-320px, applied via
  a CSS custom property (`--script-sidebar-w`) set on the shared
  sidebar+editor row ref — `script-list-sidebar.tsx`'s own
  `sm:w-[var(--script-sidebar-w)]` class reads it via normal CSS
  inheritance, so no width PROP or ref needed on that component itself.
  Desktop-only (`hidden sm:block` on the handle) — meaningless on the
  mobile stacked layout.
- `consoleHeight` — NEW. `script-console.tsx` now owns a real draggable
  height (was a hardcoded `max-h-32`=128px with zero user control) —
  budget-clamped per above.
- Results/stats block — collapsible (chevron header, same idiom as the
  console's own), but deliberately NOT persisted — session-only state,
  matching the console's own pre-existing collapse behavior. This is the
  PRIMARY fix for "results crush the editor" (measured 133.6px editor
  height, ~5-6 visible lines, at default drawer height with a stats card
  showing) — collapsibility, not just a min-height floor, is what actually
  gives the user control back.

## Shared drag-mechanics hook — a deliberate generalization call

`use-drag-resize.ts` (new) factors out the pointer-capture +
rAF-throttled-flush + commit-on-pointerup machinery that was about to be
hand-copied a THIRD and FOURTH time (`panel-resize-handle.tsx` and
`drawer-resize-handle.tsx`, both pre-existing, are two independent copies
already). The axis/sign/clamp semantics that actually differ per handle
(which coordinate, which direction grows the box, the min/max bounds) stay
explicit and local at each call site — NOT parameterized into the hook —
matching this codebase's established preference for explicit per-site
direction comments over a fully generic abstraction.
`panel-resize-handle.tsx`/`drawer-resize-handle.tsx` themselves were left
completely untouched (already shipped/tested, no reason to risk a refactor
of working drag code for its own sake) — only the two NEW handles
(`sidebar-resize-handle.tsx`, and the one now inside `script-console.tsx`)
use the shared hook.

## Scope discipline — confirmed via diff, not just intention

Every touched/new file lives inside
`apps/web/components/paper-trading/workbench/user-scripts/` (the drawer's
own already-lazy level-3 chunk) — `chart-workbench.tsx` and
`kline-chart.tsx` were NOT touched at all. Confirmed via
`git diff --stat` scoped to that directory: 5 modified + 2 new files,
`+448/-41`. Because nothing outside the drawer chunk changed, the task's
own "stash-rebuild-compare if you touch anything outside the drawer chunk"
requirement didn't trigger — did a lighter verification instead: a real
`next build`, confirmed the SAME 2-entry `react-loadable-manifest.json`
nesting SS2/SS3 established still holds, confirmed zero `cm-content`/
`cm-scroller` (CodeMirror) tokens leaked into either shared chunk, and
measured the drawer chunk's own gzipped total: **162.3KB** (was ~160.5KB
at SS3's close) — a **+1.8KB** growth, comfortably inside "a few KB is
fine" for genuinely new functionality (2 new resize handles + a shared
hook + budget-aware clamping + collapsible results). First Load JS numbers
for `/paper-trading`/`/futures`/`/options` (139/137/143 kB) are close to
but not exactly SS3's own closing numbers (138.2/136.6/142.8) — traced to
an UNRELATED, concurrent, uncommitted change to
`use-workbench-candles.ts` present in the working tree at session start
(a different engineer's in-progress interval-race/candle-rollover fix,
confirmed via `git diff` — NOT mine, not touched, left exactly as found).

## Gotcha for whoever re-runs Playwright against this drawer

The username validation regex (`packages/validation/src/auth.ts`) is
alphanumeric+underscore ONLY — a disposable test account email/username
with a hyphen (`scriptsui-qa`) 400s at `/api/auth/register` with a generic
"Unable to register account" (the route's own catch-all error message
swallows the real Zod validation reason). Use underscores. Also: the
`Search symbol or company…` placeholder uses a real unicode ellipsis
character (`…`), not three ASCII periods — a literal `"..."` in a
Playwright placeholder selector matches zero elements silently (no error,
just an empty locator that times out later at `.waitFor`). Use
`input[placeholder^="Search symbol"]` (prefix match) instead.

## Numbers for the record

- `tsc --noEmit`: clean.
- `next lint`: zero errors, same 3 pre-existing warnings SS3 already
  documented (files this pass never touched).
- `ta:check`: 514 passed, 0 failed (grown from SS3's 195 — many unrelated
  sprints landed since; none of this pass's own changes touch anything
  `ta:check` covers, this is a pure UI/layout pass, no `lib/ta/*` files
  touched).
- Engine selfcheck (`apps/api/scripts/verify-papertrading-engine.ts`, run
  from `apps/api/`): 275/275 (grown from SS3's 264/264), untouched.
- Drawer chunk: 162.3KB gzipped (+1.8KB from SS3's ~160.5KB).
- First Load JS: 139/137/143 kB for dashboard/futures/options — drift vs
  SS3's 138.2/136.6/142.8 traced to a concurrent, unrelated,
  not-mine change to `use-workbench-candles.ts` (see above), not this
  pass's own work.

## Cleanup discipline

Disposable account (`scriptsui_qa@papertrading-qa.test`, username
`scriptsui_qa` — underscore, see gotcha above) deleted via a throwaway
`apps/web/scripts/tmp-cleanup-scriptsui-qa.ts` run with `tsx`, confirmed
zero `UserStrategyScript` rows left for that user ID before deleting the
script itself. Scratch Playwright scripts + screenshots lived in
`apps/web/.scripts-ui-scratch/` (never committed), `rm -rf`'d at session
end. Both dev servers (`apps/web` 3000, `apps/api` 3001) killed. No
commits made — orchestrator/founder holds deploy per the standing house
convention this program has followed since SS1.
