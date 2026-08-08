---
name: project_option_chain_stale_serve_qa
description: Option-chain graceful-degradation (stale-serve) QA — PASS, zero bugs, static-only 2026-08-04
metadata:
  type: project
---

Ticket: option-chain graceful degradation for the 9:15-9:30 IST market-open NSE flake window.
Files: apps/api/lib/marketMoves/optionChain.ts, apps/api/app/api/finance/options/chain/route.ts,
apps/web/components/paper-trading/option-chain-browser.tsx. Static-only pass (no build/dev server —
build slot owned by a concurrent sprint). Verdict: PASS, zero findings.

What was verified:
- Freshness safety: grepped every `fetchOptionChain(` call site across apps/api. Only the browsing
  route (`app/api/finance/options/chain/route.ts`) passes `{ allowStale: true }`. All 5 settlement/fill
  paths (premiumCapture.ts, optionsExpiry.ts, stockOptionSquareOff.ts, limitOrderFill.ts,
  futuresQuote.ts) call it with zero/default opts → allowStale defaults false → fresh-or-null,
  byte-identical to the pre-change contract. Confirmed by diff-tracing the old
  `chainCache = new Map<string,{at,data}>()` against the new `ChainCacheEntry` shape: every
  non-opt-in code path (`resolveStaleOrNull` returns null when `!allowStale`) produces the exact
  same return value the old code did in both the cache-hit and fresh-failure branches.
- Honesty: `asOf` is set exactly once, inside `fetchOptionChainUncached`, from the upstream's own
  `records.timestamp`. The stale-serve path (`resolveStaleOrNull`) does `{ ...entry.lastGood, stale: true }`
  — a shallow spread that carries the original `asOf` forward untouched. `lastGoodAt` (wall-clock
  fetch time), not `asOf` (upstream's IST label), drives the 15-min `CHAIN_STALE_SERVE_MS` bound —
  deliberately, per an inline comment, because `asOf` can lag real fetch time near market close.
  After the 15-min window, `resolveStaleOrNull` returns null and the route genuinely 502s.
- Throttle integrity: `attemptedAt` bumps unconditionally on every fetch (success or failure) via
  `touchChainCache`, preserving the 60s no-hammer window even while NSE is down. `lastGood`/`lastGoodAt`
  are carried forward verbatim on a failure (`cached?.lastGood ?? null`), never cleared by one. The
  500-entry LRU (`touchChainCache`: delete-then-set for MRU-move, evict `.keys().next().value` when
  oversize) is a correct standard JS-Map LRU pattern.
- UI states: `liveUpdateDelayed = pollFailedSilently || Boolean(chain?.stale)`. Fresh → blue
  "Auto-updating" chip. Delayed → amber chip using `asOfLabel` (derived from the never-restamped
  `chain.asOf`), clears when a poll both parses AND comes back non-stale (a stale-tagged poll clears
  `pollFailedSilently` but NOT `liveUpdateDelayed`, correctly — server is still degraded).
  Underlying/expiry switch clears it via the `[expiry, loadChain]` reset effect — verified the edge
  case where two underlyings share the same nearest expiry string still retriggers the effect,
  because `loadChain`'s own identity depends on `[underlying, expiry]` and changes regardless.
  Hard error (`chainError`) unchanged — diff confirms it's still gated to `!opts.silent` failures
  with nothing on screen.
- Web proxy (`apps/web/app/api/paper-trading/options/chain/route.ts`) is untouched (confirmed via
  `git status`) and forwards `body`+`upstream.status` verbatim — the new `stale` field rides through
  with zero proxy changes needed, exactly as the CTO's file list claimed.
- Both mounts (`options-page-client.tsx` standalone + `chart-workbench.tsx` Chain tab) import the same
  component; the diff only touches internal state, no new props/context assumptions.
- tsc --noEmit clean on both apps/api and apps/web tsconfigs. eslint --format json confirmed 0
  errors/0 warnings on all three changed files (verified real execution, not a silent no-op).

Methodology note: this was a pure code-trace + diff-read audit, no live NSE hit and no dev server —
explicitly barred because a concurrent sprint owned the build/dev slot. Confidence came from reading
the actual diff hunks (not just the final file state) to confirm the change was surgical and matched
every claim in the CTO's doc comments word-for-word.

See also [[project_paper_trading_limit_orders_qa]] and [[project_bonds_informational_layer_qa]] for
this repo's other paper-trading-adjacent QA passes.
