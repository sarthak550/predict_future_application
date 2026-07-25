"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T7) — post-Express-fill toast.
 * Stays on screen for a FIXED 6 seconds (its own timer, not tied to the
 * account's 60s poll or the chain's 30s poll — an Express fill must never be
 * silently swallowed by the next poll tick). Reuses CostBreakdownTable
 * (compact) for the same "line-for-line checkable" promise every other fill
 * confirmation in this domain makes.
 *
 * "Reverse" is explicitly NOT an undo — one tap pre-fills the docked ticket
 * with the opposite side of the SAME contract at the current live premium,
 * and always requires the user's own explicit Confirm click (the parent
 * wires this by bumping selectionNonce with presetSide flipped — never an
 * instant re-fire, even while Express is armed).
 */
import { useEffect, useState } from "react";

import type { PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";

const TOAST_DURATION_MS = 6000;

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function ExpressFillToast({ order, onReverse, onDismiss }: { order: PlacedOptionOrderPayload; onReverse: () => void; onDismiss: () => void }) {
  const [remainingMs, setRemainingMs] = useState(TOAST_DURATION_MS);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const left = TOAST_DURATION_MS - (Date.now() - start);
      if (left <= 0) {
        clearInterval(interval);
        onDismiss();
      } else {
        setRemainingMs(left);
      }
    }, 200);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-[24px] border border-amber-200 bg-white p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-600">
          Express fill — {order.side} {order.lots} lot(s)
        </p>
        <span className="text-[10px] text-ink-300">{Math.ceil(remainingMs / 1000)}s</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-ink-900">
        {order.underlyingSymbol} {order.strikePrice} {order.optionType}
      </p>
      <p className="mt-1 text-xs text-ink-500">
        Gross {formatRupees(order.grossAmount)} → Costs {formatRupees(order.totalCosts)} →{" "}
        {order.side === "BUY" ? "You paid" : "You received"} {formatRupees(order.netAmount)}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onReverse}
          className="rounded-xl border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-ink-400"
        >
          Reverse
        </button>
        <button type="button" onClick={onDismiss} className="text-xs text-ink-400 hover:text-ink-700">
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-ink-400">
        Reverse places a new order, it doesn&apos;t cancel the last one — you&apos;ll pay costs on both fills, same as a real broker.
      </p>
    </div>
  );
}
