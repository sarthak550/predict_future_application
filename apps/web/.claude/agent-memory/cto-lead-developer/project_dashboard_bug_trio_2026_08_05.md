---
name: project_dashboard_bug_trio_2026_08_05
description: Audit of the killed-mid-work dashboard bug-trio session (symbol-lost-on-refresh, frozen Delayed LTP, always-green avg-price line) — found already complete, shipped as-is with zero code changes.
metadata:
  type: project
---

2026-08-05: resumed the paper-trading dashboard bug-trio a prior CTO session was
killed mid-work on (see [[project_pause_state_2026_08_04]] section 3 in the
CEO's cross-project memory for the original pause snapshot). Audited all 10
touched files hunk-by-hunk against the 3 founder bugs. Verdict: the inherited
diff was **already complete and correct** — zero code changes were needed.
Confirmed via tsc (clean), eslint (clean, all touched files), ta:check
(514/514, unchanged baseline).

**What the partial work actually did (all present, all sound):**
- BUG1 (focused symbol lost on refresh): `?symbol=`/`?focus=` made into a
  live, continuously-synced persistence channel (`useSymbolUrlParam`/
  `useFocusUrlParam` in use-workbench-url-param.ts) alongside a genuinely
  one-shot deep-link channel for side/productType/quantity
  (`useFrozenSearchParams` + `useStripOneShotParams`) — solves the
  same-commit-clobber race via reading `window.location.search` fresh at
  WRITE time (not the React-tracked stale snapshot) in every setter. Wired
  identically on all 3 terminal pages (dashboard/futures/options).
  `?focus=`/`?symbol=` deliberately excluded from each page's `remountKey`
  (same treatment `?workbench=` already got) so the persistence write-back
  doesn't self-trigger an unwanted remount.
- BUG2 (frozen "Delayed LTP" text): new `liveLtp` prop threaded
  dashboard's already-running `chartQuote` (from PriceChart's existing
  `useLiveQuoteTick`/`onQuoteChange`, the SAME 4.5s stream the chart uses —
  no second poll) into NewTradeForm's ticket price line and into the
  focused holdings row only (documented boundary: non-focused rows stay on
  the account payload's load-time snapshot). Verified futures/options pages
  did NOT need this: their underlying chart already uses the same
  PriceChart w/ quoteSource live-tick, and their ticket's contract.premium/
  price already refreshes via the existing ~30s chain/contract poll — never
  exhibited the "frozen until refresh" pattern, so correctly left untouched.
- BUG3 (avg-price line always green): `orderLineColor()` factored into
  chart-order-lines.ts (the shared module price-chart.tsx AND
  terminal/premium-chart.tsx both import from) — colors a `"position"` line
  by live unrealized P&L (long: green iff price>avg, short inverted, exact
  equality/no-price-yet: neutral gray), not static long/short. Workbench's
  own overlay (order-line-overlay.ts + kline-chart.tsx) got the same fix
  independently since it can't share React-side color computation — new
  `currentPrice` field on `PfOrderLineExtendData`, sourced from
  use-workbench-candles.ts's own already-live last-candle-close, with a
  `latestClose` primitive dep added to kline-chart's overlay-sync effect so
  a position line's color flips live on every tick. Since the fix lives in
  the ONE shared function, it automatically covers every position-line
  surface (dashboard chart, futures underlying chart via the same
  PriceChart, options premium chart, workbench) with no per-surface drift
  risk.

**Cross-contamination check (explicitly required by the brief):** confirmed
clean — use-workbench-candles.ts's diff is 100% the SEPARATE, unrelated
interval-race + rollover-stall candle fix (tagged plain `2026-08-04`,
[[project_pause_state_2026_08_04]] item 1), zero overlap with the dashboard
bug-trio's `2026-08-04b` tag. workbench/user-scripts/ (item 2, drawer
overhaul) also untouched by this diff.

**Lesson for future "audit a killed-mid-work session" tasks:** don't assume
incompleteness — verify hunk-by-hunk against gates AND the original bug
repro logic before writing new code. This session's prior CTO had actually
finished the work; the kill was mid-*verification*, not mid-*implementation*.
Forcing "fixes" onto working code would have been pure risk. See
[[feedback_verify_cto_claims]] in the CEO's memory for the mirror-image
lesson (verify claimed-done work) — this is the same discipline applied to
a self-audit.
