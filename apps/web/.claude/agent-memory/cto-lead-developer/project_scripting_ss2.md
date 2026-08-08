---
name: project_scripting_ss2
description: User Strategy Scripting Sprint SS2 (CodeMirror 6 editor drawer UI) — third-level lazy chunk, list sidebar, console, toolbar, autosave drafts, StrategyRunResult origin widening, 8 example scripts + parity fixtures. Built 2026-08-04.
metadata:
  type: project
---

# User Strategy Scripting — Sprint SS2 (2026-08-04)

Program: [[project_scripting_ss1]] (runtime core, QA-passed, committed 7097c16).
SS2 built code-complete, all gates clean, NOT deployed (no `db push` needed —
zero schema this sprint).

## CodeMirror budget gate — MEASURED, and the 80KB target is not achievable

D3 asked for the codemirror-touching chunk to be ≤80KB gzipped. Measured
reality (verified via a real `next build` + gzip pass on the compiled
chunk, not assumed): `codemirror`'s own `basicSetup` + `@codemirror/lang-javascript`
lands around **165KB gzipped**. Rewriting `code-editor.tsx` to hand-compose
a minimal extension set (line numbers, history, bracket matching,
closeBrackets, active-line highlight — dropping `basicSetup`'s
autocompletion UI/search panel/fold gutter/crosshair cursor/lint keymap,
none of which D1's own §1 prose asked for) only got it down to **~150KB
gzipped**. Confirmed via direct string-search that NO eslint/typescript/jsx-snippets
bloat leaked in — tree-shaking IS working. The floor is
`@codemirror/lang-javascript`'s lezer JS/JSX/TS grammar tables themselves
(a single combined grammar, not per-dialect-tree-shakeable) plus CM6's core
view/state/commands runtime. **This is a hard, measured technical reality,
not a tuning miss** — flagged to the CEO as a budget the brief itself
correctly called "needs to actually be measured, not assumed," now
measured and found roughly 2x the target. Recommendation on record: accept
~150-160KB gz as the real, structurally-isolated (lazy, paid only once, only
by users who open the Scripts drawer, after they've already paid ~165KB gz
for klinecharts by maximizing) cost of a real syntax-highlighting editor,
rather than downgrade to a plain textarea to hit an unmeasured number.

Explicit dependency additions beyond D1's literal "codemirror +
@codemirror/lang-javascript" two-package list: `@codemirror/state`
(EditorState/Compartment — `codemirror`'s own package does NOT re-export
these, verified against its `dist/index.d.ts`, only `EditorView`/
`basicSetup`/`minimalSetup` are re-exported), plus `@codemirror/view`,
`@codemirror/commands`, `@codemirror/language`, `@codemirror/autocomplete`
(the last ONLY for `closeBrackets`, never `autocompletion()`) once
`basicSetup` was dropped for the hand-composed set. All six are/were
already transitive dependencies of `codemirror`/`@codemirror/lang-javascript`
regardless — this never added a new package to the tree, only declared
existing transitive deps explicitly (phantom-dependency avoidance, same
reasoning as every other explicit-dep decision in this codebase).

## D2/D3 wording tension — resolved via measurement, documented as a CTO call

D2 names `script-editor-drawer.tsx` itself as the level-3 dynamic-import
target ("this is the file that pulls in code-editor.tsx... everything
downstream of it is where CodeMirror gets pulled in"), which naturally
bundles the WHOLE drawer (toolbar/sidebar/console/example-scripts) into
ONE level-3 chunk alongside CodeMirror. D3 then separately budgets "drawer
chrome... lands in the ALREADY-DYNAMIC WORKBENCH CHUNK" (implying level 2)
vs. "the editor chunk" (level 3) as if they're different physical files.
Built per D2's literal architecture (one dynamic import from
`chart-workbench.tsx` targeting `script-editor-drawer.tsx`) — webpack's own
chunk-splitting then naturally separated the result into 3 physical files
within that ONE logical entry: two CodeMirror-heavy files (~150KB gz
combined) and one chrome-only file with zero codemirror tokens (~10KB gz —
comfortably inside D3's "+15KB" number, just not physically inside
chart-workbench's OWN chunk). `chart-workbench.tsx`'s own level-2 chunk
grew by only **161 bytes gzipped** (the toggle button + dynamic() wiring +
new state) — verified via before/after per-file gzip diff.

## First Load JS — NOT literally byte-identical, precisely quantified why

Measured (gzip-summed from `app-build-manifest.json`'s exact per-page file
list, cross-checked against Next's own displayed numbers — matches to the
byte): `/paper-trading` 137,835 -> 138,202 (+367B), `/futures` 136,214 ->
136,570 (+356B), `/options` 142,409 -> 142,776 (+367B), all ~0.27%. Root
cause, confirmed by diffing every individual shared-chunk file's exact
bytes: the delta is spread in TINY amounts (2-140 bytes) across EVERY
shared/framework chunk uniformly — the unmistakable signature of webpack
module-ID renumbering from deleting one route (`/dev/scripting-ss1-smoke`,
this sprint's own mandated cleanup), not any SS2 app code landing in a
shared chunk (confirmed zero codemirror/drawer-code string matches in any
shared-chunk file). Same phenomenon [[project_scripting_ss1]] already
documented for its own 2-new-routes shift (87.4->87.6kB). Genuinely
byte-identical is not achievable when a route is added/removed at all in
this build pipeline — the honest bar is "isolated to routing-table churn,
zero app-code leakage," which this sprint verified precisely rather than
asserted.

## Bundle stash-verification gotcha (repo-root vs. subdir pathspecs)

`git stash push -u -- <paths>` run from INSIDE `apps/web/` with a pathspec
that's ALSO prefixed with `apps/web/` double-prefixes and fails that one
pathspec silently while still creating the stash from the others — the
working tree ends up PARTIALLY reverted (some files back at HEAD, others
not), easy to miss. Always run `git stash push -u -- <paths>` from the
REPO ROOT with root-relative paths for a multi-directory pathspec list, and
verify with `git status --short` immediately after, not just trust the
"Saved working directory" message. Recovered via `git show stash@{0}:path
> tmpfile` + manual `cp` for the one file that didn't apply, then a normal
`git stash pop` for the rest.

## Architecture actually built

- `code-editor.tsx` — imperative `EditorView` wrapper, init-once (D5),
  hand-composed minimal extension set (see above), per-instance
  `Compartment` for the read-only toggle, external-content-update via
  `dispatch({changes})` never re-init.
- `script-editor-drawer.tsx` — the drawer shell + all state orchestration
  (open script kind: new/script/example, autosave draft debounce+restore,
  Run/Save/SaveAs/Rename/Delete/Duplicate handlers, drawer height resize).
  Results display (StrategyStatsCard + OriginBadge) stacks BELOW the editor
  in the SAME middle column (D4 says "nothing else horizontally" for the
  sidebar/editor row — a third column would violate that; this is the CTO
  placement call for where §2's separate "results display" requirement
  lives).
- `script-list-sidebar.tsx` / `script-toolbar.tsx` / `script-console.tsx` /
  `drawer-resize-handle.tsx` / `draft-storage.ts` / `user-scripts-api.ts` —
  presentational/controlled sub-components + pure helpers, no business
  logic duplication.
- `strategy-panel.tsx` widened: `RunOrigin` type, `StrategyRunResult.origin`,
  `StrategyStatsCard`/`OriginBadge` exported (was module-private), badge
  rendered by the CALLER above the card at both sites (`StrategyConfigPanel`
  here, the drawer's own results block).
- `chart-workbench.tsx`: `</> Scripts` toggle (sticky-mount-once, then
  CSS-toggled, same pattern as `hasOpenedStrategyTab`), nested
  `next/dynamic` importing `script-editor-drawer.tsx`, `activeSignalsSource:
  "template"|"script"|null` decides which producer's signals paint on the
  shared single `PF_SIGNALS` chart instance ("last run wins" — template and
  script results/stats are tracked in fully independent state, so neither
  corrupts the other; only which one is CURRENTLY on the chart changes).
  `handleClearSignals` (Strategy tab's Clear button) only clears the chart
  if template was the active source, never touches a script run's markers.

## Example scripts + parity fixtures — the honesty-gate's real coverage

7 template rewrites (`maCross`/`emaCross`/`supertrendFlip`/`rsiReversal`/
`macdCross`/`bollBreakout`/`donchianBreakout`) + 1 kitchen-sink tour, in
`lib/ta/example-scripts.ts`. Parity fixtures in `selfcheck.ts` reuse
`fixtureCandles` (the SAME 10-bar series `maCross`'s own hand-traced
fixture uses) per the brief's explicit "single source of fixture truth"
instruction — but **this makes the check mostly vacuous under default
params**: with only 10 bars, the slower of each strategy's two periods
(21-30 for 5 of 7 strategies) never fills its window, so BOTH sides
(script and template) resolve to empty arrays for most of the 7 comparisons
(verified by hand-tracing `sma`/`ema`'s "no value until index >= period-1"
convention against the actual period defaults). Still a genuine regression
guard (verified NEGATIVELY during this build: temporarily mutated
`donchianBreakout`'s example script to hardcode a bogus extra signal, ran
`ta:check`, confirmed a loud FAIL with a clear diff, reverted) — but it
does not exercise real numerical divergence for most of the 7. Flagged
in-code (`example-scripts.ts`'s own module doc) and here for any future
CEO brief that assumes this fixture proves more than it does. The
kitchen-sink script needed its OWN longer, hand-tuned synthetic series
(pure sine wave, `100 + sin(i/10)*15` over 160 bars) — `fixtureCandles` is
far too short to produce SMA20/RSI14/ATR14 crossovers at all, and a
naively-chosen wavy series can still fail the acceptance ("≥1 BUY and ≥1
SELL") if its raw signals happen to start on a SELL — `helpers.finalize`'s
leading-SELL-drop rule silently eats an entire one-sided run. Verified via
a throwaway debug script before committing to fixture params, not guessed.

`ta:check`: 182 -> 192 (10 new: 7 parity + 3 kitchen-sink).

## Deleted per SS1's own mandate

`apps/web/app/dev/scripting-ss1-smoke/` — the temporary Worker-verification
harness, now fully superseded by the real editor UI. Confirmed gone from
`.next/types` too (a stale generated-types reference to the deleted page
briefly broke `tsc --noEmit` until `.next/types/app/dev` was cleared —
build-artifact staleness, not a real error).

## Numbers for the record

- `ta:check`: 182 -> 192 passed, 0 failed, negative-mutation-tested.
- Engine (`apps/api/scripts/verify-papertrading-engine.ts`, run from
  `apps/api/`): 264/264 untouched.
- `chart-workbench.tsx`'s own (level-2) chunk: +161 bytes gzipped.
- Level-3 `script-editor-drawer` chunk: ~160.5KB gzipped total (~150.5KB
  CodeMirror-attributable across 2 files, ~10KB chrome-attributable in a
  3rd file with zero codemirror tokens — webpack's own automatic split
  within one dynamic-import entry).
- First Load JS: 138.2/136.6/142.8 kB (was 137.8/136.2/142.4) — +367/+356/+367
  bytes (~0.27%), root-caused to routing-table churn from the deleted dev
  page, not app-code leakage (see above).
- `react-loadable-manifest.json`: 2 entries, `chart-workbench.tsx ->
  ./user-scripts/script-editor-drawer` (NEW, level 3) is a separate entry
  from `workbench-maximize-button.tsx -> ./chart-workbench` (level 2, W2) —
  proves the nesting actually isolated CodeMirror two levels deep.
