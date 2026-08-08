---
name: project-paper-trading-expiry-settlement-backfill-qa
description: Expiry Settlement Backfill sprint (2026-08-04) QA runtime pass — overall PASS, zero bugs found. The claimed futures date-bug independently proven mathematically AND live against real historical NSE data; 3-tier options / 2-tier futures pricing fallback all exercised live; idempotency and dry-run proven with real before/after DB state.
metadata:
  type: project
---

Runtime QA for the Expiry Settlement Backfill sprint (CTO memory
`project_paper_trading_expiry_settlement_backfill.md`) ran 2026-08-04 against
the LOCAL dev Postgres DB (empty at session start — 0 accounts/orders/pending
orders, confirmed by direct query before touching anything). Files: `apps/api/
lib/paperTrading/{optionsExpiry,futuresExpiry,stockOptionSquareOff}.ts`,
`lib/marketMoves/foBhavcopy.ts`, the 3 cron routes, `prisma/schema.prisma`,
`scripts/verify-papertrading-engine.ts`, `packages/business-rules/src/
papertrading/replay.ts`, `apps/web/components/paper-trading/
order-history-table.tsx`, `apps/web/lib/paperTrading/queries.ts`. Overall
verdict: **PASS, zero bugs found** — the CTO's 5 claims (crontab never
installed, real futures date-bug, backfill sweeps, 3-tier settlement basis,
idempotency guards) all independently verified true.

**The date-bug claim — proven TWO independent ways, both airtight.**
(1) Pure math: wrote a throwaway node script reconstructing the OLD
`getIstSessionDate` (IST-midnight-as-UTC-instant) and NEW
`todayIstDateAsUtcMidnight` (IST-calendar-date-as-UTC-midnight) functions
verbatim plus `parseNseExpiryDate`, then swept a full day in 15-min
increments including BOTH IST-midnight boundary instants (18:29 UTC / 18:31
UTC, i.e. just before/after the 5.5h-offset rollover) — OLD function matched
the stored `expiryDate` shape in 0/96 samples (proves it could NEVER have
matched a single real position, exactly as claimed); NEW function matched in
96/96 samples including both boundary edge cases. (2) Live: fabricated an
INDEX_FUTURE position with a REAL listed past expiry (28-Jul-2026, a real
NSE trading Tuesday) and called `runFuturesExpirySettlement` directly
(lib-level, backdated `now` = 28-Jul-2026 21:00 IST — safe per
[[reference_prod_db_qa_methodology]]'s "backdating into the past is always
safe" rule) — `accountsScanned: 1`, `positionsSettled: 1`, settled via the
SAME-DAY path (`squareOffReason: FUTURES_EXPIRY_SETTLEMENT`,
`settlementBasis: LIVE_MARKET`) at price 23985.35, which I independently
re-verified by calling the REAL exported `fetchOptionUnderlyingSettlementPrices`
function directly (not a reimplementation, per
[[feedback_call_real_exports_not_reimplementations]]) — exact match. Diffing
`futuresExpiry.ts` against HEAD confirmed `optionsExpiry.ts`'s same-day path
was ALREADY using the correct `todayIstDateAsUtcMidnight` shape before this
sprint (unchanged in the diff) — the bug was genuinely futures-only, matching
the CTO's claim precisely.

**3-tier options / 2-tier futures settlement-basis fallback — all tiers
exercised live with real outcomes.** Fabricated 4 positions: (a) NIFTY
24500 CE, real 28-Jul-2026 expiry → resolved `HISTORICAL_EXCHANGE_CLOSE`,
price **0** — independently confirmed genuinely correct, not a bug: NIFTY's
real UndrlygPric that date was 23985.35 (below the 24500 strike), so the
call was truly OTM; this is a *verified* worthless outcome via real exchange
data, functionally distinct from tier 3's *assumed* worthless. (b) RELIANCE
PE (STOCK_OPTION), fake non-trading Sunday expiry, no snapshot on file →
correctly fell through tier 1 (bhavcopy 404) and tier 2 (no
OptionPremiumSnapshot) to `ASSUMED_WORTHLESS`, price 0 — proves the ₹0 floor
is real and reachable. (c) BANKNIFTY PE, same fake Sunday but WITH a
fabricated `OptionPremiumSnapshot` (lastPrice 178.5) → resolved
`LAST_KNOWN_MARK` at exactly 178.5. (d) NIFTY INDEX_FUTURE, same fake Sunday
(no bhavcopy possible) → resolved `LAST_KNOWN_MARK` at exactly 24000 (=
entry fillPrice/referencePrice, never MTM-marked) — **never a fabricated 0**;
confirmed both by the type system (`BackfillFuturesSettlementDetail.basis`
excludes `ASSUMED_WORTHLESS` entirely) and this live result.

**Idempotency and dry-run — proven with real DB row counts, not just
response JSON.** dryRun=true left the DB at exactly 4 opening orders / 2
PENDING orders (no writes) while returning the identical settlement
predictions a live run then produced. Live run (dryRun=false) wrote exactly
4 new settlement legs + cancelled both pending orders (verified via direct
DB query, not just the HTTP response). Running BOTH crons again immediately
after produced `backfillPositionsSettled: 0` / `pendingOrdersCancelled: 0`
and the DB still showed exactly 8 PaperOrder rows — no double-settlement.
Same idempotency re-confirmed at the lib-level same-day path (2nd call →
`positionsSettled: 0`, no 3rd order row).

**Backfill/same-day partition — strict, proven at 3 levels.** Pure-function
(`overdueExpiredOptionPositions`/`overdueExpiredFuturesPositions` use `<`,
`openExpiring*` uses `===`, engine tests 43-44 assert zero intersection),
DB-query level (`{ lt: todayExpiry }` vs `{ ...: todayExpiry }`, read
directly from the diffed source), and live (the same-day-tested position used
`FUTURES_EXPIRY_SETTLEMENT`/`LIVE_MARKET`, the backfill-tested positions used
`*_BACKFILL`/non-`LIVE_MARKET` bases, never crossed).

**UI wiring confirmed via the REAL exported `getAccountDetail` function**
(apps/web, called directly with DATABASE_URL pointed at the same local dev
DB, not reimplemented) against the fabricated account after settlement:
`optionPositions`/`futuresPositions` both empty (settled positions correctly
dropped out — replay.ts's `quantity !== 0` filter naturally excludes a
fully-closed contract, no special-casing needed), `pendingOrders` empty
(confirmed `listPendingOrdersForAccount` filters
`status: { in: ["PENDING","REJECTED"] }`, excluding CANCELLED — the cancelled
rows correctly vanish from the dashboard), and `recentOrders` surfaced all 5
settlement legs with the exact `squareOffReason`/`settlementBasis` pairs
written to the DB. `order-history-table.tsx`'s badge/disclosure logic was
code-reviewed (not live-rendered — no browser in this environment) and
traces correctly for every basis value.

**Cron auth + dryRun mechanics** — 401 with no header, 401 with wrong
secret, 200 via both `Authorization: Bearer` and the alternate
`x-cron-secret` header; dryRun accepted via both `?dryRun=true` query param
and POST body `{"dryRun":true}` (tested on 2 of the 3 routes).

**Gates**: `tsc --noEmit` clean on apps/api, apps/web, AND
packages/business-rules (all 3 explicitly re-run, exit 0). `eslint` clean on
every touched file in apps/api and apps/web (packages/business-rules has no
eslint config at all — pre-existing, not a gate, consistent with every prior
QA session on this package). `verify-papertrading-engine.ts`: 275/275,
independently re-run (not trusted from the CTO's claim). `ta:check`
(apps/web's UNRELATED TA-suite self-check, `lib/ta/selfcheck.ts`): 195/195 —
confirms zero regression bled into the concurrent TA-suite surface.
`prisma validate`: clean. Schema change is additive/nullable only
(`settlementBasis` nullable, 2 new enum values on each of 2 existing enums,
1 new enum) — confirmed already present in the generated Prisma client
(`node_modules/.prisma/client`, generated 10:22, AFTER the schema's last
edit at 10:04) via a live write+read round-trip, not just a string grep (the
first grep attempt against `node_modules/@prisma/client/index.d.ts` was a
false negative — that file is just a re-export shim; the real generated
types live in `node_modules/.prisma/client/index.d.ts`, worth remembering
for future sessions). No new migration file exists for this schema change
(likely `db push`, matching this repo's established convention for several
recent paper-trading sprints per commit history) — not flagged as a failure,
but worth a courtesy note that prod deployment needs its own explicit
push+deploy cycle.

**Methodology notes for future sessions**:
- A concurrent QA session's leftover test account
  (`qa-quote-liveness2@papertrading-qa.test`) was found in the same local dev
  DB during final cleanup verification — correctly identified as NOT mine
  (different email prefix, different creation timestamp) and left untouched,
  matching the task brief's explicit "other concurrent-sprint diffs... do
  not touch" instruction. Always check WHO owns a leftover row by its email/
  metadata before assuming a non-zero post-cleanup count is your own leak.
- A local dev Postgres DB with genuinely zero pre-existing paper-trading rows
  makes lib-level backdated-`now` global-sweep calls unconditionally safe
  (no blast-radius query needed) — but still worth a quick pre-test count
  query to confirm the empty-table assumption before relying on it, since an
  empty assumption that turns out wrong is exactly the scenario the
  prod-DB hard rule exists to prevent.
- `computeOptionOrderCosts`/`computeFuturesOrderCosts` return `{stt, gst,
  ...}` but the PaperOrder schema columns are `sttAmount`/`gstAmount` — a
  naive `...costs` spread into `prisma.paperOrder.create` throws
  "Argument sttAmount is missing." Always map field names explicitly when
  fabricating PaperOrder rows via the real cost-engine functions.

Test user (`qa-expiry-runner@papertrading-qa.test`), 1 account, 10
PaperOrder rows (4 opening + 4 settlement legs from the HTTP-route test + 1
opening + 1 settlement leg from the lib-level same-day test), 2
PaperPendingOrder rows, and 1 OptionPremiumSnapshot deleted this session in
FK order; re-query proof all 0 for this session's scope (global
PaperTradingAccount count stayed at 1 post-cleanup — confirmed to belong to
the other concurrent session, not a leak). 5 throwaway scripts across
`apps/api/scripts/` and `apps/web/scripts/` (plus 2 `/tmp` node scripts)
deleted, confirmed via `git status --porcelain | grep qa-expiry` (empty).
Dev server (port 3001, PID 76778 — already running at session start, not
started by me, per the task's "you have the dev-server slot... kill after")
killed, port confirmed free.
