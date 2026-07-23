"use client";

/**
 * Post-fill confirmation panel (T6) — "Gross → Costs → Net" headline with the
 * full itemized table underneath, so the headline arithmetic is visibly checkable
 * against the line items (no rounding mismatch, per the acceptance criteria).
 */
import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { Button } from "@/components/ui/button";
import type { PlacedOrderPayload } from "@/components/paper-trading/new-trade-form";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function OrderConfirmation({ order, onDismiss }: { order: PlacedOrderPayload; onDismiss: () => void }) {
  const tickTime = new Date(order.fillTickAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });

  return (
    <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Order filled — {order.side} {order.quantity} × {order.symbol} ({order.productType})
          </p>
          <p className="mt-2 text-lg font-semibold text-ink-900">
            Gross {formatRupees(order.grossAmount)} → Costs {formatRupees(order.totalCosts)} →{" "}
            {order.side === "BUY" ? "You paid" : "You received"} {formatRupees(order.netAmount)}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Filled at ₹{order.fillPrice.toLocaleString("en-IN")} — the delayed price as of {tickTime} IST (live
            prices run up to ~60 seconds behind).
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      <div className="mt-4">
        <CostBreakdownTable
          breakdown={{
            grossAmount: order.grossAmount,
            brokerage: order.brokerage,
            stt: order.sttAmount,
            exchangeCharge: order.exchangeCharge,
            sebiFee: order.sebiFee,
            stampDuty: order.stampDuty,
            gst: order.gstAmount,
            dpCharge: order.dpCharge,
            totalCosts: order.totalCosts,
            netAmount: order.netAmount
          }}
          side={order.side}
        />
      </div>
    </div>
  );
}
