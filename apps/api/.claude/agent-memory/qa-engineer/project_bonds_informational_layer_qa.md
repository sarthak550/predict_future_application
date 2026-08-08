---
name: project-bonds-informational-layer-qa
description: Bonds (GS/GB) informational layer QA pass 2026-07-26 — real ingest verified against local dev DB, found 2 genuine parser bugs
metadata:
  type: project
---

QA'd 2026-07-26 against real NSE bhavcopy data (Friday 2026-07-24 session — the
brief's stated "2026-07-25" is actually a Saturday, verified via `date -j`) using a
disposable `apps/api/scripts/qa-bonds-ingest.ts` (deleted after use) that replicated
the cron route's `upsertQuotes`/`upsertBonds` logic exactly, since the HTTP route
hardcodes `getIstSessionDate()` to "today" with no override param — backdating `now`
for a real fetch is safe per [[reference_prod_db_qa_methodology]]'s forward-date rule
(only forward dates are dangerous).

**Real, unanticipated GS parser bug found**: `apps/api/lib/marketMoves/bondName.ts`'s
`parseGsDisplayName` regex `/^(\d{3,4})GS(\d{4})$/` requires 3-4 digit coupon codes,
but real NSE data has legitimate 2-digit coupon symbols too (round-number coupons
like "68GS2060" = 6.80%, "92GS2030" = 9.20%). 5 of 45 GS bonds (11%) fell back to
raw symbol on the test session — contradicts the module's own doc comment claiming
GS was "verified against the real feed" and "works uniformly for 3- or 4-digit
coupon codes". A 2-digit code needs `/10` not `/100` to get the right percent, so
this isn't just a regex widen — the divisor logic needs a digit-count branch.

**GB parser fallback rate higher than the brief's "unverified" framing implied**:
10 of 44 SGB symbols (23%) fell back to raw symbol — NSE uses 1-2 letter month
abbreviations for some tranche eras (e.g. `SGBMR29XII`=Mar, `SGBN28VIII`=Nov,
`SGBOC28VII`=Oct, `SGBNV29VII`=Nov) that the regex's strict `[A-Z]{3}` doesn't
cover. This was flagged upfront by the CTO as "UNVERIFIED", is logged (not silent),
and degrades gracefully — treated this as a documented gap to refine, not a hard
FAIL, unlike the GS bug above which contradicted its own stated verification.

Also confirmed (working as designed, not a bug): two GB symbols in the same month
with different tranche suffixes collide to an identical displayName
(`SGBOCT27`/`SGBOCT27VI` → "Sovereign Gold Bond October 2027",
`SGBJAN29IX`/`SGBJAN29X` → "Sovereign Gold Bond January 2029") — the brief
explicitly says tranche disambiguation is out of scope, this is intended.

Everything else clean: T6 cross-contamination zero, idempotent re-run (89→89, no
dupes), StockEodQuote session count unchanged by the bond upsert path, /bonds and
/bonds/[symbol] serve real data with disclaimer footer and zero buy/order UI, search
route (empty-query defaults, partial-symbol, "GOI", "gold" queries) all correct with
`/bonds/[symbol]` hrefs, other-category regression (RELIANCE exact-match #1, NIFTY
METAL surfaces, futures tab 5 entries) all held — but only once `apps/api` dev
server was also running on :3001, since `apps/web`'s index search proxies to it via
`API_INTERNAL_URL`; a lingering dev server from a prior QA session was already up on
3001, worth checking `lsof -ti :PORT` before assuming a fresh start is needed.

Verdict: overall FAIL — GS 2-digit-coupon bug must be fixed before ship (contradicts
its own "verified" doc claim, real user-facing quality regression on legitimate
bonds). GB month-abbreviation gap should be fixed in the same pass since the CTO
will already be in `bondName.ts`. Everything else (ingest, isolation, idempotency,
pages, search) is solid and does not need rework.

**RE-VERIFIED 2026-07-26, same day — overall PASS.** CTO fixed both bugs in
`bondName.ts` only (confirmed scope via targeted re-check per coordinator instruction,
did not redo A/C/D/E/F/G). GS regex widened to `\d{2,4}` with a digit-count-branched
divisor (2 digits → `/10`); all 5 previously-fallback GS symbols now parse correctly
(68GS2060→6.80%, 92GS2030→9.20%, 71GS2034→7.10%, 73GS2053→7.30%, 74GS2062→7.40%),
1018GS2026 still correct, 697GR2034 still correctly falls back (documented GR-series
edge case, regex deliberately not widened to match it). GB month token widened to
`[A-Z]{1,3}` with an expanded, individually-sourced abbreviation map — all 10
previously-fallback GB symbols now parse; the ambiguous "JU" token (June or July) is
scoped to the one real symbol it was verified against (NSE's own quote page title +
Equitymaster cross-check, both cited in-code) rather than a blanket rule, with an
explicit comment warning not to trust it for a future different "JU…" symbol without
re-verification — good defensive practice. Verified independently via a disposable
unit-level script (not the CTO's own claim) calling `parseBondDisplayName` directly
for all 12 symbols, then cross-checked against live DB state: exactly 1 of 89
BondEodQuote rows now has `displayName === symbol` (697GR2034, the only intended
fallback) — the true-upsert `displayName` recompute-on-every-run design meant the
existing 89 rows in the local dev DB reflected the fix without needing a re-ingest.
Doc comments rewritten with real fix history (dated, specific %s), no longer claim
false "verified/uniform" coverage. tsc --noEmit and eslint both clean on the
touched file. No dev servers needed for this pass — pure function + DB read checks.
