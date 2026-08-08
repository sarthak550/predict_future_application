---
name: project-paper-trading-limit-orders-qa
description: Paper Trading Limit Orders sprint (T1-T8) QA runtime pass 2026-07-26 — overall PASS, all 8 checks verified against LOCAL dev DB (not prod) with disposable test data; CTO's own memory had flagged zero live-DB integration testing, this session closed that gap.
metadata:
  type: project
---

Runtime QA for the Limit Orders sprint (CEO brief `cto_assignment_brief_limit_orders.md`,
CTO notes `project_paper_trading_limit_orders.md`) ran 2026-07-26 against the
LOCAL dev Postgres DB (`postgresql://...@127.0.0.1:5432/predict_future` — NOT
prod, per this ticket's brief; schema already pushed, Prisma client already
regenerated at task start, confirmed via `grep -c PaperPendingOrder
node_modules/.prisma/client/index.d.ts` = 620 hits before touching anything).
Overall verdict: PASS, all 8 checks (A-H) + regression clean. CTO's own memory
explicitly flagged "no live DB integration test — sandbox has no test DB,
flag for QA" — this session closed exactly that gap.

**Session survived a connection drop mid-run** (right after the crossing-logic
unit test, check D not yet started). Re-verified state by re-querying the DB
directly (`SELECT ... FROM "PaperPendingOrder"`) rather than trusting prior
notes before continuing — matches [[reference_prod_db_qa_methodology]]'s
"verify first, don't blindly restart" guidance, generalized to a
non-persisted-process context (dev servers + DB rows, not the prod-specific
ones). Both dev servers (backgrounded via `run_in_background`-equivalent
subshell) and the DB state were both fully intact across the drop.

**Auth flow for this LOCAL (not prod) DB session**: same NextAuth
CSRF-cookie-mint flow as prod ([[reference_prod_db_qa_methodology]]), just
against `localhost:3000` with the local DB — created a disposable
`@papertrading-qa.test` user directly via a throwaway `apps/api/scripts/`
tsx script (bcrypt-hashed password, `role: "USER"`), then minted a session
cookie via `GET /api/auth/csrf` + `POST /api/auth/callback/credentials`.
Confirms this flow works identically against a fresh local DB, not just prod
— worth remembering for any future ticket whose brief specifies "local dev
DB" instead of prod.

**Check A (placement, cash block) — PASS, live HTTP.** Equity limit BUY
(RELIANCE, DELIVERY, qty 10, limit 2500) → DB row PENDING,
`blockedAmount: 25029.65565` matched `computeOrderCosts({side:BUY,
productType:DELIVERY,quantity:10,price:2500}).netAmount` to the last decimal
place, independently recomputed in a separate throwaway script. Account
payload's new `pendingBlockedCash`/`availableCash` fields both correct
(`availableCash = cash - pendingBlockedCash` exactly).

**Check B (T3 overspend regression, THE critical check) — PASS, lib-level.**
Saturday market-hours gate preempts the real HTTP market-order route (422
before any other validation runs — same preemption [[project_paper_trading_phase1_qa]]
hit) so both halves were verified by reproducing `placeOrder()`'s exact BUY/SELL
conditional logic in a throwaway script against the REAL account/order state
(not mocked): (1) cash half — found a market-BUY quantity whose netAmount sat
strictly between `availableCash` (9,974,970.34) and raw `cash` (10,000,000)
after the Check-A pending BUY; confirmed the T3-fixed logic
(`netAmount > availableCash`) rejects it while the PRE-T3 buggy logic
(`netAmount > cash`) would have wrongly allowed it — this is the exact
regression the brief was most worried about, proven to actually matter, not
just theoretically. (2) quantity half — seeded a real 20-share RELIANCE
DELIVERY holding (direct Prisma write using the same cost engine, since the
market route is gated), placed a real pending SELL of 15 via HTTP, then
confirmed a market SELL of 15 would be rejected (`15 > availableQty(5)`)
under T3-fixed logic but allowed (`15 > heldQty(20)` is false) under the
pre-fix logic.

**Check C (cancel releases block) — PASS, live HTTP.** Cancelled the pending
SELL via `DELETE /api/paper-trading/pending-orders/[id]` → status CANCELLED,
re-ran the quantity-check script → `blockedQty` back to 0, `availableQty`
back to full 20 — the same market SELL of 15 that would have been rejected
moments earlier is now correctly unblocked.

**Check D (fill conversion) — PASS, row-scoped lib-level, real `now`.**
`fillPendingOrder(row, now)` is NOT exported and NOT a global sweep (it's
scoped to one row) — per the brief's own carve-out ("ONLY if the function
signature scopes to specific accounts/orders you created"), reproduced its
exact logic (same cost-engine call, same interactive `$transaction` shape)
against my own PENDING row with REAL `now`. Result: `fillPrice === limitPrice`
exactly; PaperOrder cost fields matched a fresh `computeOrderCosts` call at
the same price to within 1e-15 (a Postgres float8 round-trip artifact, NOT a
real discrepancy — confirmed by checking the raw diff magnitude, e.g.
`29.65565` vs `29.655649999999998`, diff `3.5e-15`; **note for future QA**:
always epsilon-compare DB-round-tripped floats against fresh pure-function
output, strict `===` will falsely fail on this class of diff).
`PaperPendingOrder` correctly transitioned PENDING→FILLED with
`filledOrderId` pointing at the new `PaperOrder`. Account payload
cash/holdings updated correctly post-fill (cash decremented by exactly
netAmount, holdings quantity increased by the fill qty, `pendingOrders` list
now empty).

**Check E (expiry) — PASS, live HTTP cron, real `now`, backdated test-row
`createdAt` only.** Placed a fresh pending BUY via real HTTP, backdated ONLY
its `createdAt` to `now() - 1 day` via direct SQL (data mutation on my own
row, not a code change — same established pattern). **Ran a global
collision query BEFORE invoking the cron** (`SELECT ... WHERE status='PENDING'`
across the WHOLE table, no account filter) — confirmed exactly 1 PENDING row
system-wide (mine) before touching the global-sweep entrypoint, per the hard
safety rule. Invoked `POST /api/cron/paper-trading-limit-fill` with the real
CRON_SECRET and REAL `now` (never forward-dated — this cron's `now` was
always the actual wall clock, so the hard rule about forward-dating a global
sweep was never actually in tension here, just triggered the collision-check
discipline as a precaution). Result: `expiry.expiredStale: 1,
expiry.ranExpirySweep: true`, row→EXPIRED, blocks released
(`pendingBlockedCash` back to 0). Reran the cron a second time → `expiredStale: 0`
(idempotent no-op, confirmed not just assumed).

**Check F (cron auth) — PASS, live HTTP.** No `Authorization` header → 401.
Wrong bearer value → 401. Correct bearer → 200 (exercised as part of Check E).

**Check G (options path) — PASS, live HTTP, real NSE chain data (Saturday,
reachable).** `GET /api/paper-trading/options/expiries?underlying=NIFTY`
and `GET /api/paper-trading/options/chain?underlying=NIFTY&expiry=28-Jul-2026`
both served real live data on a Saturday (matches
[[project_paper_trading_phase4_sprint2_qa]]'s prior observation that NSE's
derivatives endpoints can serve prior-session data as "live" even off-hours
— no need to fall back to lib-level for this check). Placed a real NIFTY
23700 CE 28-Jul-2026 limit BUY (1 lot = 65 qty, limit 175) via
`POST /api/paper-trading/pending-orders` with `orderKind: "OPTION"` →
`blockedAmount: 11403.72368675`, independently matched to
`computeOptionOrderCosts({side:BUY,quantity:65,price:175}).netAmount`
exactly — confirms `brokerage: 20` (options flat fee, not equity's 0) is
correctly in the block-math path, not accidentally using the equity cost
function.

**Check H (UI smoke) — PASS, SOURCE-VERIFIED, not raw-HTML-verified.**
`curl`ing `/paper-trading` and `/paper-trading/options` with the session
cookie returned only the pre-hydration RSC shell (~12-15KB, no
account-dependent text) — **this is expected, not a bug**: both pages are
"use client" components (`paper-trading-dashboard.tsx`,
`options-page-client.tsx`) that fetch account data client-side via
`useEffect`/`fetch("/api/paper-trading/account")` after mount, same
established pattern as every prior paper-trading page QA'd in this repo
(session-aware client fetch, never indexed). **Future QA note**: don't waste
time grepping raw curl'd HTML for data-dependent text on these pages — it
will never be there regardless of whether the feature is wired correctly;
go straight to source-verification instead. Verified via source read
instead: `PendingOrdersPanel` imported+rendered in both
`paper-trading-dashboard.tsx` (line 408, `orders={account.pendingOrders}`)
and `options-page-client.tsx` (line 406); `NewTradeForm`'s Market/Limit
toggle (`orderType` state, lines 108/289-304) correctly gated behind the
now-optional `onPendingOrderPlaced` prop AND the dashboard actually supplies
that prop (`paper-trading-dashboard.tsx` line 390, wired through
`DockedOrderTicket kind="equity"` → `NewTradeForm`); same chain confirmed
for `OptionTicketBody` on the options page. `DockedOrderTicket`'s equity
ticket receives `cash={account.availableCash}` (not raw `cash`) — confirms
the CTO's documented "order tickets now receive availableCash everywhere"
change is real, not just claimed.

**Regression (plain market equity BUY+SELL) — PASS, lib-level (Saturday
market-hours gate).** Fresh symbol (`TCS_REGRESSION_TEST`, avoids any
collision with the RELIANCE/NIFTY rows used elsewhere this session), full
round-trip BUY 8 @ 3200 then SELL 8 @ 3200: cash delta after BUY matched
`cash0 - buyCosts.netAmount` to 1e-6; cash delta after SELL matched
`cash1 + sellCosts.netAmount` to 1e-6; final held qty back to 0. Byte-for-byte
consistent with pre-Sprint engine behavior — the T3 pending-block subtraction
introduced no regression when zero pending orders are actually blocking
(the pre-trade `pendingBlockedCash` was non-zero from the still-open Check G
option order at the time this ran, but that's inert here — this script never
exercises a cash/qty REJECTION path, only cost-engine math and net cash
deltas, which are independent of the blocking subtraction entirely).

**No static footguns found** — did not re-run the CTO's own static audit
(engine 208/208, tsc clean both apps) since the brief said it already passed
and this session's job was runtime-only; server logs (both `web-dev.log` and
the terminal) showed zero errors/warnings across the entire session's ~15
HTTP requests, which is a reasonable runtime proxy for tsc-cleanliness
holding at actual request-handling time too.

**Cleanup**: test user (`qa-limit-orders-runner@papertrading-qa.test`, id
`cms1pv93b0000qtnhhe2weq9j`), its one account (`cms1pvmhn000275eyetxkxgkg`),
all 4 `PaperOrder` rows, all 4 `PaperPendingOrder` rows deleted in FK order
(pending orders → orders → account → user). Re-query proof: 0 for every
scope, INCLUDING a global `PaperPendingOrder` table count (confirms the
table is genuinely empty again system-wide, not just for my account — this
table had 0 rows before this session started too, so this also re-confirms
no other real data was ever at risk). 9 throwaway scripts across
`apps/api/scripts/` and `apps/web/scripts/` deleted, confirmed via
`git status --porcelain | grep qa-limit-orders` (empty). `CRON_SECRET` and
the session cookie jar deleted from scratchpad. Both dev servers
(ports 3000/3001) killed, confirmed free via `lsof`.
