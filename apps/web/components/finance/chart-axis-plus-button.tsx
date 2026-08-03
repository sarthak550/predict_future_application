"use client";

/**
 * Chart Trading interaction-model rework (2026-08-04) — TradingView's
 * price-axis "+" affordance. Founder complaint, verbatim: "I cant have
 * buy/sell popup on every click, thats irritating" — the SAHI-inspired
 * click-anywhere-to-trade popup (Chart Trading + SL/TP, Sprint C) is
 * removed from every chart surface (see price-chart.tsx / terminal/
 * premium-chart.tsx / workbench/kline-chart.tsx's own docs on their now-
 * inert `onClick`/native `click` listeners). This button is the deliberate
 * replacement: each chart tracks the pointer against its own price-axis
 * region and renders this button at the hovered price when (and only when)
 * the pointer is actually over that axis — clicking it opens the SAME
 * `ChartOrderIntentPopover` Sprint C built, prefilled with that price.
 *
 * Pure presentational, shared by price-chart.tsx, terminal/premium-
 * chart.tsx, AND the maximized workbench (chart-workbench.tsx) — one visual
 * definition rather than three hand-synced copies, matching this program's
 * established "don't fork the popover" discipline (see chart-order-intent-
 * popover.tsx's own doc). `top` is a CSS pixel relative to the caller's own
 * `position: relative` wrapper — same anchor contract every other chart
 * overlay in this program already uses (ChartOrderIntentPopover's `left`/
 * `top`, kline-chart.tsx's `onSurfaceClick`/`onAxisHoverChange` payloads).
 */
import { Plus } from "lucide-react";

export function ChartAxisPlusButton({ top, onClick }: { top: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Trade at this price"
      title="Trade at this price"
      className="absolute z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-sky-300 bg-white text-sky-600 shadow-md transition hover:bg-sky-50 hover:text-sky-700"
      style={{ top, right: 4 }}
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
