"use client";

/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint C, C2) — the at-cursor
 * order-intent popover that REPLACES Sprint B's hardcoded-LIMIT click
 * prefill (decision 3 of the Sprint C brief). Shared by price-chart.tsx and
 * premium-chart.tsx so the popover itself — not just the inference rule in
 * chart-order-lines.ts — is written once, matching this whole program's
 * "don't fork the pixel/price logic" discipline.
 *
 * Renders as a plain absolutely-positioned `<div>` inside the chart's own
 * card (`position: relative` on the chart's wrapper), never a portal/Modal —
 * this is a small, short-lived, chart-scoped control anchored to a specific
 * click point, not a screen-owning overlay (the RN Modal measurement lesson
 * from the mobile app doesn't apply to a web `position: absolute` popover,
 * but "keep it simple" still argues against a portal here: no z-index/focus-
 * trap machinery is needed for something this contained).
 *
 * Dismissal: Escape key, or a pointerdown outside the popover's own DOM
 * node. Confirming an action calls `onConfirm` and the caller is
 * responsible for closing the popover (letting the caller own that state
 * transition keeps this component a pure, stateless presentational piece).
 */
import { useEffect, useRef } from "react";

import { inferOrderIntentOptions, type OrderSide, type OrderVariant } from "@/components/finance/chart-order-lines";

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function ChartOrderIntentPopover({
  price,
  currentPrice,
  left,
  top,
  onConfirm,
  onDismiss
}: {
  price: number;
  /** The chart's own most-recently-rendered price — the popover's inference reference (see inferOrderIntentOptions), never a separately-fetched quote, so the popover's default always matches exactly what's visible on screen at click time. */
  currentPrice: number;
  /** CSS pixels, relative to the chart's own `position: relative` wrapper. */
  left: number;
  top: number;
  onConfirm: (side: OrderSide, variant: OrderVariant) => void;
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
    // Capture phase: a click on the chart itself (which reopens/repositions
    // this same popover at the new point, see price-chart.tsx's click
    // handler) must not ALSO be swallowed here as a same-tick "outside
    // click" race — capture-phase registration plus the chart's own click
    // handler both running is fine either way since the chart click just
    // replaces this component's props (new position), not a double-close.
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { primary, secondary } = inferOrderIntentOptions(price, currentPrice);

  // Keeps the popover from clipping off the chart's right edge on a click
  // near it — anchored from the right past the midpoint of the chart's own
  // 640-unit viewBox width. Not re-measured after mount (a short-lived,
  // small control — not worth a ResizeObserver for this).
  const anchorRight = left > 320;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Order actions at this price"
      className="absolute z-10 w-52 -translate-y-full rounded-2xl border border-ink-200 bg-white p-2 shadow-lg"
      style={{
        left: anchorRight ? undefined : Math.max(4, left),
        right: anchorRight ? 4 : undefined,
        top: Math.max(0, top - 10)
      }}
    >
      <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">@ {formatRupees(price)}</p>
      <PopoverAction
        label={`${primary.side === "BUY" ? "Buy" : "Sell"} Limit`}
        detail={`@ ${formatRupees(price)}`}
        tone={primary.side === "BUY" ? "buy" : "sell"}
        primary
        onClick={() => onConfirm(primary.side, primary.variant)}
      />
      {secondary !== null && (
        <PopoverAction
          label={`${secondary.side === "BUY" ? "Buy" : "Sell"} Stop`}
          detail={`@ ${formatRupees(price)}`}
          tone={secondary.side === "BUY" ? "buy" : "sell"}
          onClick={() => onConfirm(secondary.side, secondary.variant)}
        />
      )}
    </div>
  );
}

/** Sprint C, C3 — `min-h-11` (44px) satisfies the "≥44px effective touch target" audit for every action introduced this sprint, popover buttons included. */
function PopoverAction({
  label,
  detail,
  tone,
  primary,
  onClick
}: {
  label: string;
  detail: string;
  tone: "buy" | "sell";
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-1 flex min-h-11 w-full flex-col items-start justify-center rounded-xl px-3 py-1.5 text-left transition first:mt-0 ${
        primary
          ? tone === "buy"
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-rose-600 text-white hover:bg-rose-700"
          : "border border-ink-200 text-ink-700 hover:bg-ink-50"
      }`}
    >
      <span className="flex w-full items-center justify-between text-xs font-semibold">
        {label}
        {primary && <span className="text-[9px] font-medium uppercase tracking-wide opacity-80">Suggested</span>}
      </span>
      <span className={`text-[10px] ${primary ? "opacity-80" : "text-ink-400"}`}>{detail}</span>
    </button>
  );
}
