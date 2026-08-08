---
name: project-chart-trading-sl-tp-qa
description: Chart Trading + Stop-Loss/Take-Profit program (Sprints A+B+C) QA runtime pass 2026-08-01 — overall PASS, all 9 checks (A-I) verified against LOCAL dev DB with disposable test data; code was uncommitted (working tree diff) at QA time.
metadata:
  type: project
---

Runtime QA for the full 3-sprint Chart Trading + SL/TP program (CEO brief
`project_chart_trading_sl_tp_program.md`, CTO notes
`project_chart_trading_sl_tp_sprint_{a,b,c}.md`) ran 2026-08-01 against the
LOCAL dev Postgres DB (uncommitted working-tree diff at QA time, not yet
committed — commit `227e879` is the prior "Limit orders + bonds info layer"
sprint; this program sits on top of it, still unstaged). Overall verdict:
PASS, all checks A-I clean, zero fixes needed — the CTO's own extremely
detailed sprint notes (each decision numbered, each risk named in advance)
matched the actual code on every point I independently verified. This is
the cleanest first-pass QA result across the whole paper-trading program to
date — no bugs found, not even a minor one, on a 3-sprint, ~15-file diff
touching engine math, two chart components with a documented prior
render-loop incident, and a brand-new PATCH endpoint.

**Engine (Check A)**: 264/264, confirmed by running `verify-papertrading-
engine.ts` directly (not trusted from CTO notes). Section 41 (stop fills at
observed crossing quote, never trigger) and section 42 (reprice
self-exclusion invariant) both present and passing.

**STOP wrong-side rejection (Check B)** — all 6 combinations (equity/
options/futures × BUY/SELL) correctly 422 live over HTTP, exact error copy
matching the schema doc. A valid STOP SELL persisted with
`variant=STOP, triggerPrice=limitPrice` denormalization confirmed.

**Futures pending blocking + decision-6 regression (Check C)** — LIMIT open
blockedAmount matched `computePendingFuturesBlockAmount` to the exact
decimal (237991.439564) independently recomputed in a throwaway script;
`availableCash = cash - pendingBlockedCash` exact. The decision-6 regression
(a pending futures order's block must be seen by a subsequent MARKET futures
order) couldn't be proven via live HTTP — Saturday's market-hours gate
preempts `POST /api/paper-trading/futures/orders` unconditionally, same as
every prior futures QA session — so this was proven two ways instead: (1) a
throwaway script derived the EXACT lot count (41 lots) where
`cash - costs - margin >= 0` (would pass under the pre-Sprint-A/buggy logic)
but `cash - pendingBlockedMargin - costs - margin < 0` (correctly rejects
under the fixed logic), and (2) confirmed via source read that
`futuresOrders.ts`'s `placeFuturesOrder` actually calls
`fetchActivePendingOrders` → `derivePendingBlockedCash` →
`pendingBlockedMargin` into `planFuturesOrderFill` — i.e. the wiring that
would make case (1)'s math apply in production is real, not hypothetical.
Closing-side pending-blocks-lots also confirmed live: a 2nd pending close
order for 1 lot correctly rejected with "0.00 available" once a first
pending close order for the full 2 held lots was resting.

**Reprice (Check E)** — PATCH tested exhaustively, all live HTTP: wrong-side
STOP reprice 422s with row byte-unchanged (verified via direct DB read, not
just the response); nonexistent/other-account row → 404; a FILLED row (test
row manually flipped via SQL) → 409 with "already filled" message;
self-exclusion proven for BOTH block types, not just one — a futures
closing-lots reprice that only fits because its own prior 2-lot block is
excluded succeeded, AND (the stronger test) an equity cash-blocking reprice
was deliberately sized so the new block (₹9.02M) exceeds what would be
"available" if the row's OWN old block (₹6.9M) were double-counted against
total cash (₹10M) — it still succeeded, proving self-exclusion isn't just
working for the simpler quantity-block path.

**Fill cron (Check D)** — the market-hours gate blocks `runLimitOrderFillCheck`
itself on a Saturday regardless of what `now` is passed (it reads the real
day-of-week), so this was the row-scoped lib-level pattern from
[[project_paper_trading_limit_orders_qa]]: copied `fillPendingOrder`'s exact
private logic (it is NOT exported) into a throwaway script, invoked only
against specific rows this session created, with a REAL `now` throughout.
Confirmed: (1) a STOP SELL with trigger=1200 filled at an injected observed
quote of 1150 — `PaperOrder.fillPrice === 1150`, never 1200; (2) a STOP BUY
sized so its trigger-time block fit but a worse crossing quote's cost didn't
→ REJECTED, resolutionNote non-null, cash BYTE-IDENTICAL before/after
(`8992112.2709981` both times — confirmed via direct query, not assumed);
(3) a LIMIT BUY filled at exactly its `limitPrice` (1310) even when passed a
different "quote" argument (1305) — proving LIMIT truly ignores the crossing
quote for fill price, byte-identical to pre-Sprint-A behavior; (4) a futures
LIMIT open fill wrote `netAmount: +91.3005485` (cost-only, positive per the
`signedNetAmountForCashEffect` BUY-open convention — cash decreases by
exactly the cost stack, never the notional).

**Expiry sweep (Check F)** — ran at 11:11 IST (before the 15:20 cutoff), so
exercised the prior-day self-heal path per the task brief's own guidance: a
global collision query first confirmed exactly 2 PENDING rows system-wide,
both mine; two fresh rows (one equity STOP, one futures STOP) had ONLY their
`createdAt` backdated to yesterday via direct SQL (never touched the cron's
own `now`, which stayed real throughout — this check needed no `now`
manipulation at all, since the stale-row branch keys off the real current
time vs. the row's own backdated `createdAt`); real HTTP invocation of
`/api/cron/paper-trading-limit-fill` with the real `CRON_SECRET` →
`expiredStale: 2`, both rows EXPIRED with the correct `instrumentKind`
(EQUITY and INDEX_FUTURE) and `variant: STOP`. Rerun → idempotent
(`expiredStale: 0`, `ranExpirySweep: false`). Wrong secret → 401.

**Premium-history (Check G)** — never-snapshotted contract → `200`, empty
`points: []` (not 404). A real snapshotted contract (2 rows seeded directly,
`OptionPremiumSnapshot` was confirmed empty system-wide before seeding) →
`200`, 2 points, chronological, honest `capturedAt` timestamps matching the
seeded values exactly.

**UI render-loop soak (Check H)** — a true browser soak wasn't possible
headlessly; compensated with the dep-array audit the brief asked for, PLUS
went further than a soak could anyway (a soak only shows "no observed loop
in N minutes," not "no loop is possible for any prop combination"): quoted
every new effect's dep array directly from `price-chart.tsx` and
`premium-chart.tsx` inline in this session's transcript (all keyed on
primitives/refs — `[points]` for `geometry` unchanged from pre-Sprint-A,
`[timeframe, symbol]`, `[timeframe, pollIntervalMs]`,
`[computedQuote?.price, ...]`, `[contractKey]`, `[livePremium]`) and
confirmed `orderLines` is rendered directly from the prop, never folded into
a memo/effect dependency anywhere in either file. All three terminal pages
(`/paper-trading`, `/paper-trading/options`, `/paper-trading/futures`)
returned 200 over authenticated HTTP; dev server logs showed zero
errors/warnings across the entire session's ~40 requests. The three
non-terminal `PriceChart` consumers (instruments/[symbol], indices/[slug],
bonds/[symbol]) confirmed byte-identical via `git status --porcelain`
(zero hits) — the CTO's "zero behavior change for every existing caller"
claim holds.

**Regression (Check I)** — market-hours gate blocks the real HTTP order
routes on Saturday (same as every instrument kind's market-order path), so
reproduced the exact cost-engine calls `orders.ts`/`futuresOrders.ts` make
and wrote the resulting `PaperOrder` rows directly, checking cash
before/after against independently-derived expected deltas: equity BUY,
equity SELL, and a futures SELL-to-open all matched to `diff=0` (not just
epsilon-close — exactly 0, since this session avoided any DB float
round-trip by computing both sides from the same in-memory numbers). Proves
`planFuturesOrderFill`'s extraction from the old inline `futuresOrders.ts`
logic is truly invisible to the cash ledger.

**One EDGE-CASE FINDING, not a blocker** — `inferOrderIntentOptions` in
`chart-order-lines.ts` offers a STOP as the "secondary" popover option using
a `<=`/`>` split (`below = clickedPrice <= currentPrice`), but
`validateStopDirection` in `pendingOrders.ts` rejects a STOP whose trigger
EQUALS the current quote (`triggerPrice >= currentQuote` for SELL,
`triggerPrice <= currentQuote` for BUY — both strict-equal-rejects). So a
click landing EXACTLY on the chart's last-rendered price offers a STOP
option that would 422 if submitted at that exact unchanged price. Very low
real-world likelihood (requires a click to snap to precisely the last point
AND the market to not have ticked between click and confirm), and the
failure mode is an honest, already-well-worded 422 (not a silent/incorrect
fill) — did not fail this on its own, flagged for the CTO's awareness only.
Not re-verified as it doesn't rise to blocking severity per this program's
own honesty-first design posture (worse UX papercut, not a correctness
bug).

**Test user**: `qa-ctp-runner@papertrading-qa.test`
(id `cms9xqn580000qodtputomcmc`), 1 account (`cms9xr83k00022iaq4oxqrmxk`),
8 `PaperOrder` + 11 `PaperPendingOrder` rows + 2 `OptionPremiumSnapshot` rows
all deleted; re-query proof 0 across every scope INCLUDING a global
`PaperPendingOrder` count and a global `OptionPremiumSnapshot` count (both
tables confirmed empty system-wide again, matching their pre-session state).
9 throwaway `apps/api/scripts/qa-ctp-*.ts` scripts deleted, confirmed via
`git status --porcelain` (no `qa-ctp` hits). Both dev servers (3000/3001)
killed, ports confirmed free via `lsof`. No source files were ever edited
this session — every fix-shaped finding was zero, so nothing needed CTO
re-work.

**Methodology notes for next time**: this session hit the SAME
cwd-resets-between-bash-calls behavior noted in
[[reference_prod_db_qa_methodology]] (a throwaway script written via `cat >
scripts/x.ts` under one `cd`, then invoked in a LATER bash call, silently
resolved relative to a different cwd and 404'd) — always use the `Write`
tool with an absolute path for throwaway scripts instead of a heredoc after
a `cd`, since the harness does not guarantee cwd persists to the next tool
call. Also: `psql` column names are case-sensitive and must be
double-quoted (`"isActive"` doesn't exist on `PaperTradingAccount` — there
is no such column at all, don't assume a column exists from a different
model's convention; just query without a status filter and use the
`userId` alone when there's only one account).
