---
name: project_strategy_results_ui_capital_margin_qa
description: TradingView-style Strategy Results UI (Ideal/Real toggle, capital-efficiency + margin engine fields) — PASS 2026-08-07, ta:check 575, engine 275.
metadata:
  type: project
---
Backtest engine capital-efficiency/margin extension (`peakDeployedCapital`,
`avgDeployedCapitalPct`, `returnOnPeakCapitalPctGross/Net`, `marginModel`,
`avgMarginUsedPct`, `peakMarginUsedPct`, `EquityPoint.grossEquity`) +
TradingView-style Results UI (Overview/Performance/Trades sub-tabs, Ideal/Real
toggle, shared by the Strategy tab and the scripts-drawer Results tab via the
rewritten `StrategyStatsCard`, `data-testid="strategy-stats-card"`). Reviewed
uncommitted 2026-08-07 (`apps/web/lib/ta/backtest.ts`, `selfcheck.ts`,
`strategy-panel.tsx`, `components/paper-trading/workbench/backtest-results/*`).

**Verdict: PASS.** Independent fixture (own numbers, deliberately different
shape from the CTO's `selfcheck.ts` fixtures: notional=50000, WIN+LOSS+one
OPEN trade, a tie between two trades' deployed capital) — 26 hand-derived
assertions against the REAL `runBacktest()`, run under BOTH DELIVERY and
INTRADAY, all passed: peak/avg deployed capital, return-on-peak-capital
gross&net (net cross-checked via independent calls to the real
`computeOrderCosts`, not trusting the engine's own internal calls),
marginModel flip, avgMarginUsedPct===avgDeployedCapitalPct under both models
(no-leverage-model honesty law), and — the important one —
`grossEquity`/`equity` reconstructed bar-by-bar independently and diffed
exactly; "never drifts from net series' trade timing" proved via the
`grossEquity-minus-equity == cumulative realized costs at every bar`
invariant (not just spot-checking final values). `Number.isFinite` walk (not
`JSON.stringify`, which silently turns NaN/Infinity into `null` and would
mask this exact bug class) found zero non-finite fields. `ta:check` 575/0,
engine self-check (`apps/api/scripts/verify-papertrading-engine.ts`) 275/0 —
both match the CTO's claimed counts.

**Live UI verification (Playwright, kira@example.com, RELIANCE 1D MA Cross
template, both fresh `next dev` servers on spare ports — see gotcha below)**:
Overview headline P&L₹ == Trades-table net-column sum exactly (₹3,577 both).
Toggle Ideal↔Real switches every number coherently (gross≥net for a
profitable run everywhere it should: return%, P&L₹, profit factor,
expectancy, avg win, return-on-peak-capital; avg/largest LOSS correctly more
negative net than gross — costs make losses worse). Max drawdown/run-up rows
correctly stayed IDENTICAL across the toggle (net-only, no gross variant, as
documented) in both the Performance grid AND the Overview tile's "(net)"
label. INTRADAY margin disclaimer rendered correctly after switching product
type (5m interval + rerun); margin model label flipped
Delivery→"Intraday — full notional (no leverage model)". Script-drawer run
(duplicated the "MA Cross" example, ran on the same instrument/interval/
default params) produced BYTE-IDENTICAL stats to the template run — strong
end-to-end proof both `StrategyStatsCard` call sites (template path via
`handleRunStrategy`, script path via `runUserScript`) funnel into the
identical `runBacktest()` with zero divergence. `data-testid` scoping: two
card instances coexist in the DOM once the Scripts drawer is open (main
card in the right panel, scrolled off-screen but present; drawer's own
card) — NOT cross-contamination, just two independently-scrollable,
independently-`useState`'d instances of the same shared component (each
`StrategyStatsCard` call has its OWN local `view`/`tab` state, confirmed by
reading the component — no module-level or context state to leak between
them).

**Buy&hold-overlay-honesty method note (reusable)**: my FIRST attempt
compared the rendered SVG `<path>` `d` attribute string between Real and
Ideal — it came back DIFFERENT, which looked like a bug. Root cause: the
chart's Y-axis auto-fits to `[...displayed, ...buyHold]`, and `displayed`
IS view-dependent (gross vs net equity) — so the axis range legitimately
shifts between views, which reflows the buy-hold path's PIXEL coordinates
even though the underlying `buyHoldEquity` DATA never changes. That's a
normal charting artifact, not dishonesty. The correct test is a DATA-level
check: hover the same bar-index in both views and read the tooltip's own
"Buy & hold ₹" readout — did this (₹1,24,987 in both Real and Ideal,
identical) and it's the right way to verify a "this overlay is
toggle-independent" claim on any chart that auto-scales its own axis.
Don't diff SVG path strings for this class of claim again.

**Two non-blocking findings, not filed as failures:**
1. ₹1-2 rounding drift between the Trades-table's sum of individually-
   rupee-rounded per-trade cells (e.g. costs: ₹5,260) and the Overview/
   Performance tile's own once-rounded aggregate (₹5,261) — expected
   per-cell-rounding accumulation over 22 trades (max plausible drift
   ~±11), not a data-integrity bug; the precise unrounded totals are
   computed once in the engine, each display site just rounds
   independently. Cosmetic only (~0.02-0.06% of the totals involved).
2. The "Open — marked to last close" Trades-tab badge was NOT exercised
   live — this specific RELIANCE/1D/MA-Cross 5-year run happened to close
   its last trade before the window ended, so no naturally-open-at-end
   fixture existed to click through. Verified instead via direct code
   reading (`TradesTab`'s conditional is a trivial, unambiguous
   `t.isOpen || t.exitTimestamp === null` check) AND via my own
   independent engine fixture's open-trade case (exact hand-match).
   Low risk, but flag if a future ticket touches this exact badge.

**Environment gotchas hit this session (all resolved, useful for next
time):**
- The pre-existing dev server on port 3002 (another concurrent
  session/agent's) was serving BROKEN static assets (CSS/webpack chunk
  `net::ERR_ABORTED`, unhydrated React, silent no-op button clicks, a
  misleading NextAuth 400). Don't debug a login failure against a
  foreign dev server's port — spin up your OWN `next dev -- -p <port>`
  (apps/web) + `next dev -p 3001` (apps/api, was NOT running at all —
  candle data proxies through it, workbench shows "Candle data
  temporarily unavailable" without it) on ports you own, and kill only
  those PIDs in cleanup, never touch a port you didn't start.
- Kira's password: `passwordHash` is the real Prisma field (schema has
  no bare `password` column) — querying the wrong field name silently
  returns `false`/`undefined` and can send you on a wild goose chase
  believing the seeded test user has no password. bcrypt-verified
  `Password123!` is still correct as of this session.
- The maximized chart overlay (`[data-chart-key]`, `fixed inset-0 z-50`)
  sits ON TOP of the underlying (non-maximized) workbench's OWN toolbar,
  which renders identically-labelled controls ("1D", "Strategy", "5m",
  "Scripts", the strategy `<select>`) at the SAME screen position
  underneath it. An unscoped `page.locator('button:text-is("1D")')`
  silently resolves to the COVERED, non-maximized copy — clicks appear
  to succeed (no error) but have no visible effect, and Playwright's own
  strict-mode "canvas intercepts pointer events" failure on the OTHER
  copy is the actual tell. Always scope every locator to
  `page.locator("[data-chart-key]").first()` once maximized.
- `page.locator("select").first()` / `text=STATS` etc. are substring/
  DOM-order traps in this codebase: the Ticket panel's own `<select>`
  (display:none while the Strategy tab is active, but still IN the DOM
  per the "single-mount, CSS-hide only" convention) sits earlier in DOM
  order than the Strategy tab's own select; and `text=STATS` substring-
  matches "TRADE **STATS**" inside `PerformanceTab`'s own group title,
  not just the drawer's own collapsible "STATS" header. Scope tightly
  (`select:visible`, exact button text, or a container-first locator)
  every time, especially with the tab-scoped-but-still-mounted pattern
  this codebase uses throughout.
- Hovering an SVG for a tooltip needs the element scrolled into the
  viewport first (`locator.scrollIntoViewIfNeeded()`) AND a two-step
  `mouse.move` (move away, then move to target with `steps: N`) — a
  single `mouse.move` straight to an off-screen-computed bounding box,
  or to a coordinate that doesn't register as a real displacement, will
  silently produce zero `pointermove` events and an always-null tooltip
  read.
- Deep-link recipe still holds: `kira@example.com` / `Password123!` via
  `/sign-in` (2 bare `<input>`s, index 0/1); `/paper-trading?symbol=X`.
  New this session: the workbench's Scripts-drawer example-duplication
  flow (`createUserScript`) is a REAL DB write (`UserStrategyScript`
  rows) — clean up every "<Example> (copy N)" row your test run creates
  (`prisma.userStrategyScript.deleteMany({where:{userId, name:{startsWith:...}}})`)
  or QA sessions will leave a growing pile of test scripts in kira's
  account. The client-suggested name collision retry (append " N") is
  expected/correct behavior when re-running this flow multiple times in
  one debugging session — don't mistake the resulting 409 console
  errors for a bug; they're the documented "server's 409 is the real
  enforcement" retry path working as designed.

See [[feedback_verify_file_scope_not_just_diff_stat]] (same discipline,
confirmed exactly 4 file groups touched) and
[[feedback_strictmode_double_invoke_defeats_ref_guard]] (unrelated to this
ticket, no StrictMode races found here — this UI has no problematic
mount-effect pattern).
