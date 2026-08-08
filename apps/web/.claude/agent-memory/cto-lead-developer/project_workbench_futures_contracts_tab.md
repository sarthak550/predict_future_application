---
name: project_workbench_futures_contracts_tab
description: Futures contract table embedded as a workbench tab (2026-08-09), the direct follow-up to [[project_workbench_option_chain_tab]] — same `chain` prop, generalized with a new `chainLabel` prop.
metadata:
  type: project
---

Built 2026-08-09 as a direct founder assignment: "that chain option needs to
be in Futures as well" — follow-up to the options chain-in-workbench feature
(2026-08-08, commit d20c24e). tsc clean (apps/web), eslint clean on all 3
touched files, `ta:check` 164/164 (NOT 124 — the recorded baseline is stale;
this tree has a large amount of other uncommitted work from a concurrent
sprint touching `lib/ta/user-scripts.ts`/`pf-signals.ts`/`kline-chart.tsx`/
`app/dev/scripting-ss1-smoke` that neither this session nor the option-chain
session produced — verified via `git status` before touching anything, and
confirmed `ta:check` count is unaffected by MY change specifically since
`lib/ta` was never touched here). `next build` First-Load verified via an
actual stash-rebuild-compare (stashed the 3 touched files, rebuilt, popped,
rebuilt again): `/paper-trading` 137 kB (byte-identical, untouched),
`/paper-trading/options` 141 kB (byte-identical, untouched — the founder's
explicit "zero regression" constraint), `/paper-trading/futures` 135 kB
before AND after (own bundle 5.99 kB -> 6.01 kB, +0.02 kB, well inside the
brief's "≤1kB" allowance), shared 87.6 kB unchanged. Dynamic-import
invariant: the `workbench-maximize-button.tsx -> ./chart-workbench` entry
has the SAME 6 chunk files before and after this change (6, not the older
memory's "3" — that drift is pre-existing TA-suite growth, not from this
session or the option-chain session; verified via stash-rebuild-compare on
`react-loadable-manifest.json` specifically, isolating my change from the
concurrent sprint's own new `pf-signals` dynamic-import entry which now also
appears in that manifest and is NOT mine).

**Mechanism — reused `chain?: ReactNode` verbatim, added ONE new optional
prop.** `chart-workbench.tsx` gains `chainLabel?: string` (default `"Chain"`)
so the tab button text is no longer hardcoded — options' existing call site
needed zero changes (relies on the default), futures passes
`chainLabel="Contracts"`. No second mechanism was forked. Considered naming
it after the futures table's own on-page vocabulary ("Contract" is the
table's actual column header, singular) but chose "Contracts" (plural) to
read naturally as a tab label for a browsing view of multiple rows — no
existing page heading in `app/paper-trading/futures/page.tsx` or
`terminal-shell.tsx` names the ladder anything more specific to defer to
(TerminalShell's ladder slot has no title text of its own; the file's own
prose calls it "the futures contract table").

**`futures-page-client.tsx` wiring** — `contractTableElement` (the SAME
`FuturesContractTable` instance) built once with the identical props the
ladder slot always passed, swapped between `TerminalShell`'s `ladder` slot
(`null` while `workbenchOpen`) and the workbench's new `chain` prop — the
exact idiom `ticketElement`/options' `chainElement` already use.

**Contract-switch semantics (the one genuinely different finding vs
options)**: unlike options (chart depends on the SELECTED CONTRACT — strike/
expiry), the futures workbench's chart is keyed on `underlying` alone
(`chartKey={INDEX:${underlying}}`, `feed={kind:"index", symbol:underlying}`)
— it charts the INDEX SPOT, not a contract-specific series (no per-contract
premium chart exists for futures, only for options). Concretely:
- Picking a different CONTRACT MONTH (near/next/far) of the SAME underlying
  via `onSelectContract` only calls `setSelectedContract` + preset ticket
  fields — `underlying` never changes, so the chart is untouched. This was
  ALREADY true before this feature (ladder taps were always ticket-only for
  the chart) and remains ticket-only now that the table also lives inside
  the workbench — no new live-chart-switch behavior needed for this case.
- Picking a DIFFERENT UNDERLYING (NIFTY -> BANKNIFTY, via
  `onUnderlyingChange`) DOES change `chartKey`/`feed` on the SAME still-
  mounted `ChartWorkbench` instance (no `key` prop, matching every prior
  workbench sprint's discipline). Verified this refetches correctly by
  reading `use-workbench-candles.ts`'s equity/index branch directly: `url`
  is derived fresh from `feed.symbol` every render, the fetch effect is
  `useEffect(..., [url, isPremium])` — a brand-new symbol produces a new
  `url` and refetches immediately. (This generalizes the options-session's
  verification, which only checked the `optionPremium` branch's
  strike/expiry-keyed effect — this session additionally confirmed the
  equity/index branch's own primitive-keyed effect on a full symbol swap,
  not just a within-underlying strike change.)

**The one real behavioral fix — `useWorkbenchAutoRestore`'s close callback
no-op'd, same reasoning as options.** Before this feature,
`() => setWorkbenchOpen(false)` fired whenever `underlying` changed while
the workbench was open — correct at the time, because the ladder (unlike
options' chain browser) was NEVER null'd out of `TerminalShell` while the
workbench was open (futures had no chain-swap mechanism at all yet), so a
real `underlying` change could only come from that still-visible-behind-the-
modal ladder — a genuinely stale-workbench case. Now that
`contractTableElement` IS null'd out of the ladder slot and reachable ONLY
via the workbench's own Contracts tab, that's the ONLY way `underlying` can
change while the workbench is open — so, mirroring options exactly, the
close callback is now a no-op with the same "real page navigation unmounts
`FuturesPageClientInner` entirely via `remountKey`, so this can't mask a
genuinely stale workbench" argument.

**No `chartModeSwitcher`**: futures has only ONE chart (index spot always;
no separate contract-premium view the way options has an underlying/premium
toggle) — per the brief's own "if it has only one chart, skip it," the
futures `DynamicChartWorkbench` call omits the prop entirely.

**Width**: `futures-contract-table.tsx`'s table had NO `min-w` (unlike
`option-chain-browser.tsx`, which already had `min-w-[520px]` for 3 columns
— the reason THAT file needed no width fix in the options session). This
6-column table (Contract/Price/Day change/Basis vs spot/Held/Trade) would
have column-squished into an unreadable wrapped mess at the panel's 300px
floor instead of triggering its existing `overflow-x-auto` wrapper's scroll
— added `min-w-[640px]` to the `<table>` itself, same fix class as
option-chain-browser's, harmless at the wide ladder-slot width since
`overflow-x-auto` only engages once content actually exceeds its container.

**Not done this session (same posture as every prior workbench pass)**:
live/interactive QA in a real browser (open the futures workbench, use the
Contracts tab, switch underlying, confirm the chart swaps live with no
remount glitch, switch contract month and confirm it's ticket-only as
predicted, drag the panel to 300px and confirm the table horizontal-scrolls) —
no dev server/DB/authenticated session available this session.

**Files**: `apps/web/components/paper-trading/workbench/chart-workbench.tsx`
(`chainLabel` prop + doc updates, tab button now renders `{chainLabel}`
instead of hardcoded "Chain"), `apps/web/components/paper-trading/
futures-page-client.tsx` (`contractTableElement`, ladder slot swap,
`useWorkbenchAutoRestore` close callback no-op'd, workbench call gets
`chain`/`chainLabel="Contracts"`), `apps/web/components/paper-trading/
futures-contract-table.tsx` (`min-w-[640px]` on the table).
