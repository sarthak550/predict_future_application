---
name: project-paper-trading-phase1-qa
description: Paper Trading Phase 1 (T1-T9) QA runtime pass 2026-07-23 — overall PASS, all rules/costs/reset/cron verified against prod DB with disposable test data.
metadata:
  type: project
---

Runtime QA for Paper Trading Phase 1 (CEO brief `cto_assignment_brief_paper_trading_phase1.md`,
CTO notes `project_paper_trading_phase1.md`) ran 2026-07-23 against the LIVE PROD Neon DB
(fetched via SSH from EC2, never printed/committed). Overall verdict: PASS. See
[[project_prod_db_qa_methodology]] for the reusable technique used here.

**Cost stack verified to floating-point exactness** for a real DELIVERY BUY (10 RELIANCE
@ ₹1280.699951171875): every line (STT, exchange charge, SEBI fee, stamp duty, GST,
totalCosts, netAmount) matched hand-computed values from the FY2025-26 rate constants
exactly, and account cash decremented by netAmount to the same precision. Confirms the
CTO's 2026-07-23 rate-constant fix (product-differentiated stamp duty, GST base including
SEBI fee) is correctly wired end-to-end, not just unit-tested in isolation.

**Market-hours gate correctly blocks the HTTP route in both directions**: tested live
during actual NSE market hours (order succeeded, 201) and later the same session when
the market had genuinely closed (order rejected, 422, clear message) — no mocking needed,
real IST clock crossed the boundary mid-session.

**When market is closed, HTTP-level rejection-rule tests (delivery-short, insufficient
cash, invalid symbol) get preempted by the market-hours 422 before other validation runs**
— market-hours check is first in `placeOrder()`'s conditional chain. Worked around by
importing the exact same pure functions (`deriveDeliveryHoldings`, `deriveCash`,
`computeOrderCosts`) the route uses and reproducing its conditionals against the real
account's real order log via a throwaway `npx tsx` script (deleted after). This is a
legitimate fallback per the QA brief's own instructions, but the CTO should be told:
`isNseWeekdayMarketHours()` in `orders.ts` is called with no `now` arg even though the
underlying function accepts one — if a future ticket ever needs to unit/integration-test
rejection rules without wall-clock dependency, threading a `now` param through would let
tests hit the gate deterministically instead of praying the clock cooperates.

**Reset flow tested for real by backdating `createdAt`** on the test account by 31 days
(test-account-only DB write, not a code change) — confirmed cooldown 409 before, 200 +
generation-2 ACTIVE account + generation-1 ARCHIVED + all 5 prior orders still attached
to the archived accountId after. Exactly-one-ACTIVE enforced (GET /account correctly
served gen-2 immediately after reset).

**Square-off cron tested for both no-op and real force-close**: correct secret + zero
open intraday positions → `positionsClosed: 0` (idempotent no-op, matches T4 acceptance).
Manually inserted an open INTRADAY BUY, reran → cron closed it with an opposite-side SELL,
`autoSquaredOff: true`, `isSquareOff: true`, fillPrice from the real delayed LTP tick.
Reran again → `positionsClosed: 0` (already flat), proving idempotency, not just the
initial no-op case.

**"Calls I've traded" verified against 3 REAL graded/pending ExpertOpinion rows**
(read-only, picked from existing prod data, never modified) covering all three reachable
states (open-pending, open-graded-nudge, closed-money-line). Manually inserted PaperOrder
rows with `linkedOpinionId` set (via the same `computeOrderCosts()` the write path uses)
since the market was closed and the HTTP order route couldn't be exercised — then hit the
REAL GET endpoint with a real session cookie to confirm the read/grouping/join logic.
Also code-reviewed `calls-traded-list.tsx`'s `MoneyLine` component: `madeOrLost` branches
purely on `net >= 0` and `verdictWord` purely on HIT/MISS — no cross-gating between them,
so a loss on a HIT call and a win on a MISS call both render honestly (not literally
seeded as combos in the DB this run, but the code path is unconditionally symmetric).

**No auth or footgun failures found this ticket** — getSession() usage confined to route
handlers only (correct for apps/web NextAuth, this is a web-only feature per the brief,
not a mobile Bearer-token surface); no getSession in server component pages; no event
handlers passed from server to client components; PaperOrder money fields are Float,
consistent with the existing PortfolioTransaction/StockEodQuote convention; findMany
calls without `take` are all account-scoped or day-windowed-and-distinct (replay logs
and the cron's daily account scan), not the dangerous unbounded-cross-user pattern from
[[feedback_api_select_clause]] — architecturally required for correctness at Phase-1
volumes, matches the CTO's own documented "don't over-engineer" judgment call.

Test user/account/order ids are NOT recorded here (ephemeral, deleted same session,
counts re-verified at 0) — see the conversation transcript if forensic detail is ever
needed, don't rely on this file for that.
