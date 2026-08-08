---
name: project_option_chain_graceful_degradation
description: Option chain stale-serve graceful degradation shipped 2026-08-04 — allowStale opt-in design, 15-min bound, single-mount workbench confirmation
type: project
---

Shipped 2026-08-04: option chain fetcher (`apps/api/lib/marketMoves/optionChain.ts`)
now serves the last known-good chain snapshot (tagged `stale: true`, `asOf`
never re-stamped) for up to 15 minutes after a live NSE re-fetch fails,
instead of returning null immediately. Triggered by a founder complaint that
turned out to be the 9:15-9:30 IST market-open NSE flake window, not a real
pipeline outage — the actual product gap was that a single transient miss
blanked the whole ladder UI.

**Why 15 minutes**: long enough to span the worst observed NSE flake windows,
short enough that a ladder from an hour ago is never presented as live
("honesty law" — a founder-stated constraint). See `CHAIN_STALE_SERVE_MS` in
optionChain.ts.

**Design decision — `allowStale` is opt-IN, not opt-out**: `fetchOptionChain(underlying, expiry, opts?)`
defaults to its ORIGINAL fresh-or-null contract when `opts.allowStale` is
omitted. Only `apps/api/app/api/finance/options/chain/route.ts` passes
`{ allowStale: true }`. This was a deliberate alternative to the brief's
suggested "give settlement callers a freshOnly opt-out" — that would have
required editing `lib/paperTrading/{premiumCapture,optionsExpiry,stockOptionSquareOff,limitOrderFill}.ts`,
which were explicitly off-limits (concurrent expiry-settlement sprint owned
that directory at the time). Opt-in-by-default achieves identical safety
(zero behavior change for every existing caller, verified via `tsc --noEmit`
across the whole apps/api project) with zero touches to restricted files.
**If this pattern comes up again** (a shared fetcher needs new default
behavior but callers are off-limits): prefer flipping the new behavior to
opt-in rather than opt-out — it sidesteps needing write access to every
caller.

**Callers and their freshness policy** (as of this ship): chain route (public
UI) = stale-tolerant, 15-min bound. Everything else (premium capture cron,
options/futures expiry settlement, limit-order fills, stock square-off,
futures put-call-parity mid-price derivation in `marketMoves/futuresQuote.ts`)
= fresh-or-null, unchanged, because they never pass the new 3rd arg.

**Cache restructure**: `chainCache` entries now separate `attemptedAt`
(governs the 60s no-hammer throttle, bumped on every attempt including
failures) from `lastGood`/`lastGoodAt` (only updated on success, never
cleared by failure). Memory-bounded at 500 entries via delete-then-set
insertion-order LRU (`touchChainCache`). Mirrors the pre-existing
never-overwrite-good-with-empty convention already used by
`fetchOptionChainExpiries` in the same file, but with an explicit `stale`
tag instead of that function's implicit indefinite-forever-cache (expiries
has no TTL bound at all on its stale fallback — confirmed still fine since
its cardinality is per-underlying only, ~216 max keys, no memory-bound need).

**Frontend** (`apps/web/components/paper-trading/option-chain-browser.tsx`):
full-panel error banner now ONLY shows when there's truly nothing to render
(first load / explicit reload with no prior data). A silent 30s poll that
fails, OR a poll that succeeds but returns `stale: true`, now shows a
non-blocking amber chip ("Live update delayed — showing HH:MM IST data,
retrying…") in place of the calm blue "Auto-updating" line, while the ladder
stays fully interactive. Two independent signals feed one `liveUpdateDelayed`
boolean: `chain?.stale` (server-driven) and `pollFailedSilently` (client-side
silent-poll-threw-outright, e.g. proxy 502/504/network error — a state the
server-side stale-serve doesn't cover since it never even returns a body).

**Confirmed via code read, not assumption**: `OptionChainBrowser` is a true
single-mount component shared between the standalone options page and the
workbench's "Chain" tab (`chart-workbench.tsx`'s `chain?: ReactNode` prop) —
options-page-client.tsx creates ONE element instance, relocated via
conditional CSS-hidden wrapper, never two separate mounts. So internal state
changes (the new chip logic) apply identically in both places automatically;
no per-mount edits were needed or made.

**Known pre-existing gap, NOT fixed by this ship (flagged as follow-up, not
in scope)**: once the full-panel hard error state is hit (chain === null),
`useVisiblePolling`'s `enabled` condition (`Boolean(expiry) && chain != null`)
means polling stops entirely — there is no auto-retry out of that state
short of the user changing underlying/expiry. This ship makes that state much
rarer (was any single transient 502, now requires 15 continuous minutes of
total NSE failure, or a never-yet-successful pair) but doesn't add a retry
mechanism. Worth a small follow-up (retry button, or a slow backoff poll even
while chain is null) if it's ever reported as still happening.

Files: `apps/api/lib/marketMoves/optionChain.ts`,
`apps/api/app/api/finance/options/chain/route.ts`,
`apps/web/components/paper-trading/option-chain-browser.tsx`. The web loopback
proxy (`apps/web/app/api/paper-trading/options/chain/route.ts`) needed NO
change — it already forwards the upstream JSON body and status verbatim, so
the new `stale`/updated `asOf` fields ride through for free.

See also [[project_paper_trading_phase1]] for the fetcher's original NSE
cookie-handshake architecture, and the "Chain Trading + SL/TP" /
"Charting Workbench" entries in the top-level CTO memory for the workbench's
single-mount `ticket`/`chain` prop precedent.
