---
name: project-chart-trading-interaction-rework-qa
description: Chart Trading interaction-model rework (click->hover-+/right-click) QA outcome, 2026-08-04 — PASS, static-only
metadata:
  type: project
---

Founder complaint ("I cant have buy/sell popup on every click, thats
irritating") drove a rework of how the order-intent popover is summoned on
all 4 chart trading surfaces: `apps/web/components/finance/price-chart.tsx`
(equity/futures spot), `apps/web/components/paper-trading/terminal/
premium-chart.tsx` (options premium), and the maximized workbench
(`apps/web/components/paper-trading/workbench/kline-chart.tsx` +
`chart-workbench.tsx`). Plain clicks no longer open anything; two new
summon points replace them: a price-axis hover "+" button
(`chart-axis-plus-button.tsx`) and a right-click "Buy at ₹X / Sell at ₹X"
menu (`chart-context-menu.tsx`), both LIMIT-only at the hovered/clicked
price. A one-time dismissible hint (`chart-trade-hint.tsx`,
`pf.chart.tradeHintDismissed` localStorage key) tells returning users where
trading moved.

QA verdict: **PASS**, static-only (no `next build`/`next dev` — concurrent
QA session owned the dev server; SS1 scripting-sprint files off-limits).
All 8 checks clean:
- No plain-click path opens trading UI anywhere (verified via full
  `addEventListener`/`onClick` audit across all 4 files — `onSurfaceClick`
  prop fully DELETED from `KlineChart`'s API, not just gated).
- 3 non-terminal `PriceChart` consumers (indices/bonds/instruments pages)
  and 2 underlying-only surfaces (`OptionsUnderlyingChart`'s small
  `PriceChart`, and the options terminal's underlying-only maximized
  `DynamicChartWorkbench` at `options-page-client.tsx:806`) all correctly
  omit `onOrderIntentConfirm` — no dead right-click anywhere. The trickiest
  wiring: `kline-chart.tsx`'s `handleContextMenu` checks `!callback` for
  `onSurfaceContextMenu` BEFORE calling `e.preventDefault()`, so the native
  browser context menu survives correctly on the click-inert underlying
  workbench.
- Drawing precedence: `suppressTradeAffordances = isDrawingActive ||
  selectedDrawing !== null` in `chart-workbench.tsx`, passed as
  `suspendClick`, correctly gates both the axis-hover and right-click
  handlers inside `kline-chart.tsx`.
- Price correctness: `priceAtFraction`/`priceAtClientY`/`snapToTick`
  (shared helpers in `chart-order-lines.ts`) reused identically by old and
  new handlers on the SVG charts. Workbench's NEW `chart.getSize
  (MAIN_PANE_ID, "yAxis")` + `convertFromPixel` combo type-checks cleanly
  against the installed klinecharts `.d.ts` (verified via `tsc`, since
  reading `node_modules` directly is off-limits per this role's
  anti-injection policy — see [[feedback_no_node_modules_reads]]) and is
  internally consistent with an already-verified `chart.getSize(paneId)`
  call elsewhere in the same file (gear-icon anchor positioning) that
  assumes the same container-relative coordinate space.
- SL/TP + order-line rendering/drag-to-reprice: byte-identical, only
  comment changes (`dragJustEndedRef`/`suppressNextClickRef` are now
  write-only/inert but harmless — their old click-suppression purpose no
  longer exists).
- SS1 hunks (`normalizeSignalsConfig`/`PfSignalsConfig`/`signalsKey`
  widening/script branch) in `kline-chart.tsx` intact and coherent;
  `chart-workbench.tsx`'s pre-existing `signalsConfig` call site (legacy
  `{id, params}` shape, no `kind`) untouched and still correctly normalized
  — not reverted or mangled by this work.
- `tsc --noEmit -p apps/web/tsconfig.json` and `eslint` on all 7 touched
  files: both clean, zero errors.

One **non-blocking** finding filed (not a FAIL per the ticket's own
explicit bar — plain-click-opens-popup / dead-right-click / non-terminal-
gains-trading-UI): `chart-trade-hint.tsx`'s doc comment overclaims
"dismissing the hint on any one [surface]... dismisses it everywhere."
True only across page loads/fresh mounts. Within a single session, the
terminal's small chart and its maximized `DynamicChartWorkbench` are BOTH
simultaneously mounted (`TerminalShell`'s `chart` slot renders
unconditionally regardless of `workbenchOpen`; the workbench portal renders
additionally on top when open — confirmed in `paper-trading-dashboard.tsx`/
`futures-page-client.tsx`), and each holds its OWN independent
`useTradeHintDismissed()` `useState`. Dismissing inside the workbench
writes `localStorage` correctly but does NOT live-update the already-
mounted small chart underneath — it only reflects on that component's next
mount. Self-heals on reload; no functional/security impact. Worth a
follow-up ticket (lift the dismissed flag to a shared context/store) if the
founder notices the double-nag in the same session.
