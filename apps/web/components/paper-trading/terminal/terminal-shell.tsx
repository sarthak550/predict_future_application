/**
 * Trading Terminal UI Overhaul (Sprint A, T4) — layout primitive only. Grid
 * slots: header, chart, ladder (optional), ticket, positions. NO business
 * logic, no data fetching — every slot is handed fully-rendered content by
 * its caller (paper-trading-dashboard.tsx / options-page-client.tsx).
 *
 * Desktop (>=1024px) layout only in this ticket — the three breakpoint
 * behaviors (chart-collapse, ladder-primary, ticket-as-bottom-sheet) are T9
 * (Sprint B), out of scope here. Below 1024px this still stacks into a single
 * column (chart, then ladder, then ticket) rather than clipping/overflowing —
 * a safe, honest degrade, not the full T9 spec.
 */
import type { ReactNode } from "react";

export function TerminalShell({
  header,
  chart,
  ladder,
  ticket,
  positions
}: {
  header: ReactNode;
  chart: ReactNode;
  /** Omitted for the equity terminal (chart + ticket, two-pane) — present for the options terminal (chart + ladder + ticket, three-pane). */
  ladder?: ReactNode;
  ticket: ReactNode;
  positions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className={ladder ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_340px]" : "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"}>
        <div className="min-w-0 rounded-[24px] border border-ink-100 bg-white p-5">{chart}</div>
        {ladder && <div className="min-w-0 rounded-[24px] border border-ink-100 bg-white p-5">{ladder}</div>}
        <div className="min-w-0">{ticket}</div>
      </div>
      {positions}
    </div>
  );
}
