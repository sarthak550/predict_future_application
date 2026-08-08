---
name: project-chain-tab-workbench-qa
description: QA pass 2026-08-08 for the "option chain browser as a third [Ticket | Chain | Strategy] tab inside the maximized workbench" ticket — static-only (no next build/dev), PASS with one non-blocking finding.
metadata:
  type: project
---

Files: `apps/web/components/paper-trading/workbench/chart-workbench.tsx`,
`apps/web/components/paper-trading/options-page-client.tsx` (uncommitted).
Hard constraint that session: no `next build`/`next dev` (a concurrent
sprint was running builds in the same repo) — static code trace + `tsc
--noEmit -p apps/web/tsconfig.json` + `eslint` on the two files only.

**Verdict: PASS.** All 6 requested checks clean:

1. Single-mount law — `chainElement` constructed once in
   `options-page-client.tsx`, `ladder={anyWorkbenchOpen ? null :
   chainElement}` vs `chain={chainElement}` on either workbench, mutually
   exclusive (`anyWorkbenchOpen = workbenchOpen || premiumWorkbenchOpen`, the
   two booleans kept exclusive by an effect keyed on `chartMode`) — never
   two simultaneous instances. Inside an open workbench, Ticket/Chain/
   Strategy tabs are always-mounted + CSS `display:none/block` toggled
   (`chart-workbench.tsx` ~1006-1008) — genuinely no remount on tab
   switches. See non-blocking finding below for the OUTER ladder↔chain-prop
   transition, which is a different, pre-existing story.
2. Equity/futures regression — `git status` confirmed only the 2 files
   above touched; `paper-trading-dashboard.tsx`/`futures-page-client.tsx`
   still pass `ticket={workbenchOpen ? null : ticketElement}` with no
   `chain` prop; `chart-workbench.tsx`'s Chain button/pane are both gated on
   `chain &&`, so absent `chain` the right panel is byte-identical
   `[Ticket | Strategy]`.
3. Contract switch flow — hand-traced `useWorkbenchAutoRestore`'s two call
   sites (chartUnderlying for the underlying workbench, `contractKey` for
   the premium workbench) against every setter of those two values
   (`handleChainData`, `handleSwitchToUnderlying`, `handleSwitchToPremium`,
   the deep-link auto-select branch, the mutual-exclusion effect). The
   CTO's no-op'd `onRealChangeClose` callbacks are correct: the ONLY way
   `chartUnderlying`/`contractKey` can change while a workbench is open is
   now the embedded Chain tab's own browsing (ladder is null'd whenever any
   workbench is open, so no second chain-browser instance can fire
   `onChainData`) or the new `handleSwitchToUnderlying`/
   `handleSwitchToPremium` handlers, which already self-manage
   `workbenchOpen`/`premiumWorkbenchOpen` directly (bypassing the wrapped
   setters specifically to avoid a double `router.replace` race — verified
   this avoids a real bug: if `onRealChangeClose` were NOT a no-op, it would
   fire in the SAME post-commit effect pass as `handleSwitchToUnderlying`'s
   direct open call and immediately re-close the workbench it just opened).
   `?workbench=` URL restore-after-F5 and the mutual-exclusion effect both
   independently re-traced and still hold.
4. `prevChartKeyRef` effect in `chart-workbench.tsx` (~706-714) only calls
   `cancelActiveDrawing()`/`setSelectedDrawing(null)`/`setTextPopover(null)`
   — local UI/interaction state only. `useChartDrawings(chartKey)`'s own
   `load()` (keyed on `[chartKey]`) is what actually refetches/replaces the
   `drawings` array for the new chartKey (`use-chart-drawings.ts` line 95,
   full `setDrawings(...)` replace, no cross-contamination) — DB rows and
   the `persistedId` mapping are untouched by the defensive effect.
5. `chartModeSwitcher` — labels correct ("Contract premium" on the
   underlying workbench, "Underlying" on the premium workbench); the
   underlying workbench's switcher is conditionally rendered only when
   `selectedContract` is truthy AND `handleSwitchToPremium` itself
   independently guards `if (!selectedContract) return` (double guard, no
   way to open a premium workbench with a null contract).
6. `tsc --noEmit -p apps/web/tsconfig.json` exit 0, `eslint` on both files
   exit 0.

**Non-blocking finding** (recorded in detail at
[[feedback_react_element_swap_not_true_single_mount]]): the OUTER swap —
moving `chainElement`/`ticketElement` between `TerminalShell`'s slot and
`ChartWorkbench`'s prop — is not actually a continuous single mount by
React reconciliation rules (different parent subtree = real unmount then
remount), so `OptionChainBrowser`'s local state (search/filter, selected
mode, expiry) resets and its 30s poll restarts every time a workbench opens
or closes. This is NOT new to this ticket (the identical `ticketElement`
swap has existed since the W2 sprint, [[project_workbench_qa]] never
flagged it) and does not violate the ticket's literal single-mount wording
(no simultaneous double-mount; in-workbench tab switching is genuinely
single-mount). Flagged for CEO/CTO awareness, not a blocker.

**Methodology note**: this ticket explicitly barred `next build`/`next dev`
(concurrent sprint running builds in the same repo) — every check above is
a static trace + `tsc`/`eslint`, not live-verified. If a live smoke test is
wanted before merge, someone with an exclusive build slot should open the
options terminal, maximize, switch to Chain, pick a different strike, and
confirm the chart updates without a full-page flash — that's the one thing
this session could not empirically confirm (the code trace says it should
work via `feed`/`chartKey` prop changes on the same mounted
`ChartWorkbench`, per `use-workbench-candles.ts`'s effects being keyed on
primitives, not object identity).
