"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { formatCompactINR } from "@/lib/utils";
import type { DividendPoint, FundamentalsPoint } from "@/lib/finance/fundamentals";

/**
 * Instrument Page v2 — Fundamentals panel, TradingView-style (founder
 * 2026-07-26: "should be chart like instead of data as they look better and
 * easier to understand"). Client component for the Annual/Quarterly toggle;
 * charts are pure inline SVG (house convention — see price-chart.tsx, no
 * chart library).
 *
 * Sections: Key stats grid (market cap, P/E TTM, dividend yield, EPS TTM,
 * beta, float) → Financials grouped-bar chart (Revenue + Net income per
 * period, Annual/Quarterly toggle) → EPS bar row → dividend history.
 * Every section with zero data renders NOTHING (graceful degrade — Yahoo's
 * per-symbol coverage genuinely varies, e.g. TATAMOTORS post-demerger).
 */

export type FundamentalsPanelProps = {
  annualRevenue: FundamentalsPoint[] | null;
  annualNetIncome: FundamentalsPoint[] | null;
  annualDilutedEps: FundamentalsPoint[] | null;
  quarterlyRevenue: FundamentalsPoint[] | null;
  quarterlyNetIncome: FundamentalsPoint[] | null;
  quarterlyDilutedEps: FundamentalsPoint[] | null;
  dividends: DividendPoint[] | null;
  /** TradingView-style Key Stats (founder request 2026-07-26) — null until the crumb-authenticated snapshot lands. */
  keyStats: {
    marketCap?: number;
    trailingPE?: number;
    dividendYield?: number;
    beta?: number;
    floatShares?: number;
    trailingEps?: number;
  } | null;
  fetchedAt: Date | null;
};

/** "2026-03-31" -> "Mar 2026". */
function formatPeriodLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(isoDate));
}

/** "FY26" style compact label for annual periods, "Mar 26" for quarters. */
function compactPeriodLabel(isoDate: string, mode: "annual" | "quarterly"): string {
  const d = new Date(isoDate);
  const yy = String(d.getUTCFullYear()).slice(-2);
  if (mode === "annual") return `FY${yy}`;
  const mon = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(d);
  return `${mon} ${yy}`;
}

function formatFetchedAt(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

function KeyStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-900">{value}</p>
    </div>
  );
}

// ── Grouped-bar Financials chart (Revenue + Net income per period) ───────────

const CHART_W = 640;
const CHART_H = 200;
const CHART_PAD = { top: 12, right: 8, bottom: 26, left: 8 };

const REVENUE_COLOR = "#2563eb"; // house blue
const NET_INCOME_COLOR = "#10b981"; // emerald
const EPS_COLOR = "#0ea5e9"; // sky
const DIVIDEND_COLOR = "#f59e0b"; // amber — dividends visually distinct from the earnings series

interface PeriodGroup {
  label: string;
  revenue: number | null;
  netIncome: number | null;
}

function alignByPeriod(
  revenue: FundamentalsPoint[] | null,
  netIncome: FundamentalsPoint[] | null,
  mode: "annual" | "quarterly"
): PeriodGroup[] {
  const byPeriod = new Map<string, PeriodGroup>();
  for (const p of revenue ?? []) {
    byPeriod.set(p.periodEnd, { label: compactPeriodLabel(p.periodEnd, mode), revenue: p.value, netIncome: null });
  }
  for (const p of netIncome ?? []) {
    const existing = byPeriod.get(p.periodEnd);
    if (existing) existing.netIncome = p.value;
    else byPeriod.set(p.periodEnd, { label: compactPeriodLabel(p.periodEnd, mode), revenue: null, netIncome: p.value });
  }
  return [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

/**
 * Interactive readout convention (founder 2026-07-26: "how can someone know
 * what value they are representing"): every chart shows a readout line ABOVE
 * it — the hovered/tapped period's exact values, defaulting to the latest
 * period — plus faint max/mid gridlines with compact labels so the scale
 * reads statically too. Hover highlights the active period's bars; pointer
 * events work for both mouse and touch (tap a group).
 */
function FinancialsBars({ groups }: { groups: PeriodGroup[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const values = groups.flatMap((g) => [g.revenue, g.netIncome]).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = maxV - minV || 1;

  const AXIS_W = 56;
  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right - AXIS_W;
  const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const groupW = innerW / groups.length;
  const barW = Math.min(28, groupW / 3);
  const y = (v: number) => CHART_PAD.top + ((maxV - v) / span) * innerH;
  const zeroY = y(0);

  const active = groups[hoverIdx ?? groups.length - 1];

  return (
    <div>
      <p className="mb-1 text-xs text-ink-600">
        <span className="font-semibold text-ink-900">{active.label}</span>
        {active.revenue != null && (
          <>
            {" · "}Revenue <span className="font-semibold" style={{ color: REVENUE_COLOR }}>{formatCompactINR(active.revenue)}</span>
          </>
        )}
        {active.netIncome != null && (
          <>
            {" · "}Net income{" "}
            <span className="font-semibold" style={{ color: NET_INCOME_COLOR }}>{formatCompactINR(active.netIncome)}</span>
          </>
        )}
      </p>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full touch-none"
        role="img"
        aria-label="Revenue and net income by period"
        onPointerLeave={() => setHoverIdx(null)}
      >
        {[maxV, (maxV + Math.min(minV, 0)) / 2].map((gv) => (
          <g key={gv}>
            <line x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right - AXIS_W} y1={y(gv)} y2={y(gv)} stroke="#f1f5f9" strokeWidth="1" />
            <text x={CHART_W - CHART_PAD.right - AXIS_W + 6} y={y(gv) + 3} fontSize="10" fill="#94a3b8">
              {formatCompactINR(gv)}
            </text>
          </g>
        ))}
        <line x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right - AXIS_W} y1={zeroY} y2={zeroY} stroke="#e2e8f0" strokeWidth="1" />
        {groups.map((g, i) => {
          const cx = CHART_PAD.left + groupW * i + groupW / 2;
          const dim = hoverIdx !== null && hoverIdx !== i;
          return (
            <g key={g.label} opacity={dim ? 0.35 : 1} onPointerEnter={() => setHoverIdx(i)} onPointerDown={() => setHoverIdx(i)}>
              {/* full-height invisible hit area so hover/tap works between thin bars */}
              <rect x={CHART_PAD.left + groupW * i} y={0} width={groupW} height={CHART_H} fill="transparent" />
              {g.revenue != null && (
                <rect
                  x={cx - barW - 2}
                  width={barW}
                  y={Math.min(y(g.revenue), zeroY)}
                  height={Math.max(2, Math.abs(y(g.revenue) - zeroY))}
                  rx={3}
                  fill={REVENUE_COLOR}
                />
              )}
              {g.netIncome != null && (
                <rect
                  x={cx + 2}
                  width={barW}
                  y={Math.min(y(g.netIncome), zeroY)}
                  height={Math.max(2, Math.abs(y(g.netIncome) - zeroY))}
                  rx={3}
                  fill={NET_INCOME_COLOR}
                />
              )}
              <text x={cx} y={CHART_H - 8} textAnchor="middle" fontSize="11" fill={dim ? "#cbd5e1" : "#94a3b8"}>
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Shared small interactive bar chart — EPS and dividends both use it (one readout line, hover/tap highlight, latest-by-default). */
function SmallBars({
  items,
  color,
  ariaLabel,
  readoutPrefix,
  formatValue,
}: {
  items: { label: string; value: number }[];
  color: string;
  ariaLabel: string;
  readoutPrefix: string;
  formatValue: (v: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (items.length === 0) return null;
  const values = items.map((p) => p.value);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = maxV - minV || 1;
  const H = 110;
  const pad = { top: 8, bottom: 24 };
  const innerH = H - pad.top - pad.bottom;
  const groupW = CHART_W / items.length;
  const barW = Math.min(24, groupW / 2.5);
  const y = (v: number) => pad.top + ((maxV - v) / span) * innerH;
  const zeroY = y(0);

  const active = items[hoverIdx ?? items.length - 1];

  return (
    <div>
      <p className="mb-1 text-xs text-ink-600">
        <span className="font-semibold text-ink-900">{active.label}</span>
        {" · "}
        {readoutPrefix} <span className="font-semibold" style={{ color }}>{formatValue(active.value)}</span>
      </p>
      <svg
        viewBox={`0 0 ${CHART_W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={ariaLabel}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <line x1={0} x2={CHART_W} y1={zeroY} y2={zeroY} stroke="#e2e8f0" strokeWidth="1" />
        {items.map((p, i) => {
          const cx = groupW * i + groupW / 2;
          const dim = hoverIdx !== null && hoverIdx !== i;
          return (
            <g key={`${p.label}-${i}`} opacity={dim ? 0.35 : 1} onPointerEnter={() => setHoverIdx(i)} onPointerDown={() => setHoverIdx(i)}>
              <rect x={groupW * i} y={0} width={groupW} height={H} fill="transparent" />
              <rect
                x={cx - barW / 2}
                width={barW}
                y={Math.min(y(p.value), zeroY)}
                height={Math.max(2, Math.abs(y(p.value) - zeroY))}
                rx={3}
                fill={color}
              />
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fill={dim ? "#cbd5e1" : "#94a3b8"}>
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EpsBars({ points, mode }: { points: FundamentalsPoint[]; mode: "annual" | "quarterly" }) {
  return (
    <SmallBars
      items={points.map((p) => ({ label: compactPeriodLabel(p.periodEnd, mode), value: p.value }))}
      color={EPS_COLOR}
      ariaLabel="Diluted EPS by period"
      readoutPrefix="EPS"
      formatValue={(v) => `₹${v.toFixed(2)}`}
    />
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export function FundamentalsPanel({
  annualRevenue,
  annualNetIncome,
  annualDilutedEps,
  quarterlyRevenue,
  quarterlyNetIncome,
  quarterlyDilutedEps,
  dividends,
  keyStats,
  fetchedAt,
}: FundamentalsPanelProps) {
  const [mode, setMode] = useState<"annual" | "quarterly">("annual");

  const hasAnnual = [annualRevenue, annualNetIncome, annualDilutedEps].some((s) => s && s.length > 0);
  const hasQuarterly = [quarterlyRevenue, quarterlyNetIncome, quarterlyDilutedEps].some((s) => s && s.length > 0);
  const hasDividends = dividends != null && dividends.length > 0;
  const hasKeyStats = keyStats != null && Object.keys(keyStats).length > 0;

  if (!hasAnnual && !hasQuarterly && !hasDividends && !hasKeyStats) return null;

  const activeMode: "annual" | "quarterly" = mode === "quarterly" && hasQuarterly ? "quarterly" : "annual";
  const revenue = activeMode === "annual" ? annualRevenue : quarterlyRevenue;
  const netIncome = activeMode === "annual" ? annualNetIncome : quarterlyNetIncome;
  const eps = activeMode === "annual" ? annualDilutedEps : quarterlyDilutedEps;
  const groups = alignByPeriod(revenue, netIncome, activeMode);

  const latestQuarterEps =
    quarterlyDilutedEps && quarterlyDilutedEps.length > 0 ? quarterlyDilutedEps[quarterlyDilutedEps.length - 1] : null;

  return (
    <Card>
      <CardContent className="space-y-6 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Fundamentals</p>
          {fetchedAt && (
            <p className="text-[11px] text-ink-400">
              Source: Yahoo Finance — may lag official filings · as of {formatFetchedAt(fetchedAt)}
            </p>
          )}
        </div>

        {hasKeyStats && keyStats && (
          <div>
            <p className="mb-2 text-xs font-semibold text-ink-500">Key stats</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {keyStats.marketCap !== undefined && <KeyStat label="Market cap" value={formatCompactINR(keyStats.marketCap)} />}
              {keyStats.trailingPE !== undefined && <KeyStat label="P/E ratio (TTM)" value={keyStats.trailingPE.toFixed(1)} />}
              {keyStats.dividendYield !== undefined && (
                <KeyStat label="Dividend yield" value={`${(keyStats.dividendYield * 100).toFixed(2)}%`} />
              )}
              {keyStats.trailingEps !== undefined && <KeyStat label="EPS (TTM)" value={`₹${keyStats.trailingEps.toFixed(2)}`} />}
              {keyStats.beta !== undefined && <KeyStat label="Beta (5Y monthly)" value={keyStats.beta.toFixed(2)} />}
              {keyStats.floatShares !== undefined && (
                <KeyStat label="Shares float" value={formatCompactINR(keyStats.floatShares).replace("₹", "")} />
              )}
              {latestQuarterEps && (
                <KeyStat
                  label={`EPS · quarter ended ${formatPeriodLabel(latestQuarterEps.periodEnd)}`}
                  value={`₹${latestQuarterEps.value.toFixed(2)}`}
                />
              )}
            </div>
          </div>
        )}

        {(hasAnnual || hasQuarterly) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-500">Financials</p>
              <div className="inline-flex rounded-xl border border-ink-200 bg-white p-0.5">
                {(["annual", "quarterly"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={m === "quarterly" ? !hasQuarterly : !hasAnnual}
                    onClick={() => setMode(m)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition disabled:cursor-not-allowed disabled:text-ink-300 ${
                      activeMode === m ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {groups.length > 0 && (
              <div>
                <FinancialsBars groups={groups} />
                <div className="mt-1 flex flex-wrap gap-4">
                  <LegendDot color={REVENUE_COLOR} label="Revenue" />
                  <LegendDot color={NET_INCOME_COLOR} label="Net income" />
                </div>
              </div>
            )}

            {eps && eps.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-500">Diluted EPS (₹)</p>
                <EpsBars points={eps} mode={activeMode} />
              </div>
            )}
          </div>
        )}

        {hasDividends && dividends && (
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-500">Dividends (₹ per share)</p>
            <SmallBars
              items={[...dividends]
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(-10)
                .map((d) => ({ label: formatPeriodLabel(d.date), value: d.amount }))}
              color={DIVIDEND_COLOR}
              ariaLabel="Dividend per share by payout"
              readoutPrefix="Dividend"
              formatValue={(v) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} per share`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
