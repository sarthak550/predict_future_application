---
name: feedback-react-element-swap-not-true-single-mount
description: Passing the same JSX element as a prop into two structurally different parent components (e.g. TerminalShell's ladder/ticket slot vs ChartWorkbench's ticket/chain prop) does NOT preserve React mount identity across the swap, despite the codebase's own doc comments calling it a "single-mount rule".
metadata:
  type: feedback
---

React reconciliation preserves a component's state only when it renders at
the SAME position in the fiber tree across renders (same parent fiber +
same slot/key) — never by JS object-reference identity of the element
itself. This codebase's "ticket single-mount rule" (`workbench-maximize-
button.tsx`'s own doc, established at the W2 Charting Workbench sprint,
2026-08-01) constructs `ticketElement`/`chainElement` ONCE per render and
passes the SAME reference either into `TerminalShell`'s `ticket`/`ladder`
prop OR into `ChartWorkbench`'s `ticket`/`chain` prop, conditionally. These
are two structurally different parent subtrees (`TerminalShell` vs the
portal-rendered `ChartWorkbench`), so on every workbench open/close the
swapped component (DockedOrderTicket, OptionChainBrowser) actually
**unmounts from one subtree and remounts fresh in the other** — resetting
its local state (search/filter UI, scroll position) and restarting any
internal poll timer (e.g. OptionChainBrowser's 30s `useVisiblePolling`).
This is NOT a "double mount" (only one instance ever exists at a time —
verified no simultaneous double-poll) and it does NOT violate the narrower,
correctly-implemented claim of "no unmount/remount on TAB SWITCHES inside
an already-open workbench" (Ticket/Chain/Strategy tabs inside
`chart-workbench.tsx` ARE correctly always-mounted + CSS `display`-toggled,
verified at lines ~1006-1008 of that file — that part is genuinely single-
mount).

**Why:** Traced during S-adhoc "Chain tab in maximized workbench" ticket QA
(2026-08-08, files: `apps/web/components/paper-trading/workbench/chart-
workbench.tsx`, `apps/web/components/paper-trading/options-page-
client.tsx`). Confirmed via React reconciliation fundamentals (not
empirically run — `next build`/`next dev` were off-limits that session per
a concurrent-sprint constraint) and via `OptionChainBrowser`'s own source
(`option-chain-browser.tsx`) showing substantial local state: `mode`,
`underlying`, `stockQuery`, `expiries`, `chain`, search/combobox UI, plus a
30s `useVisiblePolling` chain-refresh — all of which resets on the
ladder-slot ↔ workbench-prop swap. This exact pattern was ALSO present for
`ticketElement` since the original W2 sprint and was not flagged in that
session's QA pass ([[project_workbench_qa]] Check H) — the prior QA's scope
never specifically probed cross-slot mount continuity, only bundle/SSR and
regression-diff checks.

**How to apply:** When a ticket brief calls something a "single-mount"
guarantee, verify which of TWO distinct claims it actually means: (a) no
TWO simultaneous instances (usually true here, cheap to verify by reading
the conditional — one slot always nulls exactly when the other populates),
vs (b) true continuity of component state/identity across the swap (almost
never true for this "same element object, different parent" idiom — treat
any codebase doc comment claiming this as suspect unless the two render
sites are proven to be literally the same parent fiber position with only
CSS toggling, the way the IN-workbench tabs correctly do it). Don't fail a
ticket over (b) unless the ticket brief explicitly demands full continuity
across THAT specific transition (open/close), or the reset is user-visible
enough to matter (e.g. loses an in-progress ticket draft) — if it's a
pre-existing, previously-unflagged codebase pattern being extended
consistently (as this ticket was), report it as a non-blocking finding, not
a FAIL, and suggest a follow-up ticket if the CEO/CTO think it's worth
fixing repo-wide (would require both host slots to be permanently mounted
with CSS-only toggling, paying the workbench's lazy-chunk cost cost
earlier — a real trade-off, not a free fix).
