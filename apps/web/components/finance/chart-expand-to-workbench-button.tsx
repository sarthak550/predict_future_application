import Link from "next/link";
import { Maximize2 } from "lucide-react";

/**
 * "Serious Charts" Program, Workstream C (2026-08-17) — instrument-page
 * "expand chart to paper-trading workbench" entry point. Visually modeled
 * on `WorkbenchMaximizeButton` (same `Maximize2` icon, same corner styling)
 * but deliberately a `<Link>`, not an `onClick` state toggle — the
 * instrument page and the paper-trading workbench are different routes with
 * different data contexts (the instrument page has no `PaperTradingAccount`
 * context to inline a workbench into), so this is a navigation, not an
 * in-page maximize.
 *
 * Reuses the existing `?symbol=&workbench=1` deep-link mechanics verbatim
 * (`options-page-client.tsx`/`futures-page-client.tsx` already build this
 * exact URL shape for their own cross-terminal jumps): the equity dashboard
 * reads `symbol` as a one-shot param and `workbench=1` auto-restores the
 * maximized Charting Workbench via `useWorkbenchUrlParam`/
 * `useWorkbenchAutoRestore` — zero new deep-link code.
 *
 * No auth pre-check — links straight to `/paper-trading` regardless of
 * sign-in state, exactly like every other paper-trading entry point already
 * behaves; the destination's own client-side gate (a "Sign in to start
 * paper trading" swap) handles a signed-out visitor.
 *
 * Callers must omit this component entirely when
 * `instrument.supportsWorkbenchTrading` is false — no disabled/ghost state
 * (see instrument.ts's own doc on why: "expand chart" is a convenience
 * shortcut, not a feature this page has previously promised, unlike a
 * trading ticket's Buy button).
 *
 * Workstream E (2026-08-17) — also carries `?return=/instruments/<symbol>`,
 * the SAME `symbol` this component already has in hand (this page's own
 * route param), so Minimize can send the user back here instead of stranding
 * them on the bare Paper Trading dashboard. Consumed by
 * `paper-trading-dashboard.tsx`'s existing one-shot deep-link effect and
 * validated by `resolveWorkbenchReturnTarget` — see those files' own docs.
 */
export function ChartExpandToWorkbenchButton({ symbol }: { symbol: string }) {
  const href = `/paper-trading?symbol=${encodeURIComponent(symbol)}&workbench=1&return=${encodeURIComponent(`/instruments/${symbol}`)}`;
  return (
    <Link
      href={href}
      title="Open in Trading Workbench"
      aria-label="Open in Trading Workbench"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-500 shadow-sm transition hover:bg-ink-50 hover:text-ink-900"
    >
      <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">Trading Workbench</span>
    </Link>
  );
}
