/**
 * Itemized cost breakdown — the product's core promise made visible. Shared by
 * the New Trade form's pre-trade estimate (T5), the post-fill confirmation (T6),
 * and each order history row's expanded detail (T5). The SAME shape everywhere so
 * a user can see, line for line, that the estimate they were shown before
 * confirming is exactly what they were charged.
 */
export interface CostBreakdown {
  grossAmount: number;
  brokerage: number;
  stt: number;
  exchangeCharge: number;
  sebiFee: number;
  stampDuty: number;
  gst: number;
  dpCharge: number;
  totalCosts: number;
  netAmount: number;
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const LINE_ITEMS: { key: keyof CostBreakdown; label: string }[] = [
  { key: "brokerage", label: "Brokerage" },
  { key: "stt", label: "STT (Securities Transaction Tax)" },
  { key: "exchangeCharge", label: "Exchange transaction charge" },
  { key: "sebiFee", label: "SEBI turnover fee" },
  { key: "stampDuty", label: "Stamp duty" },
  { key: "gst", label: "GST (on brokerage + exchange charge + SEBI fee)" },
  { key: "dpCharge", label: "DP charge" }
];

export function CostBreakdownTable({ breakdown, side }: { breakdown: CostBreakdown; side: "BUY" | "SELL" }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4 text-sm">
      <div className="flex items-center justify-between text-ink-700">
        <span>Gross amount</span>
        <span className="font-medium">{formatRupees(breakdown.grossAmount)}</span>
      </div>
      <div className="mt-2 space-y-1.5 border-t border-ink-100 pt-2">
        {LINE_ITEMS.map(({ key, label }) => {
          const value = breakdown[key] as number;
          if (value === 0) {
            return (
              <div key={key} className="flex items-center justify-between text-ink-400">
                <span>{label}</span>
                <span>₹0.00</span>
              </div>
            );
          }
          return (
            <div key={key} className="flex items-center justify-between text-ink-600">
              <span>{label}</span>
              <span>{formatRupees(value)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2 font-medium text-ink-900">
        <span>Total costs</span>
        <span>{formatRupees(breakdown.totalCosts)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-ink-200 pt-2 text-base font-semibold text-ink-900">
        <span>{side === "BUY" ? "Total to pay" : "Net proceeds"}</span>
        <span>{formatRupees(breakdown.netAmount)}</span>
      </div>
    </div>
  );
}
