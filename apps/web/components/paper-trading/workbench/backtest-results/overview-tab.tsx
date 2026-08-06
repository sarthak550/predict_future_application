"use client";

/**
 * Strategy Results UI — OVERVIEW sub-tab: the equity-curve plot
 * (`EquityCurveChart`) plus a compact headline stat row above it. Every
 * number here reads off the ALREADY-COMPUTED `BacktestStats` for whichever
 * `view` ("real" = net, "ideal" = gross) the results header's toggle
 * currently has selected — this component never recomputes P&L itself.
 */
import type { BacktestStats } from "@/lib/ta/backtest";
import { EquityCurveChart } from "./equity-curve-chart";
import { formatRupees, formatPct, formatOrDash } from "./format";

function StatTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const color = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : "text-ink-800";
  return (
    <div className="rounded-lg bg-ink-50 p-2 text-center">
      <p className="text-[9px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`text-xs font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export function OverviewTab({ stats, view, interval }: { stats: BacktestStats; view: "real" | "ideal"; interval: string }) {
  const pnl = view === "real" ? stats.netPnl : stats.grossPnl;
  const pnlPct = view === "real" ? stats.netReturnPct : stats.grossReturnPct;
  const winRate = view === "real" ? stats.winRatePct : stats.grossWinRatePct;
  const profitFactor = view === "real" ? stats.profitFactorNet : stats.profitFactorGross;
  const tone: "positive" | "negative" = pnl >= 0 ? "positive" : "negative";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        <StatTile label={`P&L (${view === "real" ? "net" : "gross"})`} value={`${formatPct(pnlPct)}`} tone={tone} />
        <StatTile label="P&L ₹" value={formatRupees(pnl)} tone={tone} />
        <StatTile label="Max DD (net)" value={`-${stats.maxDrawdownPct.toFixed(2)}%`} tone="negative" />
        <StatTile label="Win rate" value={formatOrDash(winRate, (v) => `${v.toFixed(0)}%`)} />
        <StatTile label="Profit factor" value={formatOrDash(profitFactor, (v) => v.toFixed(2))} />
        <StatTile label="Trades" value={String(stats.trades)} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-ink-50 px-2 py-1.5 text-[11px] text-ink-500">
        <span>Total costs (both legs, every trade)</span>
        <span className="font-medium text-ink-700">{formatRupees(stats.totalCosts)}</span>
      </div>

      <EquityCurveChart points={stats.equityCurve} view={view} interval={interval} />
    </div>
  );
}
