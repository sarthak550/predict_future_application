"use client";

/**
 * Strategy Results UI — PERFORMANCE sub-tab: the full metric grid, grouped
 * `Returns / Risk / Trade stats / Time / Capital & margin` per the product
 * brief. Every row that has a genuine gross/net PAIR in `BacktestStats`
 * shows the active `view`'s value as the primary (bold) figure and the
 * OTHER view's value inline, greyed, in parentheses — so switching the
 * toggle re-orders which number is bold without the other one disappearing.
 * Rows with NO gross/net pair (drawdown/run-up, consecutive streaks, time-
 * in-market, capital/margin) render their one real value regardless of
 * `view`, each carrying its own short note on WHY there's no second number
 * — matching `backtest.ts`'s own documented laws (no gross drawdown/run-up
 * variant; streaks are net-classified only) rather than silently omitting
 * the explanation.
 */
import type { BacktestStats, MarginModel } from "@/lib/ta/backtest";
import { INTRADAY_MARGIN_MODEL_DISCLAIMER } from "@/lib/ta/backtest";
import { formatRupees, formatPct, formatRatio, formatOrDash } from "./format";

function Row({
  label,
  primary,
  secondary,
  note
}: {
  label: string;
  primary: string;
  secondary?: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-[11px]">
      <span className="min-w-0 flex-1 text-ink-500">
        {label}
        {note && <span className="ml-1 text-[9px] text-ink-400">{note}</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        <span className="font-semibold text-ink-800">{primary}</span>
        {secondary && <span className="ml-1.5 text-ink-400">({secondary})</span>}
      </span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-100 p-2">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      <div className="divide-y divide-ink-50">{children}</div>
    </div>
  );
}

/** A gross/net pair, formatted with the ACTIVE view primary and the other greyed — the one helper every dual-sided row below routes through, so "which is bold" logic lives in exactly one place. */
function pair(view: "real" | "ideal", net: number | null, gross: number | null, fmt: (v: number) => string): { primary: string; secondary?: string } {
  const active = view === "real" ? net : gross;
  const other = view === "real" ? gross : net;
  return { primary: formatOrDash(active, fmt), secondary: other !== null ? formatOrDash(other, fmt) : undefined };
}

function marginModelLabel(model: MarginModel): string {
  return model === "DELIVERY_FULL_NOTIONAL" ? "Delivery — full notional (regulatory, not a limitation)" : "Intraday — full notional (no leverage model)";
}

export function PerformanceTab({ stats, view }: { stats: BacktestStats; view: "real" | "ideal" }) {
  const pnl = pair(view, stats.netPnl, stats.grossPnl, formatRupees);
  const returnPct = pair(view, stats.netReturnPct, stats.grossReturnPct, formatPct);
  const annualized = pair(view, stats.annualizedReturnPctNet, stats.annualizedReturnPctGross, formatPct);
  const wins = pair(view, stats.wins, stats.grossWins, (v) => String(v));
  const winRate = pair(view, stats.winRatePct, stats.grossWinRatePct, (v) => `${v.toFixed(0)}%`);
  const profitFactor = pair(view, stats.profitFactorNet, stats.profitFactorGross, formatRatio);
  const expectancy = pair(view, stats.expectancyNet, stats.expectancyGross, formatRupees);
  const avgTrade = pair(view, stats.avgTradeNetPnl, stats.avgTradeGrossPnl, formatRupees);
  const avgWin = pair(view, stats.avgWinNet, stats.avgWinGross, formatRupees);
  const avgLoss = pair(view, stats.avgLossNet, stats.avgLossGross, formatRupees);
  const avgWinLossRatio = pair(view, stats.avgWinLossRatioNet, stats.avgWinLossRatioGross, formatRatio);
  const largestWin = pair(view, stats.largestWinNet, stats.largestWinGross, formatRupees);
  const largestLoss = pair(view, stats.largestLossNet, stats.largestLossGross, formatRupees);
  const returnOnPeak = pair(view, stats.returnOnPeakCapitalPctNet, stats.returnOnPeakCapitalPctGross, formatPct);

  const showIntradayDisclaimer = stats.marginModel === "INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL";

  return (
    <div className="space-y-2">
      <Group title="Returns">
        <Row label={`P&L ₹ (${view === "real" ? "net" : "gross"})`} primary={pnl.primary} secondary={pnl.secondary} />
        <Row label="Return %" primary={returnPct.primary} secondary={returnPct.secondary} />
        <Row label="Buy & hold return" primary={formatPct(stats.buyHoldReturnPct)} note="(frictionless baseline)" />
        <Row label="Annualized return" primary={annualized.primary} secondary={annualized.secondary} note={stats.annualizedReturnPctNet === null ? "(needs ≥90 days loaded)" : undefined} />
        <Row label="Total costs" primary={formatRupees(stats.totalCosts)} />
      </Group>

      <Group title="Risk — drawdown & run-up">
        <Row label="Max drawdown %" primary={`-${stats.maxDrawdownPct.toFixed(2)}%`} note="(net only — costs are real cash flows, see docs)" />
        <Row label="Max drawdown ₹" primary={formatRupees(-stats.maxDrawdownAmount)} note="(net only)" />
        <Row label="Max equity run-up %" primary={`+${stats.maxEquityRunUpPct.toFixed(2)}%`} note="(net only)" />
        <Row label="Max equity run-up ₹" primary={formatRupees(stats.maxEquityRunUpAmount)} note="(net only)" />
      </Group>

      <Group title="Trade stats">
        <Row label="Trades" primary={String(stats.trades)} />
        <Row label="Wins" primary={wins.primary} secondary={wins.secondary} />
        <Row label="Win rate" primary={winRate.primary} secondary={winRate.secondary} />
        <Row label="Profit factor" primary={profitFactor.primary} secondary={profitFactor.secondary} />
        <Row label="Expectancy / trade" primary={expectancy.primary} secondary={expectancy.secondary} />
        <Row label="Avg trade P&L (all trades)" primary={avgTrade.primary} secondary={avgTrade.secondary} />
        <Row label="Avg win" primary={avgWin.primary} secondary={avgWin.secondary} />
        <Row label="Avg loss" primary={avgLoss.primary} secondary={avgLoss.secondary} />
        <Row label="Avg win/loss ratio" primary={avgWinLossRatio.primary} secondary={avgWinLossRatio.secondary} />
        <Row label="Largest win" primary={largestWin.primary} secondary={largestWin.secondary} />
        <Row label="Largest loss" primary={largestLoss.primary} secondary={largestLoss.secondary} />
        <Row label="Max consecutive wins" primary={String(stats.maxConsecutiveWins)} note="(net-classified)" />
        <Row label="Max consecutive losses" primary={String(stats.maxConsecutiveLosses)} note="(net-classified)" />
      </Group>

      <Group title="Time">
        <Row label="Total bars in trades" primary={String(stats.totalBarsInTrades)} />
        <Row label="Avg bars per trade" primary={formatOrDash(stats.avgBarsInTrades, (v) => v.toFixed(1))} />
        <Row label="% time in market" primary={formatOrDash(stats.pctTimeInMarket, (v) => `${v.toFixed(1)}%`)} />
      </Group>

      <Group title="Capital & margin">
        <Row label="Peak deployed capital" primary={formatRupees(stats.peakDeployedCapital)} note="(entry basis)" />
        <Row label="Avg deployed capital" primary={formatOrDash(stats.avgDeployedCapitalPct, (v) => `${v.toFixed(1)}%`)} />
        <Row label="Return on peak capital" primary={returnOnPeak.primary} secondary={returnOnPeak.secondary} />
        <Row label="Margin model" primary={marginModelLabel(stats.marginModel)} />
        <Row label="Avg margin used" primary={formatOrDash(stats.avgMarginUsedPct, (v) => `${v.toFixed(1)}%`)} />
        <Row label="Peak margin used" primary={`${stats.peakMarginUsedPct.toFixed(1)}%`} />
        {showIntradayDisclaimer && <p className="pt-1.5 text-[10px] leading-4 text-amber-700">{INTRADAY_MARGIN_MODEL_DISCLAIMER}</p>}
      </Group>
    </div>
  );
}
