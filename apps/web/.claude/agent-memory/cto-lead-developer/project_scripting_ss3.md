---
name: project_scripting_ss3
description: User Strategy Scripting Sprint SS3 (security hardening matrix + keyboard shortcuts + empty states + narrow-viewport + deploy verification) — closes the 3-sprint program. Built 2026-08-04.
metadata:
  type: project
---

# User Strategy Scripting — Sprint SS3 (2026-08-04)

Program: [[project_scripting_ss1]], [[project_scripting_ss2]] (both QA-passed,
committed 7097c16/fd7edd7). SS3 is the closing hardening sprint — the full
13-item live-browser security matrix, Cmd+Enter/Cmd+S shortcuts, empty
states, narrow-viewport pass, and standalone-build deploy verification.
Code-complete, all gates clean, NOT deployed (no commit made — orchestrator
holds deploy pending founder go-ahead, per brief).

## Playwright now real-installed for this sprint

`npx playwright install chromium` (browser binary) + `npm install --no-save
playwright` (the npm package itself — `install chromium` alone does NOT add
the package to `node_modules` persistently) run at repo ROOT. `--no-save`
keeps `package.json`/`package-lock.json` untouched (confirmed via `git
status` before/after) — this is scratch QA tooling for this session, not a
new project dependency. Two real local Postgres accounts
(`ss3-a@papertrading-qa.test` / `ss3-b@papertrading-qa.test`, created via a
throwaway `apps/web/scripts/tmp-*.ts` run with `tsx`, deleted immediately
after) — same disposable-account pattern SS1 QA established. Both `apps/web`
(port 3000) AND `apps/api` (port 3001) must be running — the candles proxy
route (`apps/web/app/api/instruments/[symbol]/candles/route.ts`) forwards to
`apps/api` at `127.0.0.1:3001`, which was NOT running at session start (only
`apps/web` was) — every candle fetch failed with "Candle data temporarily
unavailable" until `apps/api`'s own dev server was also started. This is a
real, easily-missed setup gotcha for anyone re-running this matrix.

## Playwright's own click actionability breaks on this app's fixed-overlay layout

The workbench renders as `position: fixed inset-0` on top of a taller
underlying dashboard page (`document.documentElement.scrollHeight` ~1575px
vs. a 1000px viewport). Playwright's default `.click()` tries to
`scrollIntoViewIfNeeded` first — for a genuinely on-screen fixed-position
element this is a no-op, but Playwright's OWN post-scroll viewport-
intersection check then intermittently reports "Element is outside of the
viewport" for an element independently confirmed (via `boundingBox()` AND a
screenshot) to be fully visible on screen. Reproducible specifically on the
Scripts drawer's "Run" button. **Fix**: bypass Playwright's actionability/
scroll choreography entirely — `locator.evaluate(el => el.click())` (a real
DOM click, no Playwright-side geometry checks). This is a test-harness
quirk of automating a fixed, taller-than-viewport SPA layout, not a product
bug — a real mouse click on the visibly-rendered button always works.

## CodeMirror content must be set via clipboard paste, never `keyboard.type()`

`closeBrackets()` intercepts TYPED characters one at a time (auto-insert/
skip-over matching brackets) — typing a multi-line script character-by-
character via `page.keyboard.type()` mangled a `while (true) {}` fixture
into a stray extra `}` (a syntax error instead of the intended infinite
loop), corrupting the FIRST security-matrix run and wasting real debug time
before the root cause was found. **Fix**: grant `clipboard-read`/
`clipboard-write` context permissions, `navigator.clipboard.writeText(code)`
+ `Meta+v` — a paste is one atomic multi-character insertion, not run
through the per-keystroke bracket-closing filter.

## Security QA matrix — all 13 items PASS, live, with measured evidence

Run against the real dev server (not Node fixtures), two-account isolation
proven, evidence summarized (full numbers in the CTO's final report to the
orchestrator, not re-duplicated here):
1. `while(true){}` → 3053–3066ms observed across 3 runs (target ~3000ms).
2. fetch/XHR/WebSocket/importScripts/indexedDB/EventSource all `typeof
   ...undefined`; canary-hostname (`ss3-canary-*.invalid`) network-request
   count = 0 for all five, confirmed via `page.on('request')` timestamped
   against the run window — the SPECIFIC-target-hostname technique is a
   stronger proof than a raw "zero requests during the window" count (the
   app's own legitimate polling would produce false positives on the
   latter).
3. `new Function('return typeof fetch')()` AND `new
   Function('return typeof globalThis.fetch')()` both resolve
   `"undefined"` inside the script — direct proof the denylist is
   environment-emptying, not language-feature-banning.
4. postMessage forgery — `page.addInitScript` monkey-patches
   `window.Worker` to dispatch a SECOND, clearly-fake `MessageEvent` ~100ms
   after the real one on the SAME worker instance. The forged payload
   (`FORGED-SECOND-MESSAGE-SS3`) never appears anywhere in the UI; the
   real, first result is what's shown — `{once:true}` + explicit
   `removeEventListener` in `finish()` hold.
5. 25k raw signals → capped at exactly 20,000, console shows `"Signal cap
   reached — showing the first 20,000 of 25,000 signals."` (the new SS3
   honesty log line, see below), stats card renders without error.
6. Deliberate syntax error on source line 3 → console reports `"Line 3:
   ..."`, not a wrapped-source line number.
7. 51st script (looped 49 API-level creates to reach the cap fast) → 422
   surfaces as a dismissible red banner in the UI, confirmed via a
   follow-up GET that the count stays at exactly 50.
8. Cross-user: account B's PATCH/DELETE against account A's script id →
   404 at the API (both methods), row provably untouched (re-listed as
   owner before/after), AND account B's own "My Scripts" DOM never
   contains account A's script name (`document.body.innerText` substring
   check) — both the API-layer and UI-layer proof, per this codebase's
   established "re-confirm at the UI layer too" discipline.
9. Draft restore — real `page.reload()` (not a soft nav). **Gotcha**: the
   workbench itself auto-restores via its own pre-existing `?workbench=`
   URL param, but `scriptDrawerOpen`/`hasOpenedScriptDrawer` are plain
   component state, NOT persisted — the Scripts drawer must be re-opened
   (re-clicking `</> Scripts`) after a real reload before the "check for a
   draft" mount effect can run at all. Both Restore (exact unsaved text
   comes back) and Discard (prompt clears, draft removed) verified as two
   independent reload cycles.
10. Template↔script alternation, repeated 4x (MA Cross template → script1
    → EMA Cross template → script2) — verified via TEXT extraction
    (`Trades\n<N>`), not pixel-position guessing (see gotcha below): each
    producer's own stats independently correct (maCrossTrades=8,
    script1Trades=1 unrealised, emaCrossTrades=10, script2 realized=1),
    and critically — running EMA Cross template did NOT touch script1's
    own still-displayed stats in the drawer (`script1StillIntactAfterTemplateRun`
    verified true) — the "neither corrupts the other" contract holds under
    REPEATED alternation, zero page errors throughout.
11. Interval switch (5m→15m) on a live script run → the SAME `isStale`
    amber banner ("Interval changed since this run...") a template run
    already gets appears on the drawer's own `StrategyStatsCard`,
    confirmed absent before the switch and present after.
12. Malformed returns — 4/4 sub-cases (bare string, `null`, array of plain
    numbers, `{index:"not a number", side:"MAYBE"}`) each resolve to the
    exact `INVALID_SCRIPT_RESULT_MESSAGE` in the console, Run button stays
    enabled/never stuck, zero page errors.
13. Rapid double-Run — see its own gotcha section below; final verdict:
    PASS via a combination of one-time reverted source instrumentation
    (proved the exact mechanism) + observable final UI state (the
    reliable, repeatable browser-level check).

## Item 13's real story — a genuinely interesting debugging arc

A naive synchronous double `el.click()` (or double `Meta+Enter` keydown
dispatch) on the Run button consistently produces only ONE `page.on('worker')`
"created" event in Playwright — this looked, at first, like the race was
unreachable through the UI. **It is not** — a one-time, immediately-reverted
instrumentation pass directly inside `script-runner.ts`'s `runUserScript`
(a `window.__ss3RunCount` counter + logging each `finish()` call's resolved
`{ok, error}` shape) proved conclusively: `runUserScript` genuinely IS
called TWICE on a synchronous double-click. Call 1 resolves
`{ok:false, error:"Script run was superseded by a newer run."}`; call 2
resolves `{ok:true}`. The mechanism works exactly as SS1 designed it.
`page.on('worker')`'s failure to report 2 workers is a Playwright/CDP
limitation, not a product gap — the FIRST worker's create-then-terminate
happens inside a window so short (~1ms, confirmed by the fact BOTH
`runUserScript` calls' synchronous portions, including `new Worker(...)`
and `worker.terminate()`, execute before either can yield to the event
loop) that its CDP target lifecycle likely never completes attachment
before being torn down. **The instrumentation was reverted before this
sprint's diff was finalized** — `git diff` on `script-runner.ts` after the
revert shows zero hunks, confirmed. The FINAL, repeatable browser-level
test asserts the user-observable contract instead: after a synchronous
double-click, the drawer's final settled state is the SECOND run's real,
completed result (`Trades\n1`, no `"position still open"` note matching a
realized round-trip) — never stuck on `"superseded"`, never stuck showing
`"Running…"`, Run re-enabled. This is what a real user would ever be able
to observe regardless of the internal mechanism, and it's what the test
now actually checks.

## Item 10's real gotcha — don't trust chart pixel positions for verification

A 373-bar 5m series compressed into a ~970px chart plot area is ~2.6px/bar
— eyeballing "is the BUY marker near index 5 or index 20" from a screenshot
is unreliable at that density (two markers ~15 bars apart can look
pixel-identical). Switched to TEXT-based extraction of the `Trades\n<N>`
figure from each producer's own stats card instead — far more precise and
scriptable. Also: a LONE `helpers.sell(...)` with no prior open position
resolves to `stats.trades === 0` and the card shows `"No signals over the
loaded bars."` (no short-selling support in this backtest context) — not a
bug, just a wrong test assumption on the first pass; fixed by pairing a
BUY+SELL for the second alternation script instead.

## SS3's own code changes (6 files, +230/-24, all green)

- **`lib/ta/user-scripts.ts`** — `signalCapMessage(total, cap)` exported
  function (not a bare string constant, since counts are only known
  post-truncation); `runScriptSync` appends it to `logs` (AFTER the
  script's own `console.log` output, never replacing it) exactly when
  `parsed.data.length > USER_SCRIPT_MAX_SIGNALS`. This is the log line QA
  flagged as missing during SS1.
- **`lib/ta/selfcheck.ts`** — 3 new assertions extending
  `checkSignalCapTruncation`: the exact cap message string present on a
  capped run, absent on an under-cap run. `ta:check` 192 → 195.
- **`code-editor.tsx`** — `onRunShortcut`/`onSaveShortcut` optional props;
  a small `keymap.of([{key:"Mod-Enter",...},{key:"Mod-s",...}])` built
  INSIDE the init effect (closures read `onRunShortcutRef`/
  `onSaveShortcutRef`, same "ref updated every render" law `onChangeRef`
  already established in this file), listed FIRST in the combined
  extensions array. **Real, verified conflict**: `@codemirror/commands`'s
  own `defaultKeymap` already binds `Mod-Enter` → `insertBlankLine`
  (confirmed by reading the installed package's compiled source directly,
  not assumed) — ordering the new keymap first in the SAME `keymap.of([...])`
  array wins the facet's key-matching race without a separate
  `Prec.highest` wrapper.
- **`script-editor-drawer.tsx`** — new `open`/`shortcutsSuppressed` props;
  `handleRunShortcut`/`handleSaveShortcut` mirror the toolbar buttons' own
  `canRun`/`isDirty` enabled-conditions exactly (never a parallel rule
  set), wired to `CodeEditor`'s new props for the in-editor path. A
  SEPARATE `document`-level keydown listener covers "elsewhere in the
  drawer" — attached/detached only on `open` toggling (a stable, minimal
  dep array), reading the two handlers through refs reassigned every
  render (`handleRunShortcutRef`/`handleSaveShortcutRef`) so live
  `candles`/`interval`/`source` changes from polling never go stale inside
  a closure the effect itself doesn't re-subscribe for. Skips when
  `event.defaultPrevented` is already true (CodeMirror's own keymap
  already handled it). `Mod-s` always `preventDefault()`s regardless of
  suppression state, so the native Save-page dialog can never leak through
  even when the action itself is suppressed by a higher-priority overlay.
- **`chart-workbench.tsx`** — 2-line addition: passes
  `open={scriptDrawerOpen}` and
  `shortcutsSuppressed={Boolean(textPopover || intentPopover || contextMenu)}`
  into `ScriptEditorDrawer` — reuses the SAME three overlay-state variables
  the pre-existing Escape-priority-chain effect already tracks, no new
  state introduced.
- **`script-list-sidebar.tsx`** — "No scripts yet" empty state upgraded
  from a static hint line to a real clickable CTA (icon + "Write your
  first script" + subtext, `onClick={onOpenNew}`) matching the brief's
  suggested copy while keeping the "+"-pointing spirit
  `signals-table.tsx`'s own empty state established; T5's narrow-viewport
  stacking (`w-full sm:w-[200px]`, `flex-col sm:flex-row` on the parent
  row, `max-h-[160px] sm:max-h-none` on the sidebar so it can't dominate a
  short viewport). "No signals produced" needed ZERO code changes — a
  script run with 0 net trades already flows through the SAME shared
  `StrategyStatsCard` template runs use, which already shows "No signals
  over the loaded bars." — reused for free, confirmed live.

## T5 — narrow-viewport finding, confirmed both by code AND a live screenshot

`workbench-maximize-button.tsx` and `chart-workbench.tsx` have ZERO
pre-existing responsive gating anywhere (`grep` for `sm:`/`md:`/`matchMedia`
in the former returns nothing; the latter's top toolbar only has
`flex-wrap`, no breakpoint logic at all). Confirmed live at 390×844: the
workbench's OWN pre-existing chrome (chart canvas + Ticket/Strategy
right-panel) visibly breaks — "Trading moved off the chart" banner
overlaps "ORDER TICKET" text, Buy/Delivery/Qty selects overflow-squish, the
left tool rail clips. This is genuine, pre-existing, out-of-scope-for-SS3
behavior (SS3's mandate per the brief's own framing is the Scripts drawer
specifically, not a workbench-wide responsive redesign) — documented
honestly rather than silently left for a future reader to rediscover. The
DRAWER itself, with T5's added Tailwind breakpoint classes, stacks
list-above-editor correctly at this same width, all its own content
(toolbar buttons via existing `flex-wrap`, My Scripts/Examples, the
CodeMirror editor) stayed readable and functional, and `document
.documentElement.scrollWidth <= window.innerWidth` (no horizontal
overflow) — the brief's stated minimum bar ("doesn't break" for the
drawer specifically) is met.

## Deploy verification — real standalone build, both chunk types confirmed

`rm -rf .next && npm run build` (clean, no stale dev/prod mix). Worker
chunk located NOT by filename (production webpack uses pure content-hash
chunk ids, no descriptive names — `4651.5c8c6a0951274268.js`, unlike
`next dev`'s verbose `_app-pages-browser_..._strategy-worker_ts.js`) but by
CONTENT (`grep` for `"Malformed request to strategy worker"`, the worker's
own literal string). CodeMirror-touching chunks similarly found via
content grep (`cm-content`/`cm-scroller`/`cm-focused`) across
`1691.401ebf793b9c1fac.js` + `baeaa4ff.5d450fd6d6a83862.js`. Mirrored the
Dockerfile's exact copy steps (`standalone/` + `standalone/apps/web/.next/static`
+ the `.prisma` client dir) and ran `node apps/web/server.js` on a spare
port (3010) with `NODE_ENV=production` — both chunk types served 200 with
correct `content-type: application/javascript; charset=UTF-8`, content
verified via the same string greps against the LIVE HTTP response, not
just the file on disk.

**Live three-terminal parity spot check** (against the standalone server,
not `next dev`) — for each of `/paper-trading` (TCS), `/paper-trading/futures`
(NIFTY default), `/paper-trading/options` (NIFTY default underlying):
ran the real "MA Cross" TEMPLATE via the Strategy tab, separately
Duplicated-then-Ran the shipped "MA Cross" EXAMPLE SCRIPT (not a hand-typed
reimplementation) on the same instrument/interval, compared `Trades\n<N>`
from each. All three terminals: exact match (dashboard 8=8, futures 9=9,
options 9=9) — the live, end-user-facing version of SS2's own Node-level
parity fixtures, now proven live on the deployed artifact shape.

## Bundle size — confirmed ~byte-identical, git-stash-before/after method

Stashed SS3's 6 files (`git stash push --` with explicit root-relative
paths from repo root, the exact discipline SS2's own memory documents to
avoid the double-prefix pathspec bug), rebuilt for a "before" baseline,
popped the stash, rebuilt again for "after." Delta across all three
`/paper-trading*` routes: **-1 byte** (noise-level, not a real
measurement) — SS3's additions (keyboard shortcut wiring, the empty-state
markup, the responsive Tailwind classes, `signalCapMessage`) either live
entirely inside the ALREADY-lazy `script-editor-drawer` chunk (not part of
First Load JS at all) or are genuinely negligible. `react-loadable-manifest.json`
still shows the identical 2-entry nesting SS2 established
(`chart-workbench.tsx -> ./chart-workbench` at level 2,
`chart-workbench.tsx -> ./user-scripts/script-editor-drawer` at level 3).

## SS2's two flagged deviations — accepted as-is, no rework this sprint

Per explicit orchestrator instruction: SS2's results-card placement
(stacked below the editor in the SAME middle column, not a third
horizontal column — the CTO layout call documented in SS2's own memory)
and the CodeMirror budget deviation (~150-160KB gz vs. the brief's
unmeasured 80KB target, root-caused to `@codemirror/lang-javascript`'s
lezer grammar tables, not a tuning miss) are BOTH accepted permanently.
Nothing in either area was touched this sprint.

## Final gate numbers

- `ta:check`: 192 → 195 (3 new: cap-message-present-when-capped,
  cap-message-absent-when-not-capped, under-cap-still-resolves-ok).
- `tsc --noEmit`: clean, `apps/web`, run from a clean state after all
  build/stash churn (not trusted from a stale run).
- `eslint` (`next lint`): zero errors; the only 3 warnings in the whole
  repo are pre-existing and in files this sprint never touched
  (`quote-header.tsx`, `create-market-form.tsx`, `components/ui/avatar.tsx`).
- Engine (`apps/api/scripts/verify-papertrading-engine.ts`, run from
  `apps/api/`): 264/264, untouched — zero order-engine math anywhere
  across all three scripting sprints.
- First Load JS: 138.2/136.6/142.8 kB (SS2's own closing numbers) →
  effectively unchanged this sprint (-1B, noise).
- `git diff --stat` on the 6 touched files: `+230 -24`, byte-scoped,
  `packages/business-rules` and both `prisma/schema.prisma` files
  untouched (confirmed via `git diff --stat` returning empty for both).

## Cleanup discipline for whoever re-runs this matrix

Both disposable accounts (`ss3-a@papertrading-qa.test`,
`ss3-b@papertrading-qa.test`) were `DELETE FROM "User"` at session close
(cascades to `UserStrategyScript`/`PaperTradingAccount` via the schema's
own `onDelete: Cascade` — confirmed zero rows left via a follow-up count
query before deletion, not assumed). The scratch Playwright scripts lived
in a throwaway `apps/web/.ss3-scratch/` directory (never committed,
`rm -rf`'d at the end) plus a couple of `/tmp` files — neither survives
this session. `npm install --no-save playwright` leaves the package
physically in the hoisted `node_modules` for a future session's
convenience but touches no tracked file.
