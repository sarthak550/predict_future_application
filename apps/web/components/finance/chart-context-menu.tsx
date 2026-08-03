"use client";

/**
 * Chart Trading interaction-model rework (2026-08-04) — the right-click
 * "Buy at ₹X / Sell at ₹X" compact menu, TradingView's own right-click-to-
 * trade pattern. The SECOND deliberate summon point for the order-intent
 * flow now that a plain chart click never opens anything (see chart-axis-
 * plus-button.tsx's own doc for the founder complaint this whole rework
 * answers, and for why the axis "+" is the FIRST summon point).
 *
 * Deliberately simpler than `ChartOrderIntentPopover` (chart-order-intent-
 * popover.tsx): no LIMIT-vs-STOP inference — a right-click at an exact
 * point is an explicit "trade right here" gesture, not an ambiguous click
 * needing `inferOrderIntentOptions`' guesswork. Always offers both a Buy
 * and a Sell at the exact right-clicked price (LIMIT — callers wire both
 * actions straight to `onOrderIntentConfirm({price, side, variant:
 * "LIMIT"})`), regardless of where that price sits relative to the current
 * quote.
 *
 * Shared by price-chart.tsx, terminal/premium-chart.tsx, AND the maximized
 * workbench (chart-workbench.tsx) — one component, not three hand-synced
 * copies, matching this program's established discipline. Dismissal
 * contract is a byte-for-byte mirror of `ChartOrderIntentPopover`'s own
 * (Escape, or a capture-phase pointerdown outside this component's own DOM
 * node — capture phase so a chart interaction that repositions this same
 * menu on the SAME tick is never double-counted as an "outside click").
 */
import { useEffect, useRef } from "react";

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function ChartContextMenu({
  price,
  left,
  top,
  onBuy,
  onSell,
  onDismiss
}: {
  price: number;
  /** CSS pixels, relative to the chart's own `position: relative` wrapper — same contract as `ChartOrderIntentPopover`'s `left`/`top`. */
  left: number;
  top: number;
  onBuy: () => void;
  onSell: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same right-edge-clip guard as ChartOrderIntentPopover, same 320 anchor
  // point (half of every chart's shared 640-unit SVG viewBox / a sane
  // midpoint for the workbench's own much wider canvas).
  const anchorRight = left > 320;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Trade at this price"
      className="absolute z-10 w-40 rounded-xl border border-ink-200 bg-white p-1 shadow-lg"
      style={{
        left: anchorRight ? undefined : Math.max(4, left),
        right: anchorRight ? 4 : undefined,
        top: Math.max(0, top)
      }}
    >
      <button
        type="button"
        onClick={onBuy}
        className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
      >
        Buy at {formatRupees(price)}
      </button>
      <button
        type="button"
        onClick={onSell}
        className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50"
      >
        Sell at {formatRupees(price)}
      </button>
    </div>
  );
}
