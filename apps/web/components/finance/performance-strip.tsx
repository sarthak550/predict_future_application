import { Card, CardContent } from "@/components/ui/card";
import type { ReturnsStrip } from "@predict-future/business-rules/marketPulse/returns";

/**
 * Instrument Page v2 (T5) — compact 1W/1M/3M/6M/1Y/FYTD return chips.
 * Server component, purely presentational — `performance` arrives already
 * computed by the pure `computeReturnsStrip` (packages/business-rules).
 * A `null` window renders "—", never a false 0% (insufficient history —
 * e.g. a recent IPO has no 1Y number yet).
 */

const WINDOWS: { key: keyof ReturnsStrip; label: string }[] = [
  { key: "oneWeek", label: "1W" },
  { key: "oneMonth", label: "1M" },
  { key: "threeMonth", label: "3M" },
  { key: "sixMonth", label: "6M" },
  { key: "oneYear", label: "1Y" },
  { key: "fiscalYearToDate", label: "FYTD" },
];

export function PerformanceStrip({ performance }: { performance: ReturnsStrip }) {
  const hasAnyWindow = WINDOWS.some(({ key }) => performance[key] != null);
  if (!hasAnyWindow) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Performance</p>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          {WINDOWS.map(({ key, label }) => {
            const value = performance[key];
            return (
              <div key={key} className="rounded-2xl bg-ink-50 px-2 py-2.5 text-center">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
                <p
                  className={`mt-1 text-sm font-semibold ${
                    value == null ? "text-ink-300" : value >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
