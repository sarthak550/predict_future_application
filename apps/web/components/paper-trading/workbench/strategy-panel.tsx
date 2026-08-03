"use client";

/**
 * TA Suite Sprint S3, T3 — the Strategy tab's content: two presentational,
 * fully-CONTROLLED pieces (no internal state of their own — every value and
 * every mutation is a prop/callback, same posture as `IndicatorActiveStrip`)
 * that `chart-workbench.tsx` renders in TWO SEPARATE DOM positions:
 *
 *  - `StrategyConfigPanel` — strategy select, param inputs, notional input,
 *    product-type chip, Run button, the Gross|Net stats card (or the
 *    "No signals" state). Lives INSIDE the tab-scoped wrapper — hidden via
 *    CSS `display:none` when the Ticket tab is active, exactly like the
 *    docked order ticket's own single-mount rule.
 *  - `StrategyDisclaimerFooter` — the mandatory amber disclaimer + scope
 *    note + Clear-signals button. Lives OUTSIDE the tab-scoped wrapper, in
 *    its OWN always-rendered position, so it satisfies the brief's explicit
 *    "must remain visible in BOTH tab states… must not be scrollable out of
 *    view or collapsible" acceptance criterion — a plain CSS-hide on the
 *    config panel's wrapper would otherwise hide the disclaimer right along
 *    with it the moment the user switches back to the Ticket tab.
 *    `chart-workbench.tsx` renders this footer once the Strategy tab has
 *    EVER been opened in the current workbench session (`hasOpenedStrategyTab`,
 *    sticky true) — nothing to disclaim before a strategy has ever been
 *    touched, but once it has, the disclaimer/Clear-signals affordance
 *    outlives the tab switch for as long as the workbench stays open.
 *
 * **The disclaimer copy**: the founder-locked plan's own draft
 * (`/Users/sarthak/.claude/plans/i-want-you-to-clever-eich.md`, §4) elides
 * two clauses with "…" in its own text ("full hindsight…" and "discount-
 * broker rates…"). Reproduced below with those elisions filled by minimal
 * connective language in the SAME voice the house's other paper-trading
 * disclaimer already uses (`paper-trading-disclaimer-footer.tsx`'s "may not
 * match what your real broker would charge") — every explicit clause the
 * plan states is present verbatim; the connective filler is flagged in the
 * S3 final report as a deviation needing founder sign-off on exact wording,
 * not silently invented.
 *
 * **Founder-feedback pass (2026-08-04) — compact by default.** The full
 * paragraph above was eating most of the Strategy tab's vertical space.
 * `StrategyDisclaimerFooter` now ALWAYS shows a single-line compact summary
 * ("Hypothetical results — not investment advice · costs estimated ·
 * hindsight flatters performance") with an ⓘ toggle that expands the exact
 * SAME `buildDisclaimerText(...)` paragraph, verbatim and unchanged, inline
 * below it — collapsed by default, component-local state (never persisted;
 * a fresh workbench open always starts collapsed). The honesty law this
 * footer's own doc above already establishes ("must remain visible in BOTH
 * tab states") is unaffected: the compact line is the thing that's always
 * visible now, not the full paragraph — nothing about backtest results is
 * ever shown withOUT it.
 *
 * **User Strategy Scripting (SS2), D6 — `origin` discriminator.**
 * `StrategyRunResult` now carries `origin: RunOrigin`, distinguishing a
 * template run (`{kind: "template", strategyId}` — set by
 * `chart-workbench.tsx`'s existing `handleRunStrategy`, one added field,
 * otherwise unchanged) from a script run (`{kind: "script", scriptId,
 * scriptName}` — set by `script-editor-drawer.tsx`'s own run handler, which
 * calls this SAME `runBacktest()` read-only, never a second parallel
 * backtest path). `StrategyStatsCard` is exported (was module-private) so
 * BOTH call sites — `StrategyConfigPanel` below (template path, unchanged
 * JSX) and the script drawer's own results display — import the identical
 * component rather than forking a copy. The origin badge (`OriginBadge`)
 * renders ABOVE the card at each call site, not inside it — `StrategyStatsCard`
 * stays origin-agnostic; it receives the full `runResult` (which now
 * carries `origin`) but never branches on it internally.
 */
import { useState } from "react";
import { Info } from "lucide-react";

import { STRATEGY_LIST, clampStrategyParams, getStrategyDef, type StrategyDef, type StrategySignal } from "@/lib/ta/strategies";
import { intervalToProductType, type BacktestStats } from "@/lib/ta/backtest";
import type { PaperProductType } from "@predict-future/business-rules/papertrading/costs";

/** SS2, D6 — which of the two signal producers a given run came from. A template run always carries the `STRATEGY_LIST` id that produced it; a script run carries the `UserStrategyScript` id/name (the id is `"new"` for a never-saved script — see `script-editor-drawer.tsx`). */
export type RunOrigin = { kind: "template"; strategyId: string } | { kind: "script"; scriptId: string; scriptName: string };

export interface StrategyRunResult {
  id: string;
  params: number[];
  signals: StrategySignal[];
  stats: BacktestStats;
  ranInterval: string;
  ranCandleCount: number;
  ranProductType: PaperProductType;
  origin: RunOrigin;
}

// ── localStorage — pf.workbench.strategy {v:1, id, params, notional} ────

export const STRATEGY_STORAGE_KEY = "pf.workbench.strategy";

export interface StoredStrategyConfig {
  id: string;
  params: number[];
  notional: number;
}

export function loadStoredStrategyConfig(): StoredStrategyConfig | null {
  try {
    const raw = window.localStorage.getItem(STRATEGY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || typeof p.id !== "string" || !Array.isArray(p.params) || typeof p.notional !== "number") return null;
    const def = getStrategyDef(p.id);
    if (!def) return null; // unknown/removed strategy id — degrade gracefully, don't render broken.
    const params = p.params.every((n) => typeof n === "number") ? clampStrategyParams(def, p.params as number[]) : def.params.map((s) => s.default);
    const notional = Number.isFinite(p.notional) && p.notional > 0 ? p.notional : 100000;
    return { id: p.id, params, notional };
  } catch {
    return null; // private mode / storage disabled / corrupt value.
  }
}

export function saveStoredStrategyConfig(config: StoredStrategyConfig): void {
  try {
    window.localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ v: 1, ...config }));
  } catch {
    // Preference just won't survive the refresh.
  }
}

// ── Shared formatting helpers ────────────────────────────────────────────

function formatRupees(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatPct(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function productTypeLabel(productType: PaperProductType): string {
  return productType === "DELIVERY" ? "Delivery" : "Intraday";
}

// ── StrategyConfigPanel — tab-scoped (CSS-hidden on the Ticket tab). ─────

export function StrategyConfigPanel({
  strategyId,
  onStrategyIdChange,
  paramValues,
  onParamValuesChange,
  notional,
  onNotionalChange,
  interval,
  candleCount,
  isPremiumMode,
  runResult,
  onRun
}: {
  strategyId: string;
  onStrategyIdChange: (id: string) => void;
  paramValues: number[];
  onParamValuesChange: (values: number[]) => void;
  notional: number;
  onNotionalChange: (value: number) => void;
  interval: string;
  candleCount: number;
  isPremiumMode: boolean;
  runResult: StrategyRunResult | null;
  onRun: () => void;
}) {
  const def = getStrategyDef(strategyId);
  const liveProductType = intervalToProductType(interval);
  const isStale = runResult !== null && runResult.ranInterval !== interval;
  const canRun = !!def && candleCount > 0;

  function setParam(index: number, raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = paramValues.map((v, i) => (i === index ? parsed : v));
    onParamValuesChange(next);
  }

  function clampParamOnBlur(index: number) {
    if (!def) return;
    onParamValuesChange(clampStrategyParams(def, paramValues));
    void index;
  }

  function setNotional(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onNotionalChange(parsed);
  }

  function clampNotionalOnBlur() {
    onNotionalChange(Math.min(1_000_000_000, Math.max(1000, notional)));
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-500">Strategy</label>
        <select
          value={strategyId}
          onChange={(e) => onStrategyIdChange(e.target.value)}
          className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm text-ink-800 outline-none focus:border-sky-400"
        >
          {STRATEGY_LIST.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {def && def.params.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {def.params.map((spec, i) => (
            <label key={spec.key} className="text-xs text-ink-600">
              <span className="mb-1 block">{spec.label}</span>
              <input
                type="number"
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                value={paramValues[i] ?? spec.default}
                onChange={(e) => setParam(i, e.target.value)}
                onBlur={() => clampParamOnBlur(i)}
                className="w-full rounded-lg border border-ink-200 px-2 py-1 text-right text-xs text-ink-800 outline-none focus:border-sky-400"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="flex-1 text-xs text-ink-600">
          <span className="mb-1 block">Notional (₹)</span>
          <input
            type="number"
            min={1000}
            step={1000}
            value={notional}
            onChange={(e) => setNotional(e.target.value)}
            onBlur={clampNotionalOnBlur}
            className="w-full rounded-lg border border-ink-200 px-2 py-1 text-right text-xs text-ink-800 outline-none focus:border-sky-400"
          />
        </label>
        <span
          title="Auto-derived from the active chart interval — 1d bars price as a Delivery trade, every intraday interval prices as Intraday."
          className="mt-4 shrink-0 rounded-full bg-ink-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-600"
        >
          {productTypeLabel(liveProductType)}
        </span>
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={!canRun}
        className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
      >
        Run backtest
      </button>

      {runResult && (
        <div>
          <OriginBadge origin={runResult.origin} />
          <StrategyStatsCard
            runResult={runResult}
            isStale={isStale}
            liveInterval={interval}
            liveCandleCount={candleCount}
            isPremiumMode={isPremiumMode}
          />
        </div>
      )}
    </div>
  );
}

/** SS2, D6 — "Template" or "Script: {name}", rendered as a small pill ABOVE the shared `StrategyStatsCard` at each call site (this component, not `StrategyStatsCard` itself, branches on `origin`). */
export function OriginBadge({ origin }: { origin: RunOrigin }) {
  const label = origin.kind === "template" ? "Template" : `Script: ${origin.scriptName}`;
  return (
    <span className="mb-1.5 inline-block rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</span>
  );
}

export function StrategyStatsCard({
  runResult,
  isStale,
  liveInterval,
  liveCandleCount,
  isPremiumMode
}: {
  runResult: StrategyRunResult;
  isStale: boolean;
  liveInterval: string;
  liveCandleCount: number;
  isPremiumMode: boolean;
}) {
  const { stats } = runResult;

  if (stats.trades === 0) {
    return (
      <div className="rounded-xl border border-ink-100 bg-ink-50 p-3 text-center text-xs text-ink-500">
        No signals over the loaded bars.
      </div>
    );
  }

  const netPositive = stats.netPnl >= 0;

  return (
    <div className="space-y-2 rounded-xl border border-ink-100 p-3">
      {isStale && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-700">
          Interval changed since this run ({liveCandleCount} {liveInterval} bars now loaded) — click Run backtest to refresh these
          numbers.
        </p>
      )}

      {/* Gross | Net columns — net visually PRIMARY: larger type, bold weight, a highlighted panel; gross is
          deliberately smaller and muted, per the T3 acceptance criterion ("gross must be visibly, unambiguously
          secondary/muted in a side-by-side comparison"). */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-ink-50 p-2 text-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">Gross</p>
          <p className="text-sm font-medium text-ink-500">{formatPct(stats.grossReturnPct)}</p>
          <p className="text-[11px] text-ink-400">{formatRupees(stats.grossPnl)}</p>
        </div>
        <div className={`rounded-lg p-2 text-center ${netPositive ? "bg-emerald-50" : "bg-rose-50"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${netPositive ? "text-emerald-700" : "text-rose-700"}`}>
            Net of costs
          </p>
          <p className={`text-lg font-bold ${netPositive ? "text-emerald-700" : "text-rose-700"}`}>{formatPct(stats.netReturnPct)}</p>
          <p className={`text-xs font-semibold ${netPositive ? "text-emerald-700" : "text-rose-700"}`}>{formatRupees(stats.netPnl)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-ink-500">
        <span>Costs (both legs)</span>
        <span className="font-medium text-ink-700">{formatRupees(stats.totalCosts)}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-500">
        <div className="flex justify-between">
          <span>Trades</span>
          <span className="font-medium text-ink-700">{stats.trades}</span>
        </div>
        <div className="flex justify-between">
          <span>Win rate</span>
          <span className="font-medium text-ink-700">{stats.winRatePct === null ? "—" : `${stats.winRatePct.toFixed(0)}%`}</span>
        </div>
        <div className="flex justify-between">
          <span>Max drawdown</span>
          <span className="font-medium text-ink-700">{stats.maxDrawdownPct.toFixed(2)}%</span>
        </div>
        <div className="flex justify-between">
          <span>Buy &amp; hold</span>
          <span className="font-medium text-ink-700">{formatPct(stats.buyHoldReturnPct)}</span>
        </div>
      </div>

      {stats.openAtEnd && (
        <p className="rounded-full bg-sky-50 px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-sky-700">
          Unrealised — position still open at the end of the loaded bars
        </p>
      )}

      <p className="text-[10px] leading-4 text-ink-400">
        Over the {runResult.ranCandleCount} loaded {runResult.ranInterval} bars · {productTypeLabel(runResult.ranProductType)} pricing.
        {isPremiumMode && " Bars are synthetic option-premium pseudo-candles, not exchange OHLC bars."}
      </p>
    </div>
  );
}

// ── StrategyDisclaimerFooter — NOT tab-scoped, always rendered once the
// Strategy tab has ever been opened this session. ────────────────────────

function buildDisclaimerText(n: number, interval: string, isPremiumMode: boolean): string {
  const base =
    `Hypothetical results — not investment advice. This backtest is a simulation over the ${n} delayed ${interval} bars ` +
    `currently loaded. No real orders were placed. Signals are computed on historical data with full hindsight, which ` +
    `flatters strategy performance relative to live trading. Transaction costs are estimated using indicative FY2025-26 ` +
    `discount-broker rates and may not match your real broker. Slippage, liquidity, partial fills, dividends and ` +
    `corporate actions are not modelled. Past performance does not predict future results.`;
  if (!isPremiumMode) return base;
  return (
    base +
    " This chart's candles are synthetic pseudo-candles built from periodic option-premium snapshots, not " +
    "exchange-traded OHLC bars — treat bar timing and backtest precision as approximate."
  );
}

export function StrategyDisclaimerFooter({
  runResult,
  liveInterval,
  liveCandleCount,
  isPremiumMode,
  hasActiveSignals,
  onClear
}: {
  runResult: StrategyRunResult | null;
  liveInterval: string;
  liveCandleCount: number;
  isPremiumMode: boolean;
  hasActiveSignals: boolean;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const n = runResult?.ranCandleCount ?? liveCandleCount;
  const interval = runResult?.ranInterval ?? liveInterval;

  return (
    <div className="shrink-0 space-y-2 border-t border-ink-100 bg-white p-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
        <div className="flex items-start gap-1.5">
          <p className="min-w-0 flex-1 text-[11px] font-medium leading-4 text-amber-800">
            Hypothetical results — not investment advice · costs estimated · hindsight flatters performance
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide full disclaimer" : "Show full disclaimer"}
            title={expanded ? "Hide full disclaimer" : "Show full disclaimer"}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {expanded && (
          <p className="mt-1.5 border-t border-amber-200 pt-1.5 text-[11px] leading-5 text-amber-800">
            {buildDisclaimerText(n, interval, isPremiumMode)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={!hasActiveSignals}
        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-300"
      >
        Clear signals
      </button>
    </div>
  );
}

export type { StrategyDef };
