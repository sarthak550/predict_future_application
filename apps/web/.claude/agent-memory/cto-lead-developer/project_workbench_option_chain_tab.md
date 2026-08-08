---
name: project_workbench_option_chain_tab
description: Option chain browser embedded as a 3rd workbench tab (2026-08-08) — [Ticket | Chain | Strategy], live strike-switch in the maximized premium chart, cross-workbench mode switcher. Builds on [[project_workbench_program]] and [[project_ta_suite_s3]].
metadata:
  type: project
---

Built 2026-08-08 as a direct founder assignment: "option chains should also be
visible when chart mode is maximized so the user can change strikes on the
enlarged chart." tsc clean (apps/web), eslint clean on both touched files,
`ta:check` 124/124 unchanged (lib/ta untouched), `next build` succeeds with
**First Load JS byte-identical to the pre-change baseline** for all 3
terminal pages (verified via an actual stash-rebuild-compare, not assumed
from memory — see below): `/paper-trading` 137 kB, `/paper-trading/futures`
135 kB, `/paper-trading/options` 141 kB, shared 87.4 kB. Dynamic-import
invariant re-verified programmatically: `react-loadable-manifest.json` still
exactly ONE entry (3 chunk files), zero overlap with any of the 3 terminal
pages' `app-build-manifest.json` sync file lists.

**Verification note on First-Load "unchanged":** the S1-era memory's
recorded baseline (136/135/140 kB) predates a large amount of already-
uncommitted work in this tree (limit orders, bonds layer, futures sprint 2,
etc. — see `git log`), so it was NOT a valid comparison point. Stashed just
the 2 files this session touched, rebuilt (137/135/141 kB), popped the
stash, rebuilt again (137/135/141 kB) — genuinely byte-identical at 3-sig-fig
precision before/after this specific change. Worth repeating this
stash-rebuild-compare pattern for future First-Load gates in a tree with
other uncommitted work, rather than trusting a stale recorded number.

**Mechanism — `chart-workbench.tsx` gains 2 new optional, fully generic
props** (no options-specific knowledge leaks into this file):
- `chain?: ReactNode` — when present, right panel becomes `[Ticket | Chain |
  Strategy]` (3 tabs); absent (equity/futures terminals, unchanged callers),
  stays `[Ticket | Strategy]`. Rendered in its own `display:none/block`
  wrapper alongside Ticket, ALWAYS mounted whenever the prop is present
  (unlike Strategy's `hasOpenedStrategyTab` lazy-mount gate — Chain is an
  externally-owned single-mount element per the ticket precedent, so it must
  never unmount on a tab switch, whether or not the user has opened that tab
  yet).
- `chartModeSwitcher?: { label: string; onClick: () => void }` — an optional
  top-bar pill (next to ticket-collapse/minimize) for jumping to a sibling
  workbench without minimizing first. Deliberately just `{label, onClick}` —
  chart-workbench.tsx never needs to know what "the other chart" means.

**`options-page-client.tsx` wiring** — `chainElement` is built ONCE
(identical props the ladder slot always passed:
`onSelectContract={handleLadderAction}`, `onChainData={handleChainData}`,
same deep-link props), then swapped between `TerminalShell`'s `ladder` slot
(`null` while any workbench open) and both `DynamicChartWorkbench` calls'
new `chain` prop — the EXACT conditional-swap idiom `ticketElement` already
used. Both workbenches also get `chartModeSwitcher`: underlying workbench ->
"Contract premium" (disabled/absent if no contract selected, mirrors the
existing outer toggle's gate); premium workbench -> "Underlying" (also sets
`chartUnderlying` explicitly to `selectedContract.underlying`, since it can
legitimately differ from whatever the last-browsed chain's underlying was).

**The one real behavioral fix, not just plumbing — `useWorkbenchAutoRestore`'s
"close on real change" callback had to become a no-op for BOTH workbenches.**
Before this feature, `chartUnderlying`/`contractKey` changing while a
workbench was open triggered an auto-close ("a stale workbench for the
PREVIOUS contract must never linger" — see `use-workbench-url-param.ts`'s own
doc). That behavior was previously UNREACHABLE in practice: the only thing
that could change those values was the ladder browser's own interaction, and
before this feature the ladder stayed mounted-but-invisible behind the
workbench portal (never null'd out) — so it was dead defensive code. Now that
the SAME chain browser is deliberately reachable INSIDE the workbench (the
whole point of this feature), a strike/underlying change from the embedded
Chain tab is the ONLY way those values can change while a workbench is open —
so the fix is to no-op the close callback for both, letting the new
`feed`/`chartKey` props flow through to the already-mounted `ChartWorkbench`
instance instead of tearing it down. Confirmed no other path can reach this
now-no-op branch: a real page-level navigation (different deep-link) remounts
`OptionsPageClientInner` entirely via its `remountKey` wrapper, never hits
this hook's "real change after first resolve" branch.

**Verified — NO changes needed to `useWorkbenchCandles`, `useChartDrawings`,
or `kline-chart.tsx`** for the live feed/chartKey switch itself (confirmed by
reading each hook's own dependency arrays, not assumed):
- `useWorkbenchCandles`'s premium branch fetch effect is keyed on
  `[isPremium, premiumUnderlying, premiumExpiry, premiumStrike, premiumType]`
  — all derived fresh from the `feed` prop every render, so a new contract
  naturally refetches premium history and resets `sessionTicks`.
- `useChartDrawings(chartKey)` is called directly in `ChartWorkbench`'s body
  (not memoized across renders) — its `load` callback is keyed on `chartKey`,
  so a chartKey change gives it a new identity, re-firing the
  `useEffect(() => void loadDrawings(), [loadDrawings])` effect and replacing
  `drawings` wholesale for the new chartKey.
- `kline-chart.tsx`'s own drawings-hydration effect is id-diffed against
  `hydratedRowIdsRef` (not a manual chartKey listener) — when `drawings`
  swaps to a totally different contract's row-id set, every OLD row id
  vanishes from the new array and gets cleanly `removeOverlay`'d by the
  existing "row that left `drawings`" cleanup branch, while every NEW row id
  gets created fresh. A full resync falls out of the existing id-diff logic
  for free.
- `kline-chart.tsx`'s candle data effect keys on `firstTs` (first candle's
  timestamp) as one of its "full reload" triggers (`windowShifted`) — a
  brand-new contract's candle array has a different `firstTs` by
  construction, so it already takes the `chart.setPeriod(...)` full-reload
  path (same path an interval switch takes), never the tail-advance path. No
  `key` prop was ever added to either `DynamicChartWorkbench` call site — the
  SAME `ChartWorkbench`/`KlineChart` instance survives a strike switch, by
  design, verified against the installed klinecharts source (same discipline
  as every prior workbench sprint).

**One small gap fixed defensively, not requested by the brief but same class
of bug**: added a `prevChartKeyRef`-gated effect in `chart-workbench.tsx`
that calls `cancelActiveDrawing()` + clears `selectedDrawing`/`textPopover`
on a REAL `chartKey` change — an in-progress draw or a floating style-editor
referencing an overlay id from the PREVIOUS contract's canvas must not
silently carry over onto the new one.

**Width**: no changes needed to `option-chain-browser.tsx` — its CE|Strike|PE
table already had `overflow-x-auto` + `min-w-[520px]` on the wrapper (the
exact "horizontal scroll fallback, never clipped columns" the brief asked
for), which already tolerates the panel's full 300-560px
(`PANEL_MIN_WIDTH`/`PANEL_MAX_WIDTH` in `panel-resize-handle.tsx`) range.

**Deliberately out of scope, flagged for the founder**: switching the
UNDERLYING symbol itself (not just a strike) from the Chain tab embedded in
the UNDERLYING workbench will still auto-close that workbench (the
`chartUnderlying`-keyed `useWorkbenchAutoRestore` close callback was no-op'd
too, for symmetry and to prevent a confusing self-close — but the brief's
own scope only asked for strike selection "prefills the ticket + updates
selectedContract," not a live underlying-swap of the workbench's own chart;
if the founder wants the underlying workbench's OWN feed to also live-switch
symbols, that's a bigger change — `feed`/`chartKey`/`title` would all need to
derive from the newly-picked underlying, not the workbench's original one).

**Not done this session (same posture as every prior workbench pass)**:
live/interactive QA in a real browser (open both workbenches, use the Chain
tab, tap a strike, confirm the premium chart switches live with no flash/
remount glitch, drag the resize panel to 300px and confirm the chain table
horizontal-scrolls instead of clipping, verify the chartModeSwitcher pill
round-trips correctly including the `?workbench=` URL param) — no dev
server/DB/authenticated session available this session.

**Files**: `apps/web/components/paper-trading/workbench/chart-workbench.tsx`
(`chain`/`chartModeSwitcher` props, 3-tab control, chartKey-switch cleanup
effect), `apps/web/components/paper-trading/options-page-client.tsx`
(`chainElement`, `anyWorkbenchOpen`, both `useWorkbenchAutoRestore` close
callbacks no-op'd, `handleSwitchToPremium`/`handleSwitchToUnderlying`, both
`DynamicChartWorkbench` calls widened with `chain`/`chartModeSwitcher`).
