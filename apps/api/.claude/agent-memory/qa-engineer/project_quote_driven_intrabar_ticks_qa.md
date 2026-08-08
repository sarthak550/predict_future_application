---
name: project_quote_driven_intrabar_ticks_qa
description: Quote-driven intrabar ticks (live-market founder-incident fix) QA — initial FAIL on one regression (bonds page quote-poll 404 spam), CTO fixed same day, re-verified PASS. 2026-08-04.
metadata:
  type: project
---

**UPDATE (same day, re-verify pass): PASS.** CTO fixed the bonds regression
by making `quoteSource` tri-state (`{url} | false | undefined`), with
`false` as an explicit, required never-poll opt-out. `bonds/[symbol]/
page.tsx` now passes `quoteSource={false}` with a comment naming the
regression this exists to prevent. Re-verified:
- **Code trace of the guard**: `effectiveQuoteUrl = quoteSource === false ? null : (quoteSource?.url ?? (intradaySource ? null : defaultEquityUrl))`
  — the `=== false` check is evaluated FIRST as a real branch condition
  (not a fallback), so `false` cannot be silently widened/ignored. Confirmed
  this matters: `quoteSource?.url` alone (optional chaining) does NOT
  short-circuit on `false` the way it does on `null`/`undefined` (`false?.url`
  evaluates to `undefined` via JS's primitive property-access semantics, not
  a short-circuit) — so without the explicit `=== false` branch checked
  first, a `false` value would silently fall through to the buggy
  default-equity-URL branch. The fix's ordering is load-bearing, not
  cosmetic.
- **Call-site audit**: personally enumerated all `<PriceChart>` render paths
  (7 JSX call sites, 8 behavioral paths counting `/instruments/[symbol]`'s
  internal `isIndex` branch) — confirms the CTO's own claimed "8 render
  paths" count. Exactly one omit-both site was ever broken (bonds); the
  other omit-both sites (`/instruments/[symbol]` equity branch, `paper-
  trading-dashboard.tsx`, `options-page-client.tsx`'s stock-underlying
  branch) all genuinely want the equity default. The two "explicit
  `intradaySource`+`quoteSource`" index-terminal sites (futures/options)
  build their objects unconditionally once `underlying` is guaranteed
  non-null by an early return — never silently degrade to omit-both.
- **Live repro, bonds (Playwright + server logs, both apps/web AND
  apps/api layers)**: `/bonds/SGBDEC26`, clicked "1D", waited 12s — **0**
  quote calls (was 2, 404ing, before the fix). Only the pre-existing,
  unrelated one-shot `/intraday` 404 still fires, unchanged.
- **Live repro, equity default still works**: `/instruments/RELIANCE`,
  clicked "1D" — footer note still flips to "+ live", 3 quote calls at
  4505/4512ms — matches `LIVE_QUOTE_POLL_MS`. Equity default fully intact.
- **tsc/eslint**: clean on both changed files (`price-chart.tsx`,
  `bonds/[symbol]/page.tsx`).
- **Workbench click-through gap closed**: the concurrent sprint's
  `settlementBasis` migration landed since the original pass (confirmed via
  `information_schema.columns`), unblocking `/paper-trading`. Opened the
  maximized workbench live (disposable test user, real browser): 5 quote
  calls at 4505/4507/4493/4507ms, heartbeat chip showed the correct
  fast-cadence tooltip and a real advancing "Updated HH:MM:SS", order
  ticket showed a live-sourced last price — confirms the SAME
  `useLiveQuoteTick` mechanism fires correctly inside the actual workbench,
  not just the small terminal chart. (Picked a thin, low-liquidity stock by
  accident via a fuzzy symbol search — 2 screenshots ~9s apart looked
  visually identical, most likely because that specific stock's LTP simply
  didn't tick during that exact window, not a bug — the network/heartbeat
  evidence is the load-bearing confirmation here, not the screenshot diff.)

Both disposable test users deleted (re-query confirmed), all scratch
scripts removed (confirmed via `git status --porcelain`), both dev ports
freed, `.next` removed.

**Overall verdict for the whole ticket: PASS.** See full original findings
below (still accurate for everything except the bonds item, which is now
fixed).

QA pass for [[project_quote_driven_intrabar_ticks]] (CTO's own memory,
`apps/web/.claude/agent-memory/cto-lead-developer/`). Files: `apps/api/lib/
marketMoves/liveQuote.ts` (new), `/api/finance/instruments/[symbol]/quote`
+ `/index/[symbol]/quote` (new, both layers), `apps/web/components/paper-
trading/use-live-quote-tick.ts` (new), `use-workbench-candles.ts` (fold +
runningExtremesRef + liveTicksActive), `price-chart.tsx` (quoteSource prop),
`futures-page-client.tsx`/`options-page-client.tsx` (wiring),
`chart-workbench.tsx` (cadence copy). Ran during a LIVE NSE session
(2026-08-04 ~10:22 IST) — used that deliberately for the runtime checks.

**Verdict: FAIL — one regression, everything else clean.**

## What passed

- **Runtime quote endpoints (curl, live market)**: both `/api/finance/
  instruments/RELIANCE/quote` (direct) and the `apps/web` proxy: 200s,
  `Cache-Control: no-store` on both layers, back-to-back hits (within the
  4s TTL) return byte-identical `asOf`, spaced hits (~4-8s apart) advance
  `asOf` and `price` — genuinely live, price moved 5+ times across a 20s
  poll window on both RELIANCE and NIFTY.
- **Honesty of the candle-merge (code trace, not reimplemented)**:
  `foldQuoteIntoCandles` + `runningExtremesRef` in `use-workbench-candles.ts`
  — traced the exact monotonic-wick mechanism: `runningHigh`/`runningLow`
  passed in are `sameBar ? Math.max(running.high, last.high) : last.high`
  (never re-derived from a re-fetched base alone), the bucket-window check
  (`tick.asOf < last.timestamp || tick.asOf >= last.timestamp + intervalMs`)
  correctly drops out-of-window ticks without touching the bar, the
  commit-phase `useEffect` updates the ref from `displayCandles` (not
  during render), and a genuine new-bar rollover (`running.barTimestamp !==
  last.timestamp`) correctly resets to the server's own fresh high/low
  instead of carrying a stale bar's extremes forward. No shrinking-wick path
  found. This matches the CTO's own memory note's description exactly —
  independently re-derived, not trusted from the note.
- **Gating**: `isNseWeekdayMarketHours` (business-rules) is a pure
  `Date`-only function, safe to import client-side (confirmed no
  server-only deps). Checked in BOTH `useVisiblePolling`'s `enabled` arg
  AND again inside `fetchOnce` itself in `use-live-quote-tick.ts` — real
  belt-and-braces, confirmed by reading both call sites. Only 2
  `useLiveQuoteTick` call sites exist in the whole repo (price-chart.tsx,
  use-workbench-candles.ts) and exactly 1 `useWorkbenchCandles` call site
  (chart-workbench.tsx) — "only the active chart polls" claim holds by
  construction, confirmed via grep. `INTRADAY_INTERVAL_MS` has no `"1d"`
  key → `intervalMs` is `undefined` for daily → `liveTicksEnabled` is
  `false` — the "1d never ticks" claim verified via code (not browser-
  verified live, see gap below; the logic is simple/deterministic enough
  that this is low risk).
- **Indices regression check — PASS, live Playwright**: `/indices/NIFTY-50`
  loaded, watched network for 15s: **0** quote calls. Passes
  `intradaySource`, so `effectiveQuoteUrl` correctly resolves to `null`.
- **Real-browser confirmation of the live-tick mechanism — PASS**:
  `/instruments/RELIANCE`, clicked "1D", watched for ~20s: footer note
  flipped to "1-minute ticks + live", the displayed last price genuinely
  changed across reads (₹1,301.4 → ₹1,301.9 → ₹1,301.4), and exactly 5
  quote calls fired at **4491/4499/4505/4508ms** intervals — matches
  `LIVE_QUOTE_POLL_MS = 4500` almost exactly. Strong evidence the shared
  `useLiveQuoteTick` infrastructure (same hook backs both the small
  terminal charts AND the workbench) is correct end-to-end in a real
  browser, not just in curl.
- **Gates**: `tsc --noEmit` clean on both `apps/web` and `apps/api`;
  `eslint` 0 errors/0 warnings on all 9 touched/new files; `npm run
  ta:check` 195/195 (unchanged, as claimed); `verify-papertrading-engine.ts`
  275/275 (matches the OTHER concurrent sprint's drifted baseline the
  brief pre-warned about, NOT a regression from this ticket — confirmed
  target files' diff stats unchanged from what I originally read, at
  session end). `next build` not re-run per the brief's explicit
  instruction (trusted the CTO's own stash-compared First-Load numbers).

## The one FAIL — bonds page quote-poll 404 spam (genuine new regression)

`apps/web/components/finance/price-chart.tsx` line 398:
```ts
const effectiveQuoteUrl = quoteSource?.url ?? (intradaySource ? null : `/api/instruments/${encodeURIComponent(symbol)}/quote`);
```
This correctly goes `null` (poll off) when a caller passes `intradaySource`
without `quoteSource` (the indices page's pattern — verified PASS above).
But `apps/web/app/bonds/[symbol]/page.tsx` (line 101-105) passes **neither**
`intradaySource` nor `quoteSource` — it was never given an "off" signal the
indices page has, because bonds never needed an `intradaySource` override
in the first place (bonds have no separate index-shaped intraday endpoint).
The fallback logic can't distinguish "omitted both because this IS a plain
equity page" (the `/instruments/[symbol]` case, intentional default) from
"omitted both because this caller has nothing to do with equity quotes at
all" (bonds). Result: `effectiveQuoteUrl` defaults to
`/api/instruments/{bondSymbol}/quote` for bonds too.

**Reproduced live, both statically and in a real browser**: at page load
(`defaultTimeframe="MAX"`), the poll correctly stays off — 0 quote calls
(this is why a naive "load the page and check Network" smoke test would
MISS this). But `"1D"` is unconditionally offered as a timeframe chip
(`TIMEFRAMES.filter` always includes `t.key === "1D"`), and clicking it
starts `useLiveQuoteTick` regardless of whether the intraday fetch itself
succeeded. Playwright: navigated to `/bonds/SGBDEC26`, clicked "1D", waited
12s — **2 real quote calls** to `/api/instruments/SGBDEC26/quote`, spaced
~4.5s apart, both landing as genuine 404s confirmed in BOTH server logs:
```
apps/web: GET /api/instruments/SGBDEC26/quote 404
apps/api: GET /api/finance/instruments/SGBDEC26/quote 404
```
This means `apps/api`'s `lib/marketMoves/liveQuote.ts` genuinely fires a
real outbound Yahoo request for `SGBDEC26.NS` (a nonsense ticker) every
~4s for as long as any user sits on a bond's "1D" tab during market hours —
real wasted upstream load, not just a local 404. This directly contradicts
the ticket's own explicit "no 404 spam / Network quiet" requirement AND the
CTO's own shipped doc comment on `quoteSource` ("the indices/bonds pages
... at exactly their pre-existing behavior, zero risk, with no per-caller
opt-out flag needed") — that claim is TRUE for indices, FALSE for bonds.
Confirmed via `git diff` that this is a genuinely NEW behavior (pre-diff,
clicking "1D" on a bond page only ever fired ONE one-shot `/intraday` 404,
never a recurring poll) — not a pre-existing latent bug being merely
extended.

**Fix direction for the CTO**: `quoteSource`/`intradaySource`-both-omitted
currently has exactly one meaning ("default to bare-equity quote") with no
way for a non-equity caller to opt out short of inventing a fake
`intradaySource`. Needs an explicit off-switch — e.g. widen `quoteSource`'s
type to also accept `false` (or add a separate `disableLiveQuote?: boolean`
prop) and have `apps/web/app/bonds/[symbol]/page.tsx` pass it explicitly,
the same way indices opts out via `intradaySource`.

## Known gap — NOT independently browser-verified, environment-blocked

Could not open the maximized workbench (`chart-workbench.tsx`) in a real
browser this session. **Root cause, confirmed via server logs, unrelated to
this ticket**: a DIFFERENT concurrent sprint ("Expiry Settlement Backfill")
added `PaperOrder.settlementBasis` to `schema.prisma` with no migration
file yet (`ls prisma/migrations` confirms none references it) — the local
dev DB's `PaperOrder` table genuinely lacks that column, so
`getAccountDetail` (`apps/web/lib/paperTrading/queries.ts:398/591`, which
ALL THREE paper-trading terminal pages call for cash/balance) throws a
Prisma P2022 and every terminal page 500s on load ("Couldn't load your
Paper Trading account"). This is exactly the "OTHER uncommitted
concurrent-sprint work... EXPECTED, do not touch" the brief pre-warned
about — did NOT attempt to migrate/fix the DB (out of scope, risk of
conflicting with that sprint's own migration authorship, matches
[[feedback_serialize_schema_writes]]'s spirit). Substituted the closest
reachable equivalent: real-browser-verified the SAME shared
`useLiveQuoteTick` hook via `/instruments/RELIANCE` (see above, exact
cadence match) plus the full static code trace of `foldQuoteIntoCandles`/
`runningExtremesRef`. High confidence, but explicitly NOT the same as
watching the actual workbench candle wick live for several ticks — flag
this gap to whoever picks up workbench-specific QA next, once the other
sprint's migration lands.

**Also observed**: the working tree changed UNDER this QA session — a
THIRD, unrelated concurrent stream ("Delivery-holdings Sell button
2026-08-04") modified `paper-trading-dashboard.tsx`/`new-trade-form.tsx`/
`docked-order-ticket.tsx` mid-session (confirmed via `git diff` on those
files — a `?quantity=` deep-link param, nothing to do with either my
ticket or the expiry-settlement sprint). Did not touch these; confirmed via
diff-stat that my own 7 target files' change sizes exactly matched what I
originally read, so this wasn't caused by and didn't corrupt my QA target.
Multiple agents are clearly landing work in this SAME working tree
concurrently — worth flagging as a standing methodology risk (a QA session
mid-run cannot assume the tree is static).

## Test artifacts, cleanup

Disposable user `qa-quote-liveness@papertrading-qa.test` (id
`cmse6or550000e6u3qg4gotmq`) — no `PaperTradingAccount` was ever created
(blocked by the 500 above before creation), user row deleted, re-query
confirmed `null`. Two scratch scripts (`apps/api/scripts/qa-quote-liveness-
user.ts`, two root-level `qa-quote-liveness-playwright*.mjs`) deleted,
confirmed via `git status --porcelain`. Both dev server ports (3000/3001)
confirmed free via `lsof` at session end; `apps/web/.next` removed both
before AND after (per [[feedback_stale_next_dev_prod_mix]] — leave it
clean for the next session).

**How to apply**: this is a single, well-scoped, clearly-reproducible
regression — escalation policy says 1 failure = return to CTO with fix
instructions, one chance to fix without penalty, not an escalation to the
user about CTO quality yet.
