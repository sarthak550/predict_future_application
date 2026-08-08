---
name: project-futures-contracts-tab-workbench-qa
description: QA pass 2026-08-09 for the futures-terminal replication of the chain-in-workbench feature (FuturesContractTable as a third [Ticket | Contracts | Strategy] tab) — static-only (no next build/dev), PASS, zero findings.
metadata:
  type: project
---

Files: `apps/web/components/paper-trading/futures-page-client.tsx`,
`apps/web/components/paper-trading/futures-contract-table.tsx` (added
`min-w-[640px]`), `apps/web/components/paper-trading/workbench/chart-
workbench.tsx` (new optional `chainLabel` prop, default `"Chain"`) —
uncommitted, baseline HEAD = d20c24e (the original options chain-tab
ticket, confirmed live in prod). Same hard constraint as the options
predecessor ticket ([[project_chain_tab_workbench_qa]]): no `next build`/
`next dev` (concurrent sprint building in the same repo touching
`lib/ta/*`, `workbench/kline-chart.tsx`, `pf-signals.ts`, `prisma/
schema.prisma` — correctly out of scope, ignored per the brief).

**Verdict: PASS.** All 5 requested checks clean:

1. Single-mount — one `contractTableElement` in `futures-page-client.tsx`
   (~line 497), referenced at both `ladder={workbenchOpen ? null :
   contractTableElement}` and `chain={contractTableElement}` inside the
   `{workbenchOpen && <DynamicChartWorkbench .../>}` block — mutually
   exclusive via the single `workbenchOpen` boolean (futures has only one
   workbench, unlike options' two, so no cross-workbench exclusion effect is
   needed here). Inside the open workbench, Ticket/Contracts/Strategy tabs
   are always-mounted + CSS `display:none/block` toggled
   (`chart-workbench.tsx` ~1014-1016) — genuinely single-mount on tab
   switches, same as the options predecessor. Same caveat as before applies
   to the OUTER ladder-slot↔workbench-prop swap (real unmount/remount by
   React reconciliation rules, not true state continuity) — see
   [[feedback_react_element_swap_not_true_single_mount]], non-blocking,
   pre-existing pattern being extended consistently, not re-flagged as a new
   finding.
2. `chainLabel` plumbing — `chart-workbench.tsx` diff against d20c24e is
   comment-only date fixes (2026-08-08→2026-08-04) plus the mechanical
   `chainLabel = "Chain"` default param and `{chainLabel}` interpolation
   replacing the hardcoded `"Chain"` string; the `chain &&` guards and button
   className logic are byte-identical. `options-page-client.tsx`'s diff is
   PURELY 4 doc-comment date corrections (2026-08-08→2026-08-04), zero
   behavioral lines changed — confirmed zero regression from the deployed
   d20c24e state. `futures-page-client.tsx` passes `chainLabel="Contracts"`.
   Equity dashboard (`paper-trading-dashboard.tsx`) passes no `chain` prop at
   all — unaffected, stays `[Ticket | Strategy]`.
3. Contract vs underlying semantics — `handleSelectContract` (ticket-only
   path) only sets `selectedContract`/`presetSide`/`presetLots`/preset order
   fields, never touches `underlying`; the chart is keyed purely on
   `underlying` (`key={underlying}` on the ladder's `PriceChart`,
   `chartKey={\`INDEX:${underlying}\`}` on the workbench) — contract-month
   selection never touches the chart, confirmed no code pretends otherwise.
   `onUnderlyingChange` (only reachable from inside the embedded Contracts
   tab once the workbench is open, since the outer ladder is null'd) is the
   only thing that calls `setUnderlying`, which live-updates `feed`/
   `chartKey` on the same still-mounted `DynamicChartWorkbench` instance (no
   remount — `workbenchOpen` itself is untouched by an underlying change).
   Traced `useWorkbenchAutoRestore`'s no-op'd `onRealChangeClose` the same
   way as the options predecessor: `underlying` resolves synchronously on
   first render (`deepLinkUnderlying ?? "NIFTY"`, never null), so
   `?workbench=1` F5-restore fires via `onFirstResolveOpen` on mount; the
   no-op is correct because the ladder-slot `FuturesContractTable` is null'd
   whenever the workbench is open, so the ONLY way `underlying` can change
   while open is the embedded table's own selector — a deliberate in-
   workbench browse, never a stale-workbench signal (identical reasoning,
   independently re-verified, not just trusted from the doc comment).
4. `min-w-[640px]` — inside `<div className="overflow-x-auto"><table
   className="w-full min-w-[640px] ...">` (`futures-contract-table.tsx`
   ~176-177) — scrolls, does not blow out the page; `w-full` preserved so
   the table still renders full-width at the wide TerminalShell ladder-slot
   width (overflow-x-auto is a no-op until the table's intrinsic width
   exceeds its container, same pattern `option-chain-browser.tsx` already
   uses).
5. `tsc --noEmit -p apps/web/tsconfig.json` exit clean, `eslint` on all 3
   changed files exit clean.

**No findings, blocking or non-blocking new.** `DynamicChartWorkbench`
(`workbench-maximize-button.tsx`) is a bare `next/dynamic` wrap of
`ChartWorkbench` — transparently forwards all props including the new
`chain`/`chainLabel`, no separate prop interface needed updating there.

**Methodology note**: static-only session again (concurrent sprint building
in the repo). Same live-smoke gap as the options predecessor: someone with
an exclusive build slot should open the futures terminal, maximize, switch
to Contracts, tap a different underlying (e.g. NIFTY→BANKNIFTY), and confirm
the chart updates live without a remount/flash — the code trace says it
should (identical `feed`/`chartKey` primitive-keyed effect mechanism as
options, already empirically unverified there too).
