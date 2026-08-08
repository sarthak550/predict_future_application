---
name: project-paper-trading-phase3-qa
description: Paper Trading Phase 3 (stock options, T1-T8) QA runtime pass 2026-07-24/25 — overall PASS after remediation, but caused and fixed a real prod-data incident this session; new methodology rule added.
metadata:
  type: project
---

Runtime QA for Paper Trading Phase 3 (CEO brief
`cto_assignment_brief_paper_trading_phase3.md`, CTO notes
`project_paper_trading_phase3_stock_options.md`) ran against the LIVE PROD Neon
DB via [[reference_prod_db_qa_methodology]]. Overall verdict: PASS. Static
analysis, 127/127 verify-script assertions, and every runtime check landed
clean. See the conversation transcript for full per-test detail — not
duplicated here.

**INCIDENT THIS SESSION (self-caused, self-remediated) — read before ever
backdating a cron's `now` param again**: to test the stock-option square-off
cost-trap contrast against REAL live NSE chain data (today, a Saturday, isn't
a real listed expiry so the chain fetch legitimately 502s), I called
`runOptionsExpirySettlement(now)` with `now` set to a FUTURE real listed
expiry date (28-Jul-2026, 3 days ahead of the actual session date). That
function has NO account-scoping — it's a full-DB sweep by `expiryDate`. It
correctly found and force-settled a REAL production user's (sarthak123@
gmail.com) two genuinely-still-open NIFTY option positions that were not
actually due to expire for 3 more real days. Caught immediately by checking
`createdAt: { gte: now-10min }` across ALL accounts (not just mine) right
after the run — **this after-the-fact blast-radius check should become a
standard step, not an afterthought**, any time a QA session calls a
global-account-scanning cron function with a non-current `now`. Remediated by
deleting the two erroneous settlement `PaperOrder` rows (verified this was
sufficient: `PaperTradingAccount` has NO separate cash column, everything is
derived from the order ledger via `deriveCash`/replay — so deleting the
wrongly-written closing legs fully and exactly restores the account, no
residual corruption). Re-verified the real account's original 2 BUY legs were
intact and unmodified after remediation.

**NEW METHODOLOGY RULE, add to [[reference_prod_db_qa_methodology]]**: a
cron's `now` param may safely be backdated into the PAST (proven safe
repeatedly across P1/P2/P3 — a past date only ever matches genuinely-due
positions) but must NEVER be forward-dated into the future when the cron
function does a global/cross-account DB sweep with no account-scoping
parameter — a future `now` will find and act on OTHER real users' genuinely
NOT-YET-DUE positions, which is a real prod-data mutation, not a test
artifact. If a future-dated `now` is genuinely needed to reach a real NSE
listed-expiry chain for cost-math verification (as it was here, since
"today" wasn't a real expiry), first run a cross-account collision query
(`groupBy` on `expiryDate`/`instrumentKind` across the WHOLE table, not just
your test account) to confirm zero other accounts have anything at that
date before invoking the sweep — or better, avoid the global-sweep entrypoint
entirely and only exercise the underlying pure functions
(`resolveSquareOffPrice`, `computeOptionOrderCosts`) plus direct
single-account Prisma writes, the way the cost-trap numbers were ultimately
still fully verified here (down to the paisa) without needing a second global
sweep.

**Cost trap confirmed live, to the paisa, contrasted directly**: seeded a
RELIANCE 1300 CE and a BAJFINANCE 1000 CE STOCK_OPTION position (real BUY
fills against real live chain premiums) plus a NIFTY 23700 CE INDEX_OPTION
position, all expiring on the real listed 28-Jul-2026 date, then ran
`runStockOptionSquareOff(now=28-Jul-2026 09:15 IST market-open)` — closing
legs came back `brokerage: 20` (full, not zeroed), STT computed on the traded
premium (`grossAmount * 0.0015`, e.g. ₹26.25 on a ₹17,500 gross, not on
intrinsic value), `stampDuty: 0`, `dpCharge: 0`, `squareOffReason:
STOCK_OPTION_EXPIRY_SQUAREOFF`. The sibling NIFTY position (settled correctly
and safely — it was MY OWN test position swept up in the same, since-fixed,
incident run) came back `brokerage: 0`, STT on intrinsic value via
`EXERCISE_RATE`, `squareOffReason: OPTION_EXPIRY` — confirming the two crons'
cost paths are genuinely distinct at runtime, not just in the unit-test
suite. Idempotency re-proven by rerunning `runStockOptionSquareOff` a second
time (safe to do — confirmed via a `groupBy` that NO real account besides
mine has ever had a STOCK_OPTION row) — `positionsSquaredOff: 0` on rerun.
Did NOT rerun the global index-cron a second time for idempotency (would have
re-swept the just-restored real account) — substituted a code-read of the
unchanged "fresh re-read, re-verify still open before write" guard in
`optionsExpiry.ts`, which Phase 3 doesn't touch at all and which P2's QA
already proved live.

**3-tier pricing fallback (`resolveSquareOffPrice`) exercised against REAL
live NSE data for tiers 1 and 2** — RELIANCE 1300 CE's real live `lastPrice`
(tier 1) and RELIANCE 1080 CE's real `lastPrice: 0`-but-live-bid/ask (tier 2,
midpoint = (191.35+202.1)/2 = 196.725) — no naturally quote-dark strike
existed anywhere in today's real RELIANCE chain, so tier 3 (intrinsic
estimate) and the one-sided-quote edge case were exercised via the pure
function directly with synthetic inputs, matching the QA brief's own "at
least lib-level" allowance for that tier. All four cases matched the formula
exactly.

**Universe/chain endpoints confirmed live, no egress issues this session**:
210 stock names, zero index rows (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/
NIFTYNXT50 all correctly absent), exact lot-size matches (RELIANCE 500, TCS
225, HDFCBANK 650) via the real chain endpoint (the fo-universe endpoint
itself only returns symbol+companyName, no lotSize field, by design per the
brief). NIFTY regression byte-identical to the CTO's Phase 2 numbers (lot 65,
spot 23767.45, 105 strikes) — confirms the `type=Equity` vs `type=Indices`
branch doesn't regress the index path.

**Long-only guardrails, full round trip, all live/lib-level**: naked SELL
rejected (`"you don't hold this contract"`), oversell rejected
(`"you hold 1 lot(s)...can't sell 2"`), valid full close accepted and
credited exactly `netAmount` with full manual-SELL costs (₹20 brokerage, STT
on premium), position re-verified flat afterward and a further SELL again
correctly rejected as naked.

**Regression (P1 equity, P2 index options) both reverified lib-level**
(Saturday — no live intraday LTP feed exists on a non-trading day, so equity
BUY used a synthetic last-session price per the brief's own explicit
allowance, sourced from the real spot just observed moments earlier in the
options chain fetch rather than a fabricated number): equity DELIVERY BUY
persisted `instrumentKind: EQUITY`, netAmount-exact cash debit; index-option
BUY (fresh NIFTY 23700 CE, 25-Aug-2026 expiry — deliberately NOT
28-Jul-2026, to avoid any overlap with the incident/remediation work) came
back `instrumentKind: INDEX_OPTION` with an exact cash-debit match.
Account-detail endpoint confirmed all three instrument kinds coherent on one
account simultaneously: `totalValue` (₹78,092.65) matched `cash +
deliveryHoldings(avgCost-valued, since latestLtp is null on a non-trading
day) + optionPositions(notional)` to the rupee, hand-verified. Reset
correctly archived a generation carrying all three kinds
(`EQUITY:1, STOCK_OPTION:6, INDEX_OPTION:3` order rows), enforced exactly one
ACTIVE account, gen-2 created fresh/empty. Equity square-off cron
(`squareoff.ts`) confirmed untouched by this diff via `git diff --name-only`
— not re-run, no incident-risk repeat needed since it's provably unmodified
and was already proven live in P1's own QA pass.

**Static footguns**: `getSession()` absent from every Phase 3 file (correct —
web-only feature, matches P1/P2's posture); `tsc --noEmit` clean on
`business-rules`, `apps/api`, `apps/web`; `eslint` clean on every changed
file in both apps (business-rules package has no eslint config at all —
pre-existing project gap, not a Phase 3 issue, and those files have zero
imports anyway so nothing to catch); Suspense boundaries confirmed present
around `useSearchParams()` on both `app/paper-trading/options/page.tsx` (new
this phase) and `app/paper-trading/page.tsx` (pre-existing, unaffected); every
new `findMany` (`stockOptionSquareOff.ts`, `optionOrders.ts`) is
`accountId`-scoped or `expiryDate`-scoped to the small regulation-bounded
daily set, same judgment call as P1/P2, not the [[feedback_api_select_clause]]
anti-pattern. Cron auth gate (401 wrong secret / 200 correct secret / 200
idempotent no-op on rerun) verified via real HTTP against the real current
date (genuinely safe — no fabricated `now` involved in the HTTP-path checks).

**One near-miss worth flagging to the CTO for a FUTURE ticket, not a QA
failure this time**: `runOptionsExpirySettlement` and `runStockOptionSquareOff`
both take a global, no-account-scoping `now: Date` and sweep every account's
matching-expiry positions. This is fine for real production cron triggers
(always real-`now`) but is a footgun for ANY future debugging/ops tooling
that might want to "re-run today's settlement for account X" — there's no
safe way to do that without either the full global sweep or hand-rolling the
single-account logic (as this QA session had to). Not a Phase 3 regression,
not blocking, just worth a note if a "manual re-run settlement for one
account" admin tool is ever requested.

Test user (`qa-p3-runner@papertrading-qa.test`), both its accounts (gen-1
archived with 10 orders across all 3 instrument kinds, gen-2 empty), and all
throwaway `apps/api/scripts/qa-p3-*.ts` / `apps/web/scripts/qa-p3-*.ts`
scripts were deleted this session; cleanup proven via re-query (0 orders / 0
accounts / 0 user) and `git status --porcelain | grep qa-p3` (empty). The
real user's account (sarthak123@gmail.com,
accountId `cmrxrqhsh0002g57c08mkw7or`) was independently re-verified restored
to its exact pre-incident state (2 open NIFTY BUY legs, no settlement rows)
as the very last DB check before cleanup.
