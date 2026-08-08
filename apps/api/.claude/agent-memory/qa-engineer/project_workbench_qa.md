---
name: project-workbench-qa
description: Charting Workbench (W1+W2+W3) full-program QA runtime pass 2026-08-01 — overall PASS, all 8 checks (A-H) clean against LOCAL dev DB with disposable test data. Zero bugs found; three minor non-blocking findings noted for the CTO.
metadata:
  type: project
---

Runtime + static QA for the full 3-sprint Charting Workbench program
([[project_workbench_program]], CTO notes `project_workbench_w{1,2,3}.md`)
ran 2026-08-01 against the LOCAL dev Postgres DB, code still uncommitted
(working tree diff on top of `3dbb722`). Overall verdict: **PASS**, all 8
checks (A-H) clean. This is the second consecutive zero-bug first-pass QA
result in this codebase (matching [[project_chart_trading_sl_tp_qa]]'s
precedent) — the CTO's extremely detailed, independently-verified sprint
notes (real klinecharts v10 API reads, not assumed) matched the actual code
on every point checked.

**Preflight**: `ChartDrawing` confirmed present in BOTH the DB
(`\d "ChartDrawing"` via psql) AND the generated Prisma client
(`node_modules/.prisma/client/index.d.ts`, 667 hits) — the api dev server's
own `predev` hook (`prisma generate`) refreshed the client at server start,
so [[feedback_prisma_generate_before_server]]'s systemic risk class did NOT
recur here. Note for future QA: `node_modules/@prisma/client/index.d.ts` is
a thin re-export in this repo — always grep `node_modules/.prisma/client/index.d.ts`
for the real generated types, the `@prisma/client` path alone can give a
false "0 hits" alarm.

**Check A (engine) — PASS.** `verify-papertrading-engine.ts` run directly
(not trusted from notes): 264/264, run from `apps/api/` (running from repo
root 404s on the `@/` path alias — use `cd apps/api && npx tsx
scripts/verify-papertrading-engine.ts`).

**Check B (candles API) — PASS, live HTTP, both layers.** RELIANCE 1m/5m/1d
+ NIFTY 1m/1d + all 5 index underlyings (NIFTY/BANKNIFTY/FINNIFTY/
MIDCPNIFTY/NIFTYNXT50): ascending timestamps, zero dupes, all OHLC finite
>0, high/low bounds held on every bar, 1d depth >1000 bars (1239 RELIANCE,
1235 NIFTY — real 5y history), prevClose present, Cache-Control 60s
intraday / 300s daily exactly. Error cases: interval=7m→400, missing
interval→400, NOTASYMBOL→404, bad index symbol→400. Proxy body byte-equal
to direct body modulo `asOf`. **Non-blocking finding**: the `apps/web`
candles proxy does NOT forward the upstream `Cache-Control` header (its
`NextResponse.json(body, {status})` never copies response headers) — this
matches the EXISTING intraday proxy's own behavior (the candles proxy's own
doc comment says it was "copied verbatim" from that file), so it's
consistent precedent, not a regression. Not flagged as a failure.

**Check C (drawings CRUD) — PASS, live HTTP, 2 real session-authed users.**
Full round-trip on `EQ:RELIANCE`: POST 201→GET lists it→PATCH bumps
`updatedAt`→DELETE removes it, re-GET confirms gone, re-PATCH 404s. Batch
DELETE: seeded 2 rows on `EQ:TCS` + 1 on `INDEX:NIFTY`, `DELETE
?chartKey=EQ:TCS` returned `deletedCount:2` and left `INDEX:NIFTY`'s row
untouched. 200-row cap: scripted 200 real POSTs to `EQ:CAPTEST`, the 201st
correctly 422'd with the exact cap message, cleaned up via one batch
DELETE (`deletedCount:200`). Cross-user isolation: user2's GET for user1's
chartKey returns an empty list (never leaks the row's existence), user2's
PATCH/DELETE by id both 404 (never 403 — matches the route's own documented
"miss and cross-user id are indistinguishable" design), user1's row
unaffected by the failed cross-user attempts. All 5 endpoints 401
unauthenticated. **Non-blocking finding**: the checklist's own wording
expected 422 for bad-overlayName / bad-chartKey-prefix / 11-point-array,
but the route actually returns **400** for all three (zod
`safeParse.success===false` → 400; the route reserves 422 exclusively for
the 200-row business-rule cap). Verified this is the established, consistent
codebase convention by grepping the sibling `pending-orders` route (the
route this CRUD route's own doc comment says it mirrors) — same 400-for-
schema-failure pattern there too. Not a bug, not flagged as a failure; the
checklist's expected-status wording was imprecise, not the code.

**Check D (premium aggregation) — PASS, unit-level, real imported
function.** `npx tsx` importing `aggregatePremiumCandles` directly (not
reimplemented): empty input→empty output; a 4-snapshot bucket gives
O=first/H=max/L=min/C=last with the bucket-START timestamp (not the first
point's own timestamp); a boundary case at exactly 3 snapshots renders; a
2-snapshot bucket and a bucket left with <3 valid snapshots after filtering
out non-finite/≤0 prices are both silently dropped (never a fabricated flat
bar); `volume` is always 0.

**Check E (custom overlays + toolbar consistency) — PASS, verified
byte-for-byte against the installed klinecharts@10.0.1 `dist/index.esm.js`,
not trusted from CTO notes.** Independently extracted the real built-in
overlay `extensions` array from the minified dist bundle: exactly 16 names
(`fibonacciLine, horizontalRayLine, horizontalSegment,
horizontalStraightLine, parallelStraightLine, priceChannelLine, priceLine,
rayLine, segment, straightLine, verticalRayLine, verticalSegment,
verticalStraightLine, simpleAnnotation, simpleTag, brush`) — set-equal to
`custom-overlays.ts`'s `BUILT_IN_DRAWING_OVERLAYS`. `ALL_DRAWING_OVERLAYS`
(16+4=20) is set-equal to `packages/validation/src/chartDrawings.ts`'s
`CHART_DRAWING_OVERLAY_NAMES` (20) AND to `workbench-toolbar.tsx`'s
`TOOL_GROUPS` flattened (20, zero dupes) — true three-way consistency, not
just a count match. `registerOverlay()`'s real signature
(`OverlayTemplate<E>`, read from `dist/index.d.ts`) accepts every field the
4 custom overlays pass (`totalStep`, `needDefaultPointFigure`,
`needDefaultXAxisFigure`, `needDefaultYAxisFigure`, `createPointFigures`).
`totalStep` values confirmed correct by the pointCount+1 rule: rect=3 (2pt),
arrow=3 (2pt), abcd=5 (4pt), xabcd=6 (5pt). `pfOrderLine` (the order-
execution line) is registered in `order-line-overlay.ts` but grepped absent
from `chartDrawings.ts`'s enum — confirmed it can never be persisted as a
drawing.

**Check F (persistence flow) — PASS, source-verified, one correctness
claim independently re-derived from the klinecharts source (not trusted
from CTO notes).** `use-chart-drawings.ts`'s `create()` is only ever called
from `kline-chart.tsx`'s draw-start effect's `onDrawEnd` handler — that
handler is wired ONLY on freshly-created overlays (`createOverlay({...,
onDrawEnd})` in the active-tool effect); hydrated overlays (the drawings-
hydration effect) build their event handlers from the SAME
`buildDrawingEventHandlers()` helper but never include `onDrawEnd`, so a
loaded row can never re-POST. PATCH is 500ms debounced, latest-wins,
independent timers per drawing id (confirmed in source). `onRemoved`'s
DELETE path is guarded by `suspendDrawingSyncRef` (checked first thing in
the shared handler) for hydration-cleanup and clear-all — AND, independently
re-derived directly against `node_modules/klinecharts/dist/index.esm.js`
this session (not just trusted from the CTO's memory note): `StoreImp
.prototype.destroy` (invoked by the module-level `dispose()` function that
`kline-chart.tsx`'s unmount cleanup calls) does `this._overlays.clear()` —
a bare `Map.clear()` — and NEVER calls `StoreImp.prototype.removeOverlay`
(the ONLY function that actually invokes `overlay.onRemoved`, confirmed by
reading its body). This means workbench-close/unmount is doubly protected
against a cascade-DELETE: the suspend-ref guard covers in-session
programmatic removals, and klinecharts' own `destroy()` never fires
`onRemoved` at all on unmount, independent of any app-level guard. Clear-all
= per-id `removeOverlay` (suspended) in a loop + exactly ONE
`drawingsHook.clearAll()` batch DELETE, confirmed by direct wiring read
(`chart-workbench.tsx`'s `onAllDrawingsCleared={drawingsHook.clearAll}`).
Unknown `overlayName` rows are skipped on load (`!ALL_DRAWING_OVERLAYS
.includes(row.overlayName)` guard). Dep-array audit: the only
object-identity-keyed effects are (1) the `orderLines` sync — carries
W2's already-documented one-way-sync justification, re-read and still
holds (nothing in its body calls a prop callback); (2) the drawings-
hydration effect, keyed on `drawings` — explicitly documented in-file with
the same one-way-sync reasoning, and independently traced: the ONE thing
that could make `drawings` change from inside a one-way sync (a fresh
draw's `create()` call re-appending to the `drawings` state array) is
pre-empted by `hydratedRowIdsRef` being set synchronously in the SEPARATE
draw-start effect's own `.then()`, before the hydration effect re-runs, so
its second pass is a genuine no-op, not a second create. **Non-blocking
finding**: the data-load effect (full-reload vs tail-advance) lists
`candles` itself in its dependency array (`[interval, firstTs, lastTs,
count, candles]`) despite the file's own module-doc and effect-comment
explicitly claiming "keyed on PRIMITIVES only ... never `candles`' own
array identity." Traced why: `firstTs`/`lastTs`/`count` alone can't detect
an intrabar OHLC tick where the LAST candle's timestamp is unchanged but its
open/high/low/close values just updated (a live poll response) — without
`candles` in the deps, that live tick would never reach the chart via
`subscribeBar` until the next full bar started. This is necessary and safe
(the effect never calls a prop callback that would recreate `candles`, so
it cannot cycle) — not a functional bug, just a stale/incorrect doc comment
worth a one-line fix.

**Check G (bundle + SSR) — PASS, verified against a fresh
`next build` production artifact (killed the dev server first to avoid
`.next` contention, restarted neither afterward since no further HTTP
checks needed it).** First Load JS for all 3 terminal pages matched the
CTO's own claimed numbers exactly: dashboard 136kB, futures 135kB, options
140kB. `react-loadable-manifest.json` has exactly ONE entry
(`workbench-maximize-button.tsx -> ./chart-workbench`), 2 chunk files: a
231KB vendor chunk containing the `candle_pane` marker (klinecharts) and a
34.8KB app-code chunk containing both `xabcd` and `pfHitLine` markers (W3's
custom overlays landed in the SAME async chunk as W2's order-line code, as
the CTO's notes claimed). Cross-checked `app-build-manifest.json`'s
synchronous file lists for `/paper-trading`, `/paper-trading/futures`,
`/paper-trading/options` — zero hits for either chunk file on any of the 3
pages. All 3 terminal client components import ONLY
`DynamicChartWorkbench`/`WorkbenchMaximizeButton` from
`workbench-maximize-button.tsx` (never `chart-workbench.tsx` or
`kline-chart.tsx` directly) — confirmed via grep, so nothing bypasses the
dynamic-import boundary.

**Check H (regression) — PASS.** `price-chart.tsx` / `terminal/premium-
chart.tsx` and the `instruments`/`indices`/`bonds` page directories: `git
status --porcelain` and `git diff --stat` both empty — byte-identical to
`3dbb722`. Plain market equity BUY: Saturday market-hours gate blocks the
real HTTP route AND `placeOrder()` itself (the gate is inside the lib
function, not just the route), so reproduced the exact
`computeOrderCosts()` call + a real fetched RELIANCE tick from the same
upstream `fetchDelayedLtp()` itself calls, wrote the `PaperOrder` row
directly, and re-derived cash via the SAME `deriveCash()` replay function
`placeOrder()` uses — delta matched `-costs.netAmount` to 7e-10 (a Postgres
float8 round-trip artifact, well inside the epsilon-compare convention
[[project_paper_trading_limit_orders_qa]] established). Pending-orders PATCH
reprice route (touched by nothing in this program): 401 unauthed, 404 for a
nonexistent id authed — untouched and healthy.

**Static checks re-run independently (not trusted from CTO notes)**:
`npx tsc --noEmit` clean for both `apps/web/tsconfig.json` and
`apps/api/tsconfig.json` (zero output = clean).

**Test users**: `qa-wb-runner-1@papertrading-qa.test` (id
`cmsan8e0r0000sisi9ret0e40`) + `qa-wb-runner-2@papertrading-qa.test` (id
`cmsan8e1l0001sisiagma7ssu`), 1 `PaperTradingAccount` (auto-created on
first `/api/paper-trading/account` GET), 1 throwaway `PaperOrder` row (the
Check-H regression order, deleted within the same script run) — all
deleted; re-query proof 0 for both users, 0 for a GLOBAL `ChartDrawing`
count (the table only ever had this session's own rows — confirmed empty
before AND after). 4 throwaway `apps/api/scripts/qa-wb-*.ts` scripts
deleted, confirmed via `git status --porcelain | grep qa-wb` (empty). Both
session cookie jars deleted from `/tmp`. Both dev servers (3000 killed
before the production build; 3001 killed at session end) confirmed free via
`lsof`.

**Methodology notes for next time**: (1) this repo's root `npm run dev`
resolves to `apps/api`'s dev script specifically (not a multi-app
concurrently runner) — `cd apps/web && npm run dev` separately for the web
app; don't assume root `npm run dev` starts both. (2) a production
`next build` and an active `next dev` on the same port/`.next` directory
will contend — kill the dev server first, and only restart it if a later
check in the SAME session still needs live HTTP (this session didn't, so it
stayed down). (3) When a checklist's expected HTTP status code doesn't
match live behavior, check the codebase's own established convention on a
sibling route before treating it as a failure — a route's own doc comment
saying "mirrors X route" is a fast way to find the precedent.

**How to apply**: this closes QA for the 3-sprint Charting Workbench
program ([[project_workbench_program]]). Per that program's own closing
note, report back to CEO for a 30-day usage review before any follow-on
scope (which drawing tools get used, real XABCD usage, whether the premium
workbench mode gets opened at all) — do not extend on assumption. Zero
source files were edited this session (every fix-shaped finding was
non-blocking), so no CTO re-work is required before this ships.
