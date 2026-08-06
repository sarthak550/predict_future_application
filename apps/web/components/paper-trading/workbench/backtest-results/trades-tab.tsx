"use client";

/**
 * Strategy Results UI — TRADES sub-tab: the full trade log,
 * `BacktestStats.tradesDetail` rendered as a scrollable table. Gross P&L,
 * costs, and net P&L are shown as THREE SEPARATE columns (not toggled by
 * the Ideal/Real header) per the product brief's own literal column list —
 * a trade log's whole point is comparing gross vs. net side by side, not
 * picking one. The active `view` instead controls which of the two P&L
 * columns is visually bold/primary, a lighter-touch nod to the toggle that
 * doesn't hide either number.
 *
 * `side` is always "Long" — this engine (`runBacktest`) is long-only by
 * construction (see `backtest.ts`'s own module doc: a `maCross`-style flip
 * strategy that only ever opens on a BUY and closes on a SELL). The column
 * is still rendered, both for the TradingView-familiar table shape the
 * brief asks for and so this table doesn't need reshaping the day a short-
 * capable strategy type is added — it would just start rendering "Short"
 * for some rows, no schema change needed here.
 */
import type { BacktestTrade } from "@/lib/ta/backtest";
import { formatRupees, formatBarTimestamp } from "./format";

function maeMfeCell(rupees: number, pct: number): string {
  return `${formatRupees(rupees)} (${pct.toFixed(1)}%)`;
}

export function TradesTab({ trades, interval, view }: { trades: readonly BacktestTrade[]; interval: string; view: "real" | "ideal" }) {
  if (trades.length === 0) {
    return <div className="rounded-lg bg-ink-50 p-4 text-center text-xs text-ink-400">No trades to list.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-ink-100">
      <table className="w-full min-w-[900px] border-collapse text-[10.5px]">
        <thead>
          <tr className="sticky top-0 z-10 bg-ink-50 text-ink-500">
            {["#", "Side", "Entry", "Exit", "Qty", "Bars", "Gross P&L", "Costs", "Net P&L", "Net %", "Cum. equity", "MAE", "MFE"].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-ink-100 px-2 py-1.5 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-50">
          {trades.map((t, i) => {
            const netPositive = t.netPnl >= 0;
            return (
              <tr key={i} className={t.isOpen ? "bg-sky-50/50" : undefined}>
                <td className="px-2 py-1.5 text-ink-400">{i + 1}</td>
                <td className="px-2 py-1.5 text-ink-600">Long</td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink-700">
                  {formatBarTimestamp(t.entryTimestamp, interval)}
                  <span className="ml-1 text-ink-400">@{formatRupees(t.entryPrice)}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink-700">
                  {t.isOpen || t.exitTimestamp === null ? (
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                      Open — marked to last close
                    </span>
                  ) : (
                    <>
                      {formatBarTimestamp(t.exitTimestamp, interval)}
                      <span className="ml-1 text-ink-400">@{formatRupees(t.exitPrice ?? 0)}</span>
                    </>
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-ink-700">{t.qty}</td>
                <td className="px-2 py-1.5 tabular-nums text-ink-700">{t.barsHeld}</td>
                <td className={`px-2 py-1.5 tabular-nums ${view === "ideal" ? "font-semibold text-ink-900" : "text-ink-500"}`}>
                  {formatRupees(t.grossPnl)}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-ink-500">{formatRupees(t.totalCosts)}</td>
                <td
                  className={`px-2 py-1.5 tabular-nums ${view === "real" ? "font-semibold" : ""} ${netPositive ? "text-emerald-700" : "text-rose-700"}`}
                >
                  {formatRupees(t.netPnl)}
                </td>
                <td className={`px-2 py-1.5 tabular-nums ${netPositive ? "text-emerald-700" : "text-rose-700"}`}>{t.netPnlPct.toFixed(2)}%</td>
                <td className="px-2 py-1.5 tabular-nums text-ink-700">{formatRupees(t.cumulativeNetEquity)}</td>
                <td className="px-2 py-1.5 tabular-nums text-rose-500">{maeMfeCell(t.mae, t.maePct)}</td>
                <td className="px-2 py-1.5 tabular-nums text-emerald-600">{maeMfeCell(t.mfe, t.mfePct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
