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

function FinancialsBars({ groups }: { groups: PeriodGroup[] }) {
  const values = groups.flatMap((g) => [g.revenue, g.netIncome]).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = maxV - minV || 1;

  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const groupW = innerW / groups.length;
  const barW = Math.min(28, groupW / 3);
  const y = (v: number) => CHART_PAD.top + ((maxV - v) / span) * innerH;
  const zeroY = y(0);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label="Revenue and net income by period">
      <line x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={zeroY} y2={zeroY} stroke="#e2e8f0" strokeWidth="1" />
      {groups.map((g, i) => {
        const cx = CHART_PAD.left + groupW * i + groupW / 2;
        return (
          <g key={g.label}>
            {g.revenue != null && (
              <rect
                x={cx - barW - 2}
                width={barW}
                y={Math.min(y(g.revenue), zeroY)}
                height={Math.max(2, Math.abs(y(g.revenue) - zeroY))}
                rx={3}
                fill={REVENUE_COLOR}
              >
                <title>{`${g.label} revenue: ${formatCompactINR(g.revenue)}`}</title>
              </rect>
            )}
            {g.netIncome != null && (
              <rect
                x={cx + 2}
                width={barW}
                y={Math.min(y(g.netIncome), zeroY)}
                height={Math.max(2, Math.abs(y(g.netIncome) - zeroY))}
                rx={3}
                fill={NET_INCOME_COLOR}
              >
                <title>{`${g.label} net income: ${formatCompactINR(g.netIncome)}`}</title>
              </rect>
            )}
            <text x={cx} y={CHART_H - 8} textAnchor="middle" fontSize="11" fill="#94a3b8">
              {g.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EpsBars({ points, mode }: { points: FundamentalsPoint[]; mode: "annual" | "quarterly" }) {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = maxV - minV || 1;
  const H = 110;
  const pad = { top: 8, bottom: 24 };
  const innerH = H - pad.top - pad.bottom;
  const groupW = CHART_W / points.length;
  const barW = Math.min(24, groupW / 2.5);
  const y = (v: number) => pad.top + ((maxV - v) / span) * innerH;
  const zeroY = y(0);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${H}`} className="w-full" role="img" aria-label="Diluted EPS by period">
      <line x1={0} x2={CHART_W} y1={zeroY} y2={zeroY} stroke="#e2e8f0" strokeWidth="1" />
      {points.map((p, i) => {
        const cx = groupW * i + groupW / 2;
        return (
          <g key={p.periodEnd}>
            <rect
              x={cx - barW / 2}
              width={barW}
              y={Math.min(y(p.value), zeroY)}
              height={Math.max(2, Math.abs(y(p.value) - zeroY))}
              rx={3}
              fill={EPS_COLOR}
            >
              <title>{`${compactPeriodLabel(p.periodEnd, mode)} EPS: ₹${p.value.toFixed(2)}`}</title>
            </rect>
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">
              {compactPeriodLabel(p.periodEnd, mode)}
            </text>
          </g>
        );
      })}
    </svg>
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
            <p className="mb-2 text-xs font-semibold text-ink-500">Dividends (per share)</p>
            <div className="flex flex-wrap gap-2">
              {[...dividends]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 8)
                .map((d) => (
                  <span key={d.date} className="rounded-xl bg-ink-50 px-2.5 py-1 text-xs text-ink-600">
                    {formatPeriodLabel(d.date)} · ₹{d.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </span>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
