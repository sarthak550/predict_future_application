---
name: project-ta-suite-qa
description: Technical Analysis Suite (S1 drawings + S2 indicators + S3 strategies/backtest) full-program QA 2026-08-02 — overall PASS, all 7 checks (A-G) clean. Third consecutive zero-bug first-pass QA result in this codebase.
metadata:
  type: project
---

Runtime + static QA for the full 3-sprint TA Suite program
([[project_ta_suite_s1]]/s2/s3 CTO notes, `apps/web/.claude/agent-memory/
cto-lead-developer/`) ran 2026-08-02 against the LOCAL dev Postgres DB,
code still uncommitted. Overall verdict: **PASS**, all 7 checks (A-G)
clean. Matches [[project_workbench_qa]] and
[[project_chart_trading_sl_tp_qa]]'s precedent — third consecutive
zero-bug first-pass result; this CTO's detailed, independently-verified
klinecharts-internals notes keep matching the actual code on every point
checked.

**Check A (static gates) — PASS.** tsc clean across apps/web, apps/api,
and all 4 packages (validation/types/api-client/business-rules). eslint
clean on a 19-file sample of every new S1/S2/S3 module. `verify-
papertrading-engine.ts` 264/264. `npm run ta:check` 59/59 (re-run
independently, not trusted from CTO notes). klinecharts import grep:
every hit confined to `workbench/` or `lib/ta/` (and in `lib/ta/`, only in
COMMENTS — `strategies.ts`/`math.ts`/`selfcheck.ts` deliberately have zero
real klinecharts imports, confirmed by grepping for actual import
statements vs doc-comment mentions). Fresh `next build`: First Load JS for
all 3 terminal pages matched the claimed 136/135/140 kB EXACTLY;
`react-loadable-manifest.json` has exactly ONE dynamic-import entry
(`workbench-maximize-button.tsx -> ./chart-workbench`).

**Check B (backtest math, independent verification) — PASS, 34/34
assertions, zero reimplementation of `computeOrderCosts`.** Hand-built a
3-trade DELIVERY fixture (2 closed incl. one loss, 1 open-at-end) with
clean round-number prices, called the REAL `runBacktest()` and REAL
`computeOrderCosts()` directly (both legs, `isFirstDeliverySellOfScripToday:
true` per D7), cross-checked entryCosts/exitCosts/grossPnl/netPnl per
trade, aggregate net=gross-totalCosts identity, winRate (over closed
trades only), buyHold (independent of signals), and maxDrawdownPct against
an INDEPENDENTLY reconstructed bar-by-bar equity curve (a second,
differently-shaped implementation, not `runBacktest`'s own internals
copy-pasted). Also verified: 0-signal series -> all zeros + `winRatePct
=== null` (not NaN/0); leading-SELL dropped (surviving trade enters at the
BUY, not the dropped SELL); open-at-end trade has `exitCosts: 0` and
`openAtEnd: true`.

**Check C (strategy signal correctness) — PASS, 0 failures across a
hand-traced fixture + a real-RSI-data spot-check + a 35-combination
property sweep.** `maCross[2,3]` hand-traced on a 10-bar series (chosen so
SMA2/SMA3 tie on several bars, deliberately exercising the "tie breaks a
run without emitting" path) — exact signal index/side/price matched by
hand. `rsiReversal` threshold-crossing: engineered a price path that
pushes real (hand-verified, S2-era) `rsi()` output through an oversold dip
then a 30+ bar sustained recovery — independently identified every
`prev<=30&&r>30` / `prev>=70&&r<70` edge-crossing from the raw RSI array,
routed through the SAME shared `finalizeSignals()` the code uses (a first
attempt without this step produced a false failure — a lone SELL crossing
with no prior BUY IS correctly dropped as a "leading SELL," which is
`finalizeSignals()` working as documented, not a bug), and confirmed exact
match. Property sweep: all 7 strategies x 5 seeded random walks (300 bars
each, realistic OHLC) — zero violations of "signals sorted ascending,"
"no two consecutive same-side signals" (alternating-dedup), and "first
signal is never a leading SELL."

**Check D (drawings CRUD round-trip) — PASS, live HTTP, 2 real
session-authed users, LOCAL dev DB.** Full round-trip on `EQ:QATASUITE`:
POST all 8 sample new-family overlays (andrewsPitchfork/fibExtension/
elliottImpulse/headAndShoulders/longPosition/calloutText-with-pfContent.text/
emojiSticker-with-pfContent.emoji) all 201; GET lists all 8; PATCH styles
on andrewsPitchfork round-trips exactly (`{"line":{"color":"#ff00ff",
"size":3}}` persisted verbatim, `updatedAt` bumped); OLD name `segment`
still POSTs fine; a fake name (`fakeFutureOverlayName`) 400s with the zod
enum-mismatch message. Unknown-name hydration skip verified BOTH ways: a
hand-inserted Prisma row (`overlayName: "someFutureUnknownOverlayName"`,
bypassing zod entirely) DOES come back through GET unfiltered (the route
has zero overlayName filtering — confirmed live), and the actual skip is
purely client-side (`kline-chart.tsx`'s hydration effect, `if
(!ALL_DRAWING_OVERLAYS.includes(row.overlayName)) continue`) — source-read,
not runtime-testable without a browser. 200-row cap: scripted 201 real
POSTs to a dedicated chartKey, got exactly 200x201 + 1x422 with the exact
cap message. Cross-user isolation: user2's GET for user1's chartKey
returns 0 rows (never leaks existence), user2's PATCH/DELETE by id both
404 (never 403), user1's row unaffected after the failed cross-user
attempts. Cleanup: 209 ChartDrawing rows + 2 users deleted, re-query proof
0 for both, GLOBAL ChartDrawing count 0 (table was empty before AND after
this session).

**Check E (source-verified UI mechanics) — PASS, no live browser this
session (matches the CTO's own posture).** Dep-array audit of every NEW
effect in `kline-chart.tsx`: the indicator-sync effect and the S3 PF_SIGNALS
sync effect are BOTH keyed on `JSON.stringify(...)`-derived STRING keys
(`mainInstanceKey`/`subInstanceKey`/`signalsKey`), never on array/object
identity — genuinely safe, not just documented-safe. Two PRE-EXISTING
object-identity-keyed effects (`orderLines`, `drawings` hydration) carry
already-audited one-way-sync justification (re-confirmed, unchanged from
[[project_workbench_qa]]'s prior pass). Two S1 effects
(`drawingStyleCommand`, `removeDrawingCommand`) ARE object-identity-keyed
but use an internal nonce-guard (`if (nonce === lastRef) return`) that
makes them safe by a DIFFERENT valid mechanism than "one-way sync" — not
explicitly labeled as such in the comment, but functionally sound;
flagged as a minor non-blocking doc-precision note, not a bug. Ticket
single-mount: confirmed `{ticket}` (chart-workbench.tsx line ~630) is
rendered with ZERO conditional gate, only a CSS `display:block/none` toggle
keyed on `rightPanelTab` — never unmounted. Disclaimer: confirmed
`StrategyDisclaimerFooter` renders as a SIBLING outside both CSS-hidden tab
wrappers, so once shown it survives tab switches with no `display:none`
ever applied to it — but it IS gated behind `hasOpenedStrategyTab` (a
one-time sticky boolean, never resets false) so it does NOT render before
the Strategy tab has ever been opened once. This satisfies the brief's
"remains visible in BOTH tab states" acceptance criterion exactly as
worded (both states = after first open); flagged this nuance explicitly
rather than silently assuming "renders unconditionally from initial
mount." PF_SIGNALS (`pf-signals.ts`): confirmed `figures: []` and zero
event-handler properties anywhere in the `IndicatorTemplate` object — only
`calc`/`createTooltipDataSource`/`draw` (canvas-paint only, returns `true`).
WMA/VWMA/HMA migration path: confirmed `reclassifyByPane()` called at the
end of BOTH `migrateStoredSelection()` branches (v1 and v2) via source read
AND a live migration test (Check G's G1).

**Check F (registry consistency) — PASS, 0 failures, programmatic set
comparison (not eyeballed).** `CHART_DRAWING_OVERLAY_NAMES` (62) ===
`ALL_DRAWING_OVERLAYS` (62) exactly (zero diff either direction).
`TOOL_REGISTRY` keys (63) === catalog + `"highlighter"` exactly — the
alias is confirmed present in TOOL_REGISTRY but absent from the 62-name
catalog/validation enum, as designed. `INDICATOR_REGISTRY` = 41 entries
(27 built-in + 14 custom, both counts exact), all 6 categories present,
premium-gate set exactly the 10 names VOL/OBV/PVT/EMV/VR/AVP/VWAP/VWMA/
MFI/CMF (derived from the registry's own flags, set-equal to the brief's
named list).

**Check G (localStorage migrations) — PASS, 0 failures, script-level
`migrateStoredSelection` calls.** v1 blob with WMA/VWMA filed under `sub`
(pre-S3 pane) -> both reclassified to `main`, RSI stays under `sub`,
pre-existing main entries survive. v2 blob with an unknown indicator name
-> silently dropped, known names survive alongside. v2 blob with 6 sub
entries (cap 4) -> clamped to exactly 4, FIRST 4 in original order kept
(not an arbitrary subset). Garbage/unrecognized shape -> `null` (not a
crash, not a silently-empty selection). v1 blob with an unknown name ->
also dropped, same as v2.

**Test users**: `qa-ta-runner-1@papertrading-qa.test` (id
`cmsc1f0vh0000lcwshwhbc1kl`) + `qa-ta-runner-2@papertrading-qa.test` (id
`cmsc1f0wd0001lcws4f6nmwxx`) — both deleted, proof above. 3 throwaway
`apps/api/scripts/qa-ta-*.ts` scripts deleted, confirmed via
`git status --porcelain`. 2 throwaway `apps/web/lib/ta/qa-verify-*.ts` +
1 `apps/web/components/.../workbench/qa-verify-registries.ts` script also
deleted (used for Checks B/C/F/G — Node-run via `tsx`, never a route, never
committed). Both dev servers (3000, 3001) confirmed killed and ports free
via `lsof`.

**Methodology note — tsx module resolution for a script OUTSIDE the repo's
own directories fails silently on workspace-package named exports.**
Running `npx tsx /tmp/foo.mts` (or even `/tmp/foo.ts`) that imports a
`@predict-future/*` workspace package, OR that imports a same-repo `.ts`
file via an ABSOLUTE path, threw `SyntaxError: ... does not provide an
export named 'X'` even though the export unambiguously exists — this is
NOT a real problem with the target file (confirmed by literally the same
import line working fine inside `lib/ta/selfcheck.ts`, run in place).
Root-caused to two independent things: (1) a `.mts` extension makes Node
treat the file via a stricter native-ESM path that doesn't get tsx's usual
CJS-interop export detection — rename to plain `.ts` and re-run with `tsx`
fixes it; (2) bare package-specifier imports (`@predict-future/...`) only
resolve when the SCRIPT'S OWN location is inside a directory whose
`node_modules` ancestry reaches the repo's `node_modules/@predict-future/*`
symlinks (Node's normal upward resolution) — a script parked in `/tmp`
never finds them regardless of `cwd`. Fix used this session: always place
throwaway verification scripts INSIDE the actual app directory (e.g.
`apps/web/lib/ta/qa-verify-*.ts`, `apps/web/components/.../workbench/
qa-verify-*.ts`) with plain `.ts` extension and RELATIVE imports for
same-package files, run via `npx tsx <path>` from that app's root — then
delete before finishing. Worth remembering for any future check that needs
a throwaway Node script importing real project code with workspace-package
dependencies.

**How to apply**: this closes QA for the full 3-sprint TA Suite program
([[project_ta_suite_s1]]/s2/s3). Zero source files were edited this
session (every finding was non-blocking/informational), so no CTO re-work
is required before this ships. Per house discipline, recommend a 30-day
usage review before proposing further TA-suite scope (which drawing tools
get used, whether the strategy/backtest panel gets opened at all) before
extending — matches the CTO's own closing note in `project_ta_suite_s3`.
