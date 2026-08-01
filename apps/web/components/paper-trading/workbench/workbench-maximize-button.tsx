"use client";

/**
 * Charting Workbench (W2, T6 entry points) — the single integration point
 * every terminal page uses to add a "maximize this chart" affordance:
 *
 *   - `WorkbenchMaximizeButton` — a small `Maximize2` icon button, absolute
 *     top-right inside the chart card. Deliberately a CONTROLLED component
 *     (`onClick` only, no internal open state) — the parent terminal owns
 *     the open/closed boolean itself, because it also has to react to it:
 *     the ticket single-mount rule (see the founder plan §5) requires the
 *     parent swap its OWN docked ticket to `null` while the workbench is
 *     open, which only the parent can do to its own `TerminalShell` call.
 *   - `DynamicChartWorkbench` — `ChartWorkbench` wrapped in
 *     `next/dynamic(..., {ssr:false})`, the codebase's first dynamic-import
 *     chunk (confirmed via grep at W2 kickoff — no prior convention to
 *     follow). Parents render this ONLY while `open` is true — see each
 *     terminal's own wiring — so the ~200KB-gz `klinecharts` dependency
 *     (pulled in transitively via kline-chart.tsx) is fetched on first
 *     maximize, never as part of a terminal page's initial load (verified
 *     in T6's build-output check).
 *
 * Usage at a call site (mirrors every terminal's existing `orderLines`
 * construction — see paper-trading-dashboard.tsx / futures-page-client.tsx /
 * options-page-client.tsx):
 *
 *   const [workbenchOpen, setWorkbenchOpen] = useState(false);
 *   const ticketElement = <DockedOrderTicket ... />;
 *   ...
 *   <div className="relative">
 *     <WorkbenchMaximizeButton onClick={() => setWorkbenchOpen(true)} />
 *     <PriceChart ... />
 *   </div>
 *   ...
 *   <TerminalShell ticket={workbenchOpen ? null : ticketElement} ... />
 *   {workbenchOpen && (
 *     <DynamicChartWorkbench
 *       feed={{ kind: "equity", symbol: focusedSymbol }}
 *       chartKey={`EQ:${focusedSymbol}`}
 *       title={focusedSymbol}
 *       onClose={() => setWorkbenchOpen(false)}
 *       orderLines={orderLines}
 *       onOrderIntentConfirm={handleOrderIntentConfirm}
 *       onOrderLineDrag={handleOrderLineDrag}
 *       onOrderLineCancel={handleOrderLineCancel}
 *       ticket={ticketElement}
 *     />
 *   )}
 */
import dynamic from "next/dynamic";
import { Maximize2 } from "lucide-react";

export const DynamicChartWorkbench = dynamic(() => import("./chart-workbench").then((m) => m.ChartWorkbench), {
  ssr: false
});

export function WorkbenchMaximizeButton({ onClick, label = "Maximize chart" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="absolute right-2 top-2 z-10 rounded-lg border border-ink-200 bg-white/90 p-1.5 text-ink-500 shadow-sm backdrop-blur hover:bg-white hover:text-ink-900"
    >
      <Maximize2 className="h-3.5 w-3.5" />
    </button>
  );
}
