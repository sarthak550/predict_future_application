---
name: project_backtest_metrics_engine_qa
description: Backtest engine TradingView-Performance-Summary extension (backtest.ts+selfcheck.ts) — PASS 2026-08-04, ta:check 195->514.
metadata:
  type: project
---
TA Suite Sprint S3 T1/T4 — `apps/web/lib/ta/backtest.ts` extended with a full
TradingView-style Performance Summary (gross+net profit factor/expectancy/avg
win-loss/streaks, time-in-market, maxDrawdownAmount+maxEquityRunUp, CAGR with
90-day honesty floor, per-bar equityCurve w/ buy-hold overlay, enriched
per-trade detail incl. MAE/MFE). Reviewed uncommitted 2026-08-04.

**Verdict: PASS.** Independent recomputation on my OWN 4-trade fixture (WIN,
LOSS, WIN, then an OPEN trade, w/ a deliberate intrabar spike on the middle
WIN for MAE/MFE) — every hand-computed value (profit factor gross/net,
expectancy, avg win/loss ratio, streaks, barsHeld, MAE/MFE, drawdown/run-up
via an independent brute-force equity reconstruction, final equity/buyHold
points) matched the real `runBacktest()` output. tsc/eslint clean on both
files; `ta:check` = 514/0, matches the CTO's claimed count exactly.

**Additivity check method that worked well**: diff the file, confirm every
PRE-existing computed field's source lines are byte-identical, then hand-check
any refactored-but-claimed-equivalent helper algebraically. Here the only
removed pre-extension code was the standalone `computeMaxDrawdownPct`
function — inlined into the new `buildEquityCurve` sweep. Verified by hand
it's a true no-op refactor (the dropped `peak > 0` early-skip guard is
functionally identical to computing `drawdownPct=0` and comparing, since
`maxDrawdownPct` starts at 0 and only ever increases). This is the right way
to clear an "additive-only" claim that includes a disclosed refactor — don't
just trust the doc comment, re-derive the equivalence yourself.

**The flagged gap (gross-win-but-net-loss trade) — built it, found it
coherent, gap is real.** Fixture: DELIVERY, entry 100→exit 100.5, qty=10.
grossPnl=+5, netPnl=-15.23 (the flat ₹18 DP charge on the first delivery
sell-of-day dominates any sub-₹20 gross move — useful fixture-design fact:
**DP_CHARGE_ROUNDED=₹18 flat is the easiest lever to force a
gross-win/net-loss trade in a DELIVERY fixture**, [[reference_costs_dp_charge_lever]] if that file gets
written later). Classification was fully coherent: `wins`=0 (net-classified,
matches `winRatePct`'s own convention) vs `grossWins`=1 (gross-classified) —
genuine divergence on the SAME trade, exactly the dual-ledger design intends.
Streaks (documented net-only) counted it as a loss. `profitFactorGross` was
correctly `null` (zero gross-LOSING trades exist — this is the only trade and
it's a gross win), not a fabricated value; `profitFactorNet`=0 (a net loss
exists, zero net wins) matches the stated "a loss with zero wins is a real 0"
law exactly. **No incoherence found — but this exact trade shape genuinely
does not exist in any of the CTO's shipped `selfcheck.ts` fixtures**
(fixture 1's trade2 note even flags the risk and dodges it: "trade2's small
~415 gross win must comfortably survive its round-trip cost; verified here,
not assumed"). Recommended the CTO add this fixture permanently — did not
fail the ticket over it since the ticket's own instructions treated "coherent
but unfixtured" as a pass-with-recommendation, not a blocker.

**Minor design note, not a bug, not tested by either party**: in
`computeProfitLossAggregates`, a trade with `pnl === 0` exactly falls into
the `else` branch (classified as a loss: `lossCount+=1`, contributes 0 to
`lossSum`, can become `largestLoss=0`). Not wrong (0 isn't a win), just worth
knowing if a future fixture or founder question hits an exact breakeven
trade — the `pnl > 0` / else split means breakeven counts toward
`maxConsecutiveLosses`, not as a separate "scratch" bucket.

See [[feedback_verify_file_scope_not_just_diff_stat]] — same discipline
applied here (`git diff --stat` showed exactly 2 files, both in-scope).
