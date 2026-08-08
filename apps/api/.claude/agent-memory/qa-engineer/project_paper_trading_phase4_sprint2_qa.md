---
name: project-paper-trading-phase4-sprint2-qa
description: Paper Trading Phase 4 Sprint 2 (Index Futures, T7-T11 + the ₹1Cr capital-change commit) QA runtime pass 2026-07-26 — overall PASS, verified against prod DB on a Sunday (market closed) via lib-level lifecycle scripts for order/MTM/expiry/margin-call, HTTP for quote/search/reset/cron-self-gate.
metadata:
  type: project
---

Runtime QA for Paper Trading Phase 4 Sprint 2 (CEO brief
`cto_assignment_brief_paper_trading_phase4_futures.md`, CTO notes
`project_paper_trading_phase4_sprint1.md` / `_sprint2.md`) ran 2026-07-26
against the LIVE PROD Neon DB via [[reference_prod_db_qa_methodology]].
Commits verified: `736a69d` (Sprint 1 engine, previously QA'd),
`a1f1f1f` (Sprint 2: order placement/crons/UI), `1e4f8c8` (₹1Cr default
capital + user-set-at-reset). Overall verdict: PASS, zero failures. NOT yet
deployed at QA time — task explicitly said do not deploy/push, so this was a
pre-deploy sign-off pass only.

**The single most important check — netAmount is costs-only on open, not
notional — CONFIRMED to the paisa.** LONG 1 lot NIFTY (₹15,48,950 notional)
debited cash by exactly ₹89.85 (totalCosts), not the notional. SHORT 1 lot
BANKNIFTY (₹17,05,860 notional) debited exactly ₹915.38. This is Sprint 2's
own-flagged "THE CRITICAL DESIGN DECISION" (see CTO memory) and it holds up
live against real DB state, not just the 191-assertion verify script.

**Close-path signs verified both directions with synthetic post-entry prices**
(price movement can't be observed live in one Sunday session, so a synthetic
close price was used at lib-level only — labeled as such, not blurred with
the live-HTTP quote checks): closing a profitable LONG (up move) via SELL
credited cash by `realizedPnl - costs`; closing a profitable SHORT (down
move) via BUY also credited cash by `realizedPnl - costs` — the
`signedNetAmountForCashEffect` BUY-side inversion was hand-verified to
produce the correct FINAL cash delta even though the stored `netAmount`
field itself is negative for a BUY leg (this is intentional, not a bug —
`deriveCash`'s `side === "SELL" ? netAmount : -netAmount` un-inverts it).

**Margin math verified both branches**: ₹1Cr account, 1 lot NIFTY at 15% of
₹15.5L notional → headroom ~₹97.7L, order would pass. A disposable ₹1L
account (pre-Sprint-2-capital-change scale, deliberately seeded low to force
the branch) → headroom -₹1.32L, order would reject with the exact
"Insufficient margin: ... but only ₹X cash is available" message format from
futuresOrders.ts.

**Daily MTM cron: self-gate confirmed live over real HTTP** (Sunday, real
`now`, no forward-dating) — `settlementAvailable: false`, `accountsScanned:
0` (returns before even querying accounts, confirmed by reading the code:
the settlement-fetch gate is the very first line). Wrong CRON_SECRET → 401.
Same self-gate confirmed for the expiry cron. **Then, per the QA
methodology's hard rule against forward-dating a global/no-account-scoping
sweep's `now`, the actual MTM-leg-write and margin-call-force-close formulas
were exercised lib-level against ONLY this session's own disposable test
accounts** (a real cross-account collision query first confirmed ZERO other
accounts had ever held an INDEX_FUTURE order — this feature is genuinely
brand new and unreleased, so the risk window was empty, but the check was
still run before touching anything): MTM leg row shape confirmed
(`quantity: 0`, every cost field `0`, `isDailyMtm: true`,
`netAmount = (settlementPrice - referencePrice) * signedQuantity` exact);
`referencePrice` telescoped forward to the new settlement price; a SECOND
mark at the SAME price produced a genuine `netAmount: 0` leg (not skipped
entirely — Sprint 2's actual behavior is "still writes a zero-delta leg",
worth noting for future QA: the brief's own acceptance language said
"zero-delta no-op or skipped" and the real behavior landed on the former,
which is correct per the idempotency-by-session-date guard, not a
discrepancy). Margin-call: a ₹3L account opened 1 healthy-margin NIFTY long,
then a synthetic hard-adverse settlement (23830→20000) flipped headroom
negative (-₹1.44L); the force-close leg reproduced exactly —
`FUTURES_MARGIN_CALL` reason, `autoSquaredOff: true`, full cost path
(brokerage AND STT both non-zero, confirmed NOT the zero-brokerage
settlement path — this is the exact mis-copy the brief flagged as the
easiest trap and it's correctly avoided), final open-positions count 0.

**Expiry settlement verified lib-level, single-account, using the REAL
listed 28-Jul-2026 expiry date as DATA ONLY** (never passed as the cron's
`now` — the brief's own instruction: "real listed expiry date NOT reached
via global cron `now` manipulation — call the per-account/lib function
directly"): seeded a LONG already MTM-marked to today's settlement price
(mirrors the brief's own "MTM runs before expiry" sequencing), then the
expiry-settlement formula produced `brokerage: 0`, `sttAmount` non-zero
(sell-side on settlement-value turnover), `squareOffReason:
FUTURES_EXPIRY_SETTLEMENT`, and `realizedPnlThisLeg ≈ 0` (confirmed, not
just theorized — matches the brief's "near-zero-incremental-P&L,
correct and expected" prediction) since `referencePrice` already equaled
the settlement price from the prior MTM mark.

**Capital-change commit (`1e4f8c8`) fully verified live, all 4 reset-flow
branches**: fresh account → exactly ₹1,00,00,000. `{"startingCapital":
5000000}` on an eligible (backdated) account → new generation at exactly
₹50,00,000. `99999` (below ₹1L floor) → 400, generation unchanged
(confirmed the rejection doesn't consume the reset). `20000000000` (above
₹1000Cr ceiling) → 400, generation unchanged. No body → new generation at
the ₹1Cr default. One methodology note for future QA: the 30-day cooldown
re-anchors on EVERY successful reset (fresh `createdAt`), so each bounds/
capital test on the SAME account needs its own backdate — don't assume one
backdate covers a whole test sequence.

**Quote path, both apps, both indices tested — source LIVE on a Sunday**
(NSE's `liveEquity-derivatives` endpoint served the prior session's closing
data tagged as live for both NIFTY and BANKNIFTY; genuinely acceptable per
the brief's own "either is acceptable" allowance, and worth noting for a
future QA session: don't assume PCP_DERIVED is the only reachable source on
a non-trading day, LIVE reachability doesn't require the market to be
currently open, just the upstream endpoint to be up). `lotSize` present on
every contract (NIFTY 65, BANKNIFTY 30). `apps/web`'s proxy byte-identical
to `apps/api`'s own response.

**Search + futures page**: `byCategory.future` = exactly 5 entries
(NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50), each linking
`/paper-trading/futures?underlying=...`. `/paper-trading/futures` returns
200 both unauthenticated and authenticated.

**Account-detail 3-instrument-kind coherence verified live over real HTTP**,
not just by formula: seeded equity DELIVERY BUY (RELIANCE, synthetic price —
market closed) + option BUY (NIFTY CE, synthetic premium) on the SAME
account that already carried real futures P&L history from the lifecycle
tests, then hand-verified `totalValue = cash + holdingsValue + optionsValue
+ futuresUnmarkedValue` to the paisa (₹1,00,31,991.20) against the real GET
/account response — confirms `queries.ts`'s Sprint 2 additions integrate
correctly with the pre-existing P1/P2 aggregation, not just in isolation.

**Static analysis**: `tsc --noEmit` clean on `apps/api`, `apps/web`,
`packages/business-rules`. `eslint` clean on every changed futures file in
both apps. `getSession()` audit: zero hits in any Phase-4 file (web-only
feature, matches P1-P3's posture, correct). Every new `findMany`
(`futuresDailyMtm.ts`, `futuresExpiry.ts`, `futuresOrders.ts`) is
`accountId`-scoped. Suspense boundary present around `useSearchParams()` on
`/paper-trading/futures/page.tsx`. Margin disclaimer and margin-required/
leverage figures render non-collapsibly in the docked ticket (not behind a
toggle) — confirmed by reading the JSX directly, matches
[[feedback_passive_brand_exposure]]-adjacent "always-visible, not gated"
posture the brief explicitly demanded. `positions-strip.tsx` and
`order-history-table.tsx` both correctly discriminate the `future` kind,
label the MTM leg with a badge, and label the position chip's P&L as
"today's MTM" distinct from the option/equity chips' unrealized-since-entry
framing.

**191/191 engine verify-script assertions reconfirmed live this session**
(not just trusted from the CTO's memory) — ran `verify-papertrading-engine.ts`
directly, full pass, including test 31's pinned `INDEX_FUTURES_INSTRUMENT_TYPE
= "IDF"` regression guard from the Sprint 1 EC2-verification bug fix.

**Founder-facing note carried over from CTO memory, re-confirmed still
relevant**: at 15% margin and real ~₹15-20L per-lot notional, the OLD ₹1L
default could never afford one lot — this is exactly why `1e4f8c8` exists,
and this QA session's margin-shortfall test (branch 2 above) deliberately
used a disposable ₹1L-scale account specifically to keep that rejection
path exercisable/regression-tested going forward even though real accounts
no longer start there.

Test user (`qa-p4s2-runner@papertrading-qa.test`, id
`cms1nxe8f0000htdzavv6x9zk`), 6 disposable accounts (3 legitimate
generations of the real reset flow + 3 standalone lib-level test accounts
for margin-shortfall/margin-call/expiry scenarios), and 15 PaperOrder rows
were deleted this session in FK order (orders → accounts → user); re-query
proof all 0. All 8 throwaway `apps/api/scripts/qa-p4s2-*.ts` scripts
deleted, confirmed via `git status --porcelain` (no `qa-p4s2` hits). Both
local dev servers killed, ports 3000/3001 confirmed free. Fetched
DATABASE_URL/CRON_SECRET files deleted from scratchpad after use.
