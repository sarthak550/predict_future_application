---
name: project-paper-trading-phase2-qa
description: Paper Trading Phase 2 (index options, long-only) QA runtime pass 2026-07-24 — overall PASS, full lifecycle + expiry cron + Phase 1 regression verified live against prod DB.
metadata:
  type: project
---

Runtime QA for Paper Trading Phase 2 (CEO brief
`cto_assignment_brief_paper_trading_phase2.md`) ran 2026-07-24 against the LIVE
PROD Neon DB via the same technique as Phase 1 — see
[[reference_prod_db_qa_methodology]]. Overall verdict: PASS, no failures found.
No CTO delivery-notes memory file existed for this ticket at QA time (only the
CEO brief) — static review was done directly against the diff/code instead,
which worked fine and should be the fallback whenever CTO notes are missing.

**Live NSE option-chain data flowed cleanly from this sandbox** (no egress
block this session, unlike some past NSE-dependent tickets) — NIFTY 18
expiries confirmed weekly-near/monthly-far cadence, BANKNIFTY 6 expiries
confirmed monthly-only, both read live from `/api/finance/options/expiries`
with no hardcoded cadence assumption. Lot sizes came back exactly as the CTO
predicted from the empirical fo_mktlots.csv audit: **NIFTY 65, BANKNIFTY 30**,
both snapshotted onto the `PaperOrder.lotSize` column at fill time, confirmed
by inspecting the written rows directly.

**Full live-HTTP options order lifecycle verified against a real market-hours
session** (Friday 11:28 IST, market open) — BUY, a second BUY (multi-lot),
partial-close SELL, all cost lines matched `computeOptionOrderCosts` to the
sub-paisa exactly on every leg, including the flat ₹20 brokerage, 0.15% SELL
STT on premium (never on BUY), 0.003% stamp duty (BUY-only), and DP charge
always ₹0. Cash debits/credits reconciled exactly across every leg.

**Long-only guardrail verified live over HTTP, both branches**: a SELL with no
matching long holding → 422 "you don't hold this contract"; a SELL for more
lots than held → 422 "you hold N lot(s) ... can't sell M". Both messages are
specific and correctly worded, not generic. No code path anywhere in
`optionOrders.ts` can open a short — confirmed by reading the file, not just
by the rejection tests (the file structurally has no branch that would ever
write a SELL without first requiring a matching long).

**Expiry settlement cron (T6) verified with a real ITM and a real OTM
position**, both created via live HTTP BUY orders at real market premiums,
then `expiryDate` backdated to today via a direct Prisma UPDATE (Phase 1's
established backdating technique, reused here for a different field). ITM
settled at intrinsic value with exercise STT (0.15% of intrinsic, not
premium) and ₹0 brokerage; OTM settled at literal ₹0 with ₹0 STT — the "full
loss" case. Both used the Yahoo Finance spot-fallback path
(`usedSpotFallback: 2`) because today's backdated date (24-Jul-2026) isn't a
real listed NSE expiry, so the option-chain fetch for that date legitimately
returned nothing — this is a GOOD sign, it proves the fallback path is real
and reachable, not dead code. Reran the cron a second time → `positionsSettled:
0`, confirming idempotency via the "re-verify still open immediately before
write" guard in `optionsExpiry.ts`. A third, untouched, non-expiring option
position (same account) was correctly left alone by both cron runs — the
cron's `expiryDate`-scoped query doesn't accidentally sweep in unrelated
contracts.

**Cron auth gate verified both directions**: wrong `CRON_SECRET` → 401 on the
options-expiry route; correct secret → 200. Same pattern Phase 1 established.

**Phase 1 regression suite reran clean on the shared code paths** (`replay.ts`,
`queries.ts`, `orders.ts`, `squareoff.ts` all changed by this ticket):
equity DELIVERY BUY (live HTTP, market open) still produces paisa-exact
equity costs; the account-detail endpoint correctly unifies equity + option
legs into one cash pool and one coherent `totalValue` (verified against a
LIVE-MOVING option premium between two account-detail polls — the
unrealized P&L delta matched the premium delta exactly, which incidentally
also proves the live-quote-driven unrealized P&L math is correct, not just
the cost math); the equity intraday square-off cron still force-closes and
now correctly stamps `squareOffReason: "INTRADAY_SESSION_CLOSE"` on its
closing leg (Phase 2's one-line addition to `squareoff.ts`); reset correctly
archives a generation with BOTH equity and option orders attached (10 mixed
orders on the archived gen-1 account, gen-2 created fresh and empty, exactly
one ACTIVE account enforced).

**Static footguns**: no `getSession()` without `getUserIdFromRequest` issue
(N/A — this whole feature is web-only, same posture as Phase 1, correctly
uses `getSession()` alone throughout); no `useSearchParams` anywhere in the
new options UI (so no Suspense-boundary gap to check); every new component
file (`option-chain-browser.tsx`, `option-trade-panel.tsx`,
`options-page-client.tsx`) correctly starts with `"use client"`, and the
server-component `page.tsx` passes no functions as props; every new
`findMany` (in `optionOrders.ts` and `optionsExpiry.ts`) is either
`accountId`-scoped or scoped to `expiryDate: todayExpiry` (a small,
regulation-bounded daily set), matching the same "architecturally required at
this volume" judgment Phase 1 established, not the dangerous unbounded
cross-user pattern from [[feedback_api_select_clause]].

**One documented spec deviation, handled well, not a QA failure**: the
brief assumed the NSE option-chain payload itself carries a lot-size field;
`optionChain.ts`'s own header comment documents that this was empirically
false and pivots to parsing NSE's separate `fo_mktlots.csv` archive instead
— the file explicitly flags this as a deviation from the brief's assumption
rather than silently diverging, which is the right way to handle a brief
turning out to be wrong about an external API's shape.

Test user (`qa-p2-runner@papertrading-qa.test`), both accounts (10 orders on
the archived gen-1, 0 on gen-2), and all 5 throwaway `apps/api/scripts/qa-p2-*.ts`
scripts were deleted this session and cleanup was proven with a re-query
(0/0/0). Not recorded here for forensic detail — see the conversation
transcript if ever needed.
