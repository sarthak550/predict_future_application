"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { ComboChart, type ComboSeriesDef, type AxisFormat } from "@/components/finance/combo-chart";
import { formatCompactCurrency } from "@/lib/utils";
import { qoqGrowth, yoyGrowth } from "@/lib/finance/growth";
import type {
  DividendRow,
  DividendPayoutRow,
  LegacyDividendYearRow,
  LegacyDividendEventRow,
  FundamentalsPoint,
  DebtCoverage,
} from "@/lib/finance/fundamentals";

/**
 * Fundamentals Panel v2 (Sprint 1) — TradingView/research-deck-style
 * fundamentals panel. Every chart routes through the shared `ComboChart`
 * core (combo-chart.tsx) — this file owns section composition (which
 * series, which colors, which formatters, currency selection, growth
 * math wiring) and the panel's own layout/toggle chrome, per the
 * founder-approved plan. The five old bespoke SVG chart components this
 * file used to define (FinancialsBars, SmallBars, EpsBars,
 * DividendYieldBars, DividendPayoutBars, DebtCoverageBars) are deleted —
 * fully superseded by ComboChart.
 *
 * Sections (current vertical order — the 2-column deck grid + §04–§06 new
 * sections are Sprint 2, per the plan's sprint split): Key stats grid →
 * §01 Income statement performance (Revenue/Net income/EBITDA bars +
 * revenue-growth dashed line, Annual/Quarterly toggle) → §02 Diluted EPS
 * (bars) → §07 Debt level and coverage (bars) → §03 Dividend history
 * (bars + annualised-yield/TTM-growth dashed lines, three legacy shapes
 * tolerated). Every section with zero data renders NOTHING (graceful
 * degrade — Yahoo's per-symbol coverage genuinely varies).
 */

export type FundamentalsPanelProps = {
  annualRevenue: FundamentalsPoint[] | null;
  annualNetIncome: FundamentalsPoint[] | null;
  annualDilutedEps: FundamentalsPoint[] | null;
  quarterlyRevenue: FundamentalsPoint[] | null;
  quarterlyNetIncome: FundamentalsPoint[] | null;
  quarterlyDilutedEps: FundamentalsPoint[] | null;
  /**
   * One row per dividend payout event, in whichever shape this symbol's
   * cache row last happened to be written in — a symbol not yet refetched
   * since the 2026-08-02b sprint may still hold the per-calendar-year or
   * original per-event shape. See `classifyDividendRows` below for the
   * render-path dispatch.
   */
  dividends: DividendRow[] | null;
  /** Debt level and coverage, EBITDA, and (Sprint 1, T1.1) balance-sheet series + currencyCode — null until fetched; individual series may be absent (esp. quarterly, or EBITDA for a bank). */
  debtCoverage: DebtCoverage | null;
  /** TradingView-style Key Stats (founder request 2026-07-26) — null until the crumb-authenticated snapshot lands. Deliberately kept ₹-only regardless of `debtCoverage.currencyCode` (plan §6) — QA eyeballs INFY's `trailingEps` against this basis. */
  keyStats: {
    marketCap?: number;
    trailingPE?: number;
    dividendYield?: number;
    /** Legacy Yahoo beta (5Y-monthly, undisclosed benchmark) — fallback tile only, rendered when neither beta1Y nor beta5Y is present on this row yet. */
    beta?: number;
    floatShares?: number;
    trailingEps?: number;
    /** Self-computed vs. NIFTY 50, trailing 1y of daily returns — see lib/finance/beta.ts. */
    beta1Y?: number;
    /** Self-computed vs. NIFTY 50, trailing 5y of monthly returns — see lib/finance/beta.ts. */
    beta5Y?: number;
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

/** "2025-11-15" -> "15 Nov 25", for per-payout x-axis labels (payout dates, unlike period-ends, need day granularity — two payouts in the same month are common). */
function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(iso));
}

function formatFetchedAt(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

// ── Axis-tick formatting (founder chart-polish pass) ──────────────────────────
//
// `ComboChart`'s `formatPrimaryAxis`/`formatSecondaryAxis` props are
// FACTORIES — `(domainMax) => AxisFormat` — called once per render with the
// axis's own nice-scale max, so a single "declared once" unit (e.g. "₹ L
// Cr") covers every tick on that axis (research-deck convention) instead of
// each tick carrying its own repeated ₹/unit suffix. These are AXIS-ONLY:
// every section's tooltip still uses its full `fmtMoney`/`fmtRupee`/etc.
// formatter (via each series' own `formatValue`), completely unchanged by
// this pass — only the two axis-gutter props below route through these.

/** "8.7300" -> "8.73", "8.0000" -> "8", "0.0000" -> "0" — strips a fixed-decimal string down to its shortest honest representation for an axis tick. */
function trimTrailingZeros(fixed: string): string {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function formatAxisNumber(value: number, maxDp: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${trimTrailingZeros(Math.abs(value).toFixed(maxDp))}`;
}

/**
 * Money axis factory — §01/02/03/05/06/07 all route through this. Picks ONE
 * scale band (matching `formatCompactCurrency`'s own INR lakh/crore and USD
 * T/B/M/K thresholds) from the axis's nice-scale MAX, so every tick on the
 * SAME axis shares one consistent magnitude (avoids a 0/50L/1Cr/1.5Cr axis
 * silently crossing the lakh↔crore boundary mid-axis) — each tick then
 * renders just its short number, with the unit ("₹ L Cr", "$ B", …) declared
 * once via `AxisFormat.unit`. `currencyCode: null` is §03 Dividend Profile's
 * deliberate ₹-only carve-out (never currency-aware, per that section's own
 * doc comment) — everywhere else this is `debtCoverage?.currencyCode`.
 */
function makeMoneyAxisFormat(currencyCode: string | null): (domainMax: number) => AxisFormat {
  const code = currencyCode ?? "INR";
  return (domainMax: number): AxisFormat => {
    const abs = Math.abs(domainMax);
    if (code === "INR") {
      if (abs >= 1e12) return { unit: "₹", tick: (v) => `${formatAxisNumber(v / 1e12, 1)} L Cr` };
      if (abs >= 1e7) return { unit: "₹", tick: (v) => `${formatAxisNumber(v / 1e7, 1)} Cr` };
      if (abs >= 1e5) return { unit: "₹", tick: (v) => `${formatAxisNumber(v / 1e5, 1)} L` };
      return { unit: "₹", tick: (v) => formatAxisNumber(v, 0) };
    }
    if (code === "USD") {
      if (abs >= 1e12) return { unit: "$", tick: (v) => `${formatAxisNumber(v / 1e12, 2)} T` };
      if (abs >= 1e9) return { unit: "$", tick: (v) => `${formatAxisNumber(v / 1e9, 2)} B` };
      if (abs >= 1e6) return { unit: "$", tick: (v) => `${formatAxisNumber(v / 1e6, 2)} M` };
      if (abs >= 1e3) return { unit: "$", tick: (v) => `${formatAxisNumber(v / 1e3, 2)} K` };
      return { unit: "$", tick: (v) => formatAxisNumber(v, 0) };
    }
    // Unknown/other currency — no compaction convention assumed (matches
    // `formatCompactCurrency`'s own fallback), unit is just the raw code.
    return { unit: code, tick: (v) => formatAxisNumber(v, 0) };
  };
}

/** Percent axis factory — §01 revenue growth, §03 yield/growth, §04 operating efficiency. Nice-scale ticks are already round numbers (e.g. 0/5/10/15); 1 decimal of headroom covers a fractional step (e.g. 2.5%) without ever showing a spurious ".0". */
function makePercentAxisFormat(): (domainMax: number) => AxisFormat {
  return (): AxisFormat => ({ unit: "", tick: (v) => `${formatAxisNumber(v, 1)}%` });
}

/** Ratio (×) axis factory — §05 debt/equity + asset turnover. */
function makeRatioAxisFormat(): (domainMax: number) => AxisFormat {
  return (): AxisFormat => ({ unit: "", tick: (v) => `${formatAxisNumber(v, 2)}×` });
}

/**
 * §04's "MISSING FY23" founder feedback, root-caused: YoY growth for the
 * earliest fiscal year in any aligned window is null BY CONSTRUCTION
 * (`yoyGrowth` has no prior-year point to compare against — see growth.ts),
 * not a bug. Empirically confirmed 2026-08 (widened the fundamentals-
 * timeseries probe window to period1 = now−8y, RELIANCE.NS, all 6 annual
 * balance-sheet keys): Yahoo still returns exactly 4 annual points
 * (2023-03-31..2026-03-31) — it hard-caps annual coverage at 4 periods
 * regardless of the requested window, so a 5th (FY22) point is categorically
 * unavailable, not merely unrequested. Widening `ANNUAL_LOOKBACK_YEARS` in
 * fundamentals.ts would therefore change nothing and was NOT done.
 * The earliest fiscal year already renders as a visible x-axis category with
 * a null gap (no line mark) — `ComboChart`'s category labels are never
 * data-gated — but nothing explained WHY until this footnote names the
 * actual missing prior year explicitly, rather than a generic "earliest year
 * has no comparison" note.
 */
function firstYearGrowthFootnote(earliestPeriodEndIso: string): string {
  const d = new Date(earliestPeriodEndIso);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const priorYy = String(d.getUTCFullYear() - 1).slice(-2);
  return `FY${yy} growth needs FY${priorYy} filings, which the data source doesn't provide.`;
}

function KeyStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-ink-900">{value}</p>
    </div>
  );
}

/**
 * Deck layout (Sprint 2, T2.2, founder-approved plan §7) — the "01 ·" /
 * "02 ·" / … numbering + small-caps title every section in the redesigned
 * panel shares. Each section function below renders this INSIDE its own
 * early-return gate (never the parent), so a section with zero data renders
 * neither header nor chart — the pairing grid then reflows around the gap
 * (a null React child simply isn't a grid item).
 *
 * `qualifier` is the plan's "small honesty touch": §04–06 are annual-only
 * regardless of the panel's Annual/Quarterly toggle, so their callers pass
 * `qualifier="Annual"` ONLY while the toggle is set to Quarterly — making
 * the mismatch (why these three charts didn't just switch like §01/02/07
 * did) explicit rather than silently inconsistent.
 */
function SectionHeader({ index, title, qualifier }: { index: string; title: string; qualifier?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
        <span className="tabular-nums text-ink-300">{index} · </span>
        {title}
      </p>
      {qualifier && <p className="text-[11px] text-ink-400">{qualifier}</p>}
    </div>
  );
}

// ── Palette (SERIES_COLORS registry — founder-approved plan §4, formalized Sprint 2 T2.2) ──

/**
 * Single source of truth for every series color across the Fundamentals
 * panel — Sprint 1 kept these as scattered per-section `const`s; Sprint 2
 * T2.2 formalizes them into one registry object per the plan's explicit ask,
 * so a future palette change never has to be hunted across section
 * functions. Every value below is validated with the dataviz skill's
 * `scripts/validate_palette.js` against the OTHER colors that appear on the
 * SAME chart (never across charts — colors are safely reused across
 * different charts, e.g. `debt`/`totalDebtCapStructure` share a hex on
 * purpose, since they're never rendered together).
 */
const SERIES_COLORS = {
  // §01 Income Statement Performance
  revenue: "#2563eb", // house blue
  netIncome: "#10b981", // emerald
  /** Changed Sprint 1 from #8b5cf6 — failed the validator's all-pairs CVD check against Revenue's blue. */
  ebitda: "#a21caf",
  /** Revenue-growth YoY dashed secondary line. */
  revenueGrowth: "#f97316",

  // §02 Shareholder Returns (Diluted EPS)
  eps: "#0ea5e9", // sky

  // §03 Dividend Profile
  dividend: "#f59e0b", // amber — ₹/share bars
  /** Annualised-yield dashed secondary line. Changed Sprint 1 from the panel's old teal (collided with §07's Free-cash-flow teal — different chart, but the same hex read as the same series identity across the deck). */
  yieldLine: "#6366f1",
  /** TTM-dividend-growth dashed secondary line. */
  divGrowth: "#e11d48",

  // §04 Operating Efficiency (all four share ONE % axis — no bars, no dual-axis ambiguity, so no forced dashing)
  opexSales: "#f97316",
  opexFixedAssets: "#2563eb",
  opexReceivables: "#0d9488",
  opexInventory: "#e11d48",

  // §05 Capital Structure & Asset Utilization
  totalAssets: "#6366f1", // indigo bar
  totalDebtCapStructure: "#ec4899", // pink bar — same hex as §07's `debt` (never co-rendered)
  debtToEquity: "#f97316", // dashed secondary ×
  assetTurnover: "#0d9488", // dashed secondary ×

  // §06 Asset Base Composition (stacked; slate ramp — see this file's `AssetBaseCompositionSection` doc comment for why the dataviz validator's categorical checks don't apply here)
  assetBaseFixed: "#475569",
  assetBaseCurrent: "#94a3b8",
  assetBaseOther: "#cbd5e1",

  // §07 Debt Level & Coverage
  debt: "#ec4899", // pink (TradingView convention, founder-familiar)
  /**
   * FIXED Sprint 2 T2.2 (orchestrator ruling): was #14b8a6 (teal) — failed
   * the dataviz validator's all-pairs CVD check against Debt's pink (ΔE 3.7
   * deutan, below the 6.0 floor). Re-picked to the closest green that keeps
   * Debt=pink (TradingView convention, kept per ruling) and Cash=blue
   * untouched: `node scripts/validate_palette.js "#ec4899,#16a34a,#3b82f6"
   * --mode light --pairs all` -> ALL CHECKS PASS (ΔE 8.8 deutan vs Debt,
   * 29.4 normal-vision vs Cash, 3:1+ contrast on white). Only this one color
   * changed — Debt and Cash are untouched, per "adjust the minimal number of
   * the three colors."
   */
  freeCashFlow: "#16a34a",
  cash: "#3b82f6", // blue, palette unchanged
} as const;

const SECTION_H_HERO = 240; // 80% of 300, same founder reduction // §01, full-width — reduced from 210 (founder chart-polish pass: "make it small a bit")
// Founder readability pass 2026-08-02: paired (half-width) sections were
// unreadably small because they rendered the same 640-unit viewBox as §01
// into half the CSS width — every glyph scaled to ~half size. Fix = a
// NARROWER canvas (SECTION_W_PAIR, so text renders near-natural size at
// half-column width) PLUS more height. §01 keeps the full 640 canvas.
const SECTION_W_PAIR = 480;
// Founder 2026-08-02 (third sizing pass): "the ratios went opposite I meant
// 3:4" — PORTRAIT, taller than wide: all paired sections share ONE exact
// 3:4 canvas (360×480). The DISPLAYED chart stays capped at 400px wide
// (ComboChart's maxDisplayWidth) so a below-lg single-column stack can
// never balloon a 360-unit canvas to full card width.
const SECTION_H_PAIR = 240; // 80% of 300 (founder 2026-08-02: "reduce to 80%")
const SECTION_H_PAIR_TOP = SECTION_H_PAIR; // §02 | §03 — the founder's EPS/Dividends side-by-side
const SECTION_H_PAIR_MID = SECTION_H_PAIR; // §04 | §05
const SECTION_H_PAIR_BOTTOM = SECTION_H_PAIR; // §06 | §07
const SECTION_MAX_DISPLAY_W = 560;

/**
 * Runtime shape guard for whatever `InstrumentEnrichment.dividends` last
 * happened to hold — three shapes have been written to this Json column
 * across three same-week sprints (see fundamentals.ts's `DividendRow` doc
 * comment), and a cache row is only ever ONE shape at a time (written
 * wholesale on each refresh), so sniffing the first row is sufficient.
 * UNTOUCHED by the Sprint 1 ComboChart migration — every shape this already
 * distinguishes still renders, just through the new shared chart core.
 */
function classifyDividendRows(rows: DividendRow[]): "payout" | "legacyYear" | "legacyEvent" {
  const r0 = rows[0] as Record<string, unknown>;
  if ("year" in r0) return "legacyYear";
  if ("ttmDividendTotal" in r0 || "annualisedYieldPct" in r0 || "priceOnDate" in r0) return "payout";
  return "legacyEvent";
}

// ── Period alignment (generalized — was three near-identical byPeriod maps) ──

type PeriodGroup<K extends string> = { label: string; periodEnd: string; values: Record<K, number | null> };

/**
 * Joins N fundamentals series onto one array of period groups, keyed by
 * `periodEnd` — generalizes what used to be two separate near-identical
 * `byPeriod` map-building blocks (one inside `FinancialsBars`'s caller, one
 * inside `DebtCoverageBars`) into a single reusable helper. `periodEnd` is
 * preserved on each group (the old version dropped it) specifically so
 * `IncomeStatementSection` can join `yoyGrowth`'s map back onto these same
 * groups.
 */
function alignByPeriod<K extends string>(
  seriesByKey: Record<K, FundamentalsPoint[] | null>,
  mode: "annual" | "quarterly"
): PeriodGroup<K>[] {
  const keys = Object.keys(seriesByKey) as K[];
  const byPeriod = new Map<string, PeriodGroup<K>>();
  for (const key of keys) {
    for (const p of seriesByKey[key] ?? []) {
      let existing = byPeriod.get(p.periodEnd);
      if (!existing) {
        const values = {} as Record<K, number | null>;
        for (const k of keys) values[k] = null;
        existing = { label: compactPeriodLabel(p.periodEnd, mode), periodEnd: p.periodEnd, values };
        byPeriod.set(p.periodEnd, existing);
      }
      existing.values[key] = p.value;
    }
  }
  return [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

// ── §01 Income statement performance ──────────────────────────────────────────

/**
 * Revenue/Net income/EBITDA bars + a revenue-growth-YoY dashed secondary
 * line — the "richest chart" the Sprint 1 T1.2 parity proof targets.
 * Quarterly-mode gating (founder-approved plan §3): the growth line is
 * omitted entirely (with a footnote) when fewer than one quarterly period
 * has a computable YoY comparison, rather than rendering an almost-empty
 * line.
 */
function IncomeStatementSection({
  revenue,
  netIncome,
  ebitda,
  mode,
  currencyCode,
}: {
  revenue: FundamentalsPoint[] | null;
  netIncome: FundamentalsPoint[] | null;
  ebitda: FundamentalsPoint[] | null;
  mode: "annual" | "quarterly";
  currencyCode: string | null;
}) {
  const groups = alignByPeriod({ revenue, netIncome, ebitda }, mode);
  if (groups.length === 0) return null;

  // Founder 2026-08-02: quarterly plots show sequential QUARTER-OVER-QUARTER
  // growth ("quarterly growth instead of annual") — labeled "QoQ", a
  // different metric from annual mode's YoY, never presented interchangeably.
  // QoQ points carry their comparison basis (Yahoo's quarterly series has
  // real holes) — disclosed per-point via tooltipDetail below.
  const qoqMap = mode === "quarterly" ? qoqGrowth(revenue) : null;
  const yoyMap = mode === "quarterly" ? null : yoyGrowth(revenue, mode);
  const qoqPoints = qoqMap ? groups.map((g) => qoqMap.get(g.periodEnd) ?? null) : null;
  const growthValues = qoqPoints
    ? qoqPoints.map((p) => (p ? p.pct : null))
    : groups.map((g) => yoyMap?.get(g.periodEnd) ?? null);
  const hasGrowth = growthValues.some((v) => v != null);
  const growthTooltipDetail = qoqPoints
    ? (idx: number) => {
        const p = qoqPoints[idx];
        if (!p) return null;
        return `vs ${formatPeriodLabel(p.basisPeriodEnd)}${p.basisIsNonAdjacent ? " (prior quarter unreported)" : ""}`;
      }
    : undefined;
  const hasEbitda = groups.some((g) => g.values.ebitda != null);

  const fmtMoney = (v: number) => formatCompactCurrency(v, currencyCode);
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const series: ComboSeriesDef[] = [
    {
      id: "revenue",
      label: "Revenue",
      color: SERIES_COLORS.revenue,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.revenue),
      formatValue: fmtMoney,
    },
    {
      id: "netIncome",
      label: "Net income",
      color: SERIES_COLORS.netIncome,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.netIncome),
      formatValue: fmtMoney,
    },
  ];
  if (hasEbitda) {
    series.push({
      id: "ebitda",
      label: "EBITDA",
      color: SERIES_COLORS.ebitda,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.ebitda),
      formatValue: fmtMoney,
    });
  }
  if (hasGrowth) {
    series.push({
      id: "revenueGrowth",
      label: mode === "quarterly" ? "Revenue growth QoQ" : "Revenue growth YoY",
      color: SERIES_COLORS.revenueGrowth,
      kind: "line",
      axis: "secondary",
      dashed: true,
      values: growthValues,
      formatValue: fmtPct,
      tooltipDetail: growthTooltipDetail,
    });
  }

  // Founder chart-polish pass: the earliest period in ANNUAL mode always has
  // a null revenue-growth point (no prior year to compare against — same
  // root cause as §04's, see `firstYearGrowthFootnote`'s doc comment) but
  // previously had no footnote explaining it in annual mode (the old
  // condition only fired when growth was missing ENTIRELY, in quarterly
  // mode). `hasGrowth` being true in annual mode implies exactly this case,
  // since `yoyGrowth` always nulls the first point in a series.
  const footnote =
    mode === "quarterly" && !hasGrowth
      ? "Quarter-over-quarter growth needs at least two consecutive quarters."
      : mode === "annual" && hasGrowth
        ? firstYearGrowthFootnote(groups[0].periodEnd)
        : undefined;

  return (
    <div>
      <SectionHeader index="01" title="Income Statement Performance" />
      <ComboChart
        categories={groups.map((g) => g.label)}
        series={series}
        height={SECTION_H_HERO}
        formatPrimaryAxis={makeMoneyAxisFormat(currencyCode)}
        formatSecondaryAxis={hasGrowth ? makePercentAxisFormat() : undefined}
        ariaLabel="Revenue, net income, EBITDA and revenue growth by period"
        footnote={footnote}
      />
    </div>
  );
}

// ── §02 Diluted EPS (stays bars — deck's "line" would overstate continuity on 4 points) ──

function EpsSection({
  points,
  mode,
  currencyCode,
}: {
  points: FundamentalsPoint[] | null;
  mode: "annual" | "quarterly";
  currencyCode: string | null;
}) {
  if (!points || points.length === 0) return null;
  const fmt = (v: number) => formatCompactCurrency(v, currencyCode, { precision: 2 });
  const series: ComboSeriesDef[] = [
    {
      id: "eps",
      label: "Diluted EPS",
      color: SERIES_COLORS.eps,
      kind: "bar",
      axis: "primary",
      values: points.map((p) => p.value),
      formatValue: fmt,
    },
  ];
  return (
    <div>
      <SectionHeader index="02" title="Shareholder Returns" />
      <ComboChart
        categories={points.map((p) => compactPeriodLabel(p.periodEnd, mode))}
        series={series}
        height={SECTION_H_PAIR_TOP}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
        formatPrimaryAxis={makeMoneyAxisFormat(currencyCode)}
        ariaLabel="Diluted EPS by period"
        legend={false}
      />
    </div>
  );
}

// ── §04 Operating Efficiency (Sprint 2, T2.1 — annual-only regardless of the panel's toggle) ──

/**
 * YoY growth of Sales / Fixed assets (NetPPE) / Receivables / Inventory, all
 * sharing ONE % axis — deliberately no bars and no secondary axis at all
 * here (every series is the same kind of quantity), so lines render solid,
 * not the dual-axis-honesty dashed treatment `combo-chart.tsx` forces on
 * secondary-axis lines elsewhere in this panel. Reuses the exact same
 * `yoyGrowth` (growth.ts) the §01 revenue-growth line already uses.
 *
 * Absent-series-omitted (incl. legend) is handled entirely by `ComboChart`
 * itself (a series with zero non-null values never renders) — this is
 * exactly the INFY case (no `annualInventory` coverage) the plan calls out.
 * Section-level gate (plan §T2.1): render only if AT LEAST ONE of the four
 * series has AT LEAST ONE computable point — a lone-series chart is still a
 * valid, honest chart; an all-null chart is not.
 */
function OperatingEfficiencySection({
  annualRevenue,
  annualNetPPE,
  annualAccountsReceivable,
  annualInventory,
  toggleMode,
}: {
  annualRevenue: FundamentalsPoint[] | null;
  annualNetPPE: FundamentalsPoint[] | null;
  annualAccountsReceivable: FundamentalsPoint[] | null;
  annualInventory: FundamentalsPoint[] | null;
  /** The PANEL's live Annual/Quarterly toggle (this section itself is always annual) — only consulted for the SectionHeader's "Annual" honesty qualifier. */
  toggleMode: "annual" | "quarterly";
}) {
  const allGroups = alignByPeriod(
    { sales: annualRevenue, fixedAssets: annualNetPPE, receivables: annualAccountsReceivable, inventory: annualInventory },
    "annual"
  );
  if (allGroups.length === 0) return null;

  const salesGrowth = yoyGrowth(annualRevenue, "annual");
  const fixedAssetGrowth = yoyGrowth(annualNetPPE, "annual");
  const receivablesGrowth = yoyGrowth(annualAccountsReceivable, "annual");
  const inventoryGrowth = yoyGrowth(annualInventory, "annual");

  // Founder 2026-08-02: this chart is growth-only, so a year where EVERY
  // series is null (the earliest year — Yahoo serves 4 fiscal years, so the
  // first has no prior year to grow from) renders as a bare axis label with
  // nothing above it, which "looks weird". Drop all-null years from the axis
  // entirely instead of footnoting the gap. §01 keeps its earliest year (its
  // BARS have data there; only its growth line gaps) — this trim is
  // deliberately §04-local.
  const groups = allGroups.filter((g) =>
    [salesGrowth, fixedAssetGrowth, receivablesGrowth, inventoryGrowth].some((m) => m.get(g.periodEnd) != null)
  );
  if (groups.length === 0) return null;

  const salesValues = groups.map((g) => salesGrowth.get(g.periodEnd) ?? null);
  const fixedAssetValues = groups.map((g) => fixedAssetGrowth.get(g.periodEnd) ?? null);
  const receivablesValues = groups.map((g) => receivablesGrowth.get(g.periodEnd) ?? null);
  const inventoryValues = groups.map((g) => inventoryGrowth.get(g.periodEnd) ?? null);

  const hasAny = [salesValues, fixedAssetValues, receivablesValues, inventoryValues].some((vs) => vs.some((v) => v != null));
  if (!hasAny) return null;

  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const series: ComboSeriesDef[] = [];
  if (salesValues.some((v) => v != null)) {
    series.push({ id: "salesGrowth", label: "Sales", color: SERIES_COLORS.opexSales, kind: "line", axis: "primary", values: salesValues, formatValue: fmtPct });
  }
  if (fixedAssetValues.some((v) => v != null)) {
    series.push({ id: "fixedAssetGrowth", label: "Fixed assets", color: SERIES_COLORS.opexFixedAssets, kind: "line", axis: "primary", values: fixedAssetValues, formatValue: fmtPct });
  }
  if (receivablesValues.some((v) => v != null)) {
    series.push({ id: "receivablesGrowth", label: "Receivables", color: SERIES_COLORS.opexReceivables, kind: "line", axis: "primary", values: receivablesValues, formatValue: fmtPct });
  }
  if (inventoryValues.some((v) => v != null)) {
    series.push({ id: "inventoryGrowth", label: "Inventory", color: SERIES_COLORS.opexInventory, kind: "line", axis: "primary", values: inventoryValues, formatValue: fmtPct });
  }

  return (
    <div>
      <SectionHeader index="04" title="Operating Efficiency (Growth Rate)" qualifier={toggleMode === "quarterly" ? "Annual" : undefined} />
      <ComboChart
        categories={groups.map((g) => g.label)}
        series={series}
        height={SECTION_H_PAIR_MID}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
        formatPrimaryAxis={makePercentAxisFormat()}
        ariaLabel="Year-over-year growth in sales, fixed assets, receivables and inventory"
      />
    </div>
  );
}

// ── §05 Capital Structure & Asset Utilization (Sprint 2, T2.1 — annual-only) ──

/**
 * Total assets + Total debt bars (primary ₹) with D/E and Asset-turnover
 * dashed lines sharing ONE secondary × axis. D/E (`debt / equity`) is null
 * whenever reported equity is zero or negative — a leveraged-to-negative-
 * equity company's D/E isn't a meaningful ratio, never fabricated. Asset
 * turnover (`revenue_t / avg(assets_t, assets_t-1)`) is null for the
 * earliest available year (no prior-year assets to average) and whenever
 * either year's assets figure is missing.
 */
function CapitalStructureSection({
  annualTotalAssets,
  annualDebt,
  annualStockholdersEquity,
  annualRevenue,
  currencyCode,
  toggleMode,
}: {
  annualTotalAssets: FundamentalsPoint[] | null;
  annualDebt: FundamentalsPoint[] | null;
  annualStockholdersEquity: FundamentalsPoint[] | null;
  annualRevenue: FundamentalsPoint[] | null;
  currencyCode: string | null;
  toggleMode: "annual" | "quarterly";
}) {
  const groups = alignByPeriod(
    { assets: annualTotalAssets, debt: annualDebt, equity: annualStockholdersEquity, revenue: annualRevenue },
    "annual"
  );
  if (groups.length === 0) return null;

  const hasAssets = groups.some((g) => g.values.assets != null);
  const hasDebt = groups.some((g) => g.values.debt != null);
  if (!hasAssets && !hasDebt) return null;

  let deHasNegativeEquityCase = false;
  const deValues = groups.map((g) => {
    const { debt, equity } = g.values;
    if (debt == null || equity == null) return null;
    if (equity <= 0) {
      deHasNegativeEquityCase = true;
      return null;
    }
    return debt / equity;
  });

  const atoValues = groups.map((g, i) => {
    if (i === 0) return null; // first available year always null — no prior-year assets to average
    const prevAssets = groups[i - 1].values.assets;
    const { assets, revenue } = g.values;
    if (assets == null || prevAssets == null || revenue == null) return null;
    const avgAssets = (assets + prevAssets) / 2;
    if (avgAssets <= 0) return null;
    return revenue / avgAssets;
  });

  const hasDE = deValues.some((v) => v != null);
  const hasATO = atoValues.some((v) => v != null);

  const fmtMoney = (v: number) => formatCompactCurrency(v, currencyCode);
  const fmtRatio = (v: number) => `${v.toFixed(2)}×`;

  const series: ComboSeriesDef[] = [];
  if (hasAssets) {
    series.push({
      id: "assets",
      label: "Total assets",
      color: SERIES_COLORS.totalAssets,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.assets),
      formatValue: fmtMoney,
    });
  }
  if (hasDebt) {
    series.push({
      id: "debt",
      label: "Total debt",
      color: SERIES_COLORS.totalDebtCapStructure,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.debt),
      formatValue: fmtMoney,
    });
  }
  if (hasDE) {
    series.push({
      id: "de",
      label: "Debt / equity",
      color: SERIES_COLORS.debtToEquity,
      kind: "line",
      axis: "secondary",
      dashed: true,
      values: deValues,
      formatValue: fmtRatio,
    });
  }
  if (hasATO) {
    series.push({
      id: "ato",
      label: "Asset turnover",
      color: SERIES_COLORS.assetTurnover,
      kind: "line",
      axis: "secondary",
      dashed: true,
      values: atoValues,
      formatValue: fmtRatio,
    });
  }

  const footnotes: string[] = [];
  if (deHasNegativeEquityCase) footnotes.push("Debt/equity omitted where reported equity was zero or negative.");
  if (hasATO) footnotes.push("Asset turnover needs a prior year of assets — omitted for the earliest available year.");

  return (
    <div>
      <SectionHeader index="05" title="Capital Structure & Asset Utilization" qualifier={toggleMode === "quarterly" ? "Annual" : undefined} />
      <ComboChart
        categories={groups.map((g) => g.label)}
        series={series}
        height={SECTION_H_PAIR_MID}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
        formatPrimaryAxis={makeMoneyAxisFormat(currencyCode)}
        formatSecondaryAxis={hasDE || hasATO ? makeRatioAxisFormat() : undefined}
        ariaLabel="Total assets, total debt, debt-to-equity and asset turnover by year"
        footnote={footnotes.length > 0 ? footnotes.join(" ") : undefined}
      />
    </div>
  );
}

// ── §06 Asset Base Composition (Sprint 2, T2.1 — first real use of ComboChart's `stackedBars` mode) ──

/**
 * Fixed (NetPPE) / Current (CurrentAssets) / Other (TotalAssets − PPE − CA,
 * floored at 0) stacked into one column per year — a slate light-to-dark
 * ramp rather than a categorical palette. Deliberate: this is an ORDERED
 * composition (each segment is literally part of the same "total assets"
 * whole, read as a lightness gradient — darkest/most-solid = Fixed, lightest
 * /most-residual = Other), not three unrelated identities, so the dataviz
 * skill's SEQUENTIAL rule ("one hue, light→dark") applies here, not its
 * categorical CVD-separation rule. Running the categorical validator against
 * this ramp deliberately FAILs the lightness-band/chroma-floor checks
 * (`node scripts/validate_palette.js "#475569,#94a3b8,#cbd5e1" --mode light
 * --pairs all` -> lightness band + chroma floor FAIL) — expected and
 * correct, those checks assume distinct categorical hues, not a monochrome
 * ramp; segment identity here comes from the legend + tooltip rows (never
 * color alone), matching the "table view as relief" principle for a
 * borderline-contrast palette.
 *
 * `Other` is a derived residual, not a fetched series — floored at 0 with a
 * footnote for any year where fixed+current assets exceed reported total
 * assets (a genuine data-quality edge case in Yahoo's balance-sheet feed,
 * never silently shown as a negative bar segment).
 */
function AssetBaseCompositionSection({
  annualNetPPE,
  annualCurrentAssets,
  annualTotalAssets,
  currencyCode,
  toggleMode,
}: {
  annualNetPPE: FundamentalsPoint[] | null;
  annualCurrentAssets: FundamentalsPoint[] | null;
  annualTotalAssets: FundamentalsPoint[] | null;
  currencyCode: string | null;
  toggleMode: "annual" | "quarterly";
}) {
  const groups = alignByPeriod({ ppe: annualNetPPE, currentAssets: annualCurrentAssets, totalAssets: annualTotalAssets }, "annual");
  if (groups.length === 0) return null;

  const hasPpe = groups.some((g) => g.values.ppe != null);
  const hasCurrentAssets = groups.some((g) => g.values.currentAssets != null);
  if (!hasPpe && !hasCurrentAssets) return null;

  let hasNegativeOther = false;
  const otherValues = groups.map((g) => {
    const { ppe, currentAssets, totalAssets } = g.values;
    if (ppe == null || currentAssets == null || totalAssets == null) return null;
    const other = totalAssets - ppe - currentAssets;
    if (other < 0) {
      hasNegativeOther = true;
      return 0;
    }
    return other;
  });
  const hasOther = otherValues.some((v) => v != null);

  const fmtMoney = (v: number) => formatCompactCurrency(v, currencyCode);

  const series: ComboSeriesDef[] = [];
  if (hasPpe) {
    series.push({
      id: "fixed",
      label: "Fixed assets",
      color: SERIES_COLORS.assetBaseFixed,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.ppe),
      formatValue: fmtMoney,
    });
  }
  if (hasCurrentAssets) {
    series.push({
      id: "current",
      label: "Current assets",
      color: SERIES_COLORS.assetBaseCurrent,
      kind: "bar",
      axis: "primary",
      values: groups.map((g) => g.values.currentAssets),
      formatValue: fmtMoney,
    });
  }
  if (hasOther) {
    series.push({
      id: "other",
      label: "Other assets",
      color: SERIES_COLORS.assetBaseOther,
      kind: "bar",
      axis: "primary",
      values: otherValues,
      formatValue: fmtMoney,
    });
  }

  return (
    <div>
      <SectionHeader index="06" title="Asset Base Composition" qualifier={toggleMode === "quarterly" ? "Annual" : undefined} />
      <ComboChart
        categories={groups.map((g) => g.label)}
        series={series}
        height={SECTION_H_PAIR_BOTTOM}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
        stackedBars
        formatPrimaryAxis={makeMoneyAxisFormat(currencyCode)}
        ariaLabel="Fixed, current and other assets as a share of total assets by year"
        footnote={
          hasNegativeOther
            ? "Other assets floored at zero for years where fixed and current assets exceeded reported total assets."
            : undefined
        }
      />
    </div>
  );
}

// ── §07 Debt level and coverage (renamed from the deck's original numbering; palette unchanged) ──

/**
 * DEVIATION (documented): the founder-approved plan's §6 formatter section
 * explicitly scopes `formatCompactCurrency` to "§01/02/05/06" and lists
 * "dividends + key stats stay ₹" as the only carve-outs — §07 isn't named
 * either way. Since §07's debt/FCF/cash figures come from the SAME
 * currencyCode-bearing `debtCoverage` batch as §01's EBITDA, leaving §07
 * hardcoded to ₹ would silently reintroduce the exact INFY (USD) mislabeling
 * bug this ticket fixes everywhere else it touches. Applied
 * `formatCompactCurrency` here too; flagged for founder confirmation.
 */
function DebtCoverageSection({
  debt,
  freeCashFlow,
  cash,
  mode,
  showAnnualQualifier = false,
  currencyCode,
}: {
  debt: FundamentalsPoint[] | null;
  freeCashFlow: FundamentalsPoint[] | null;
  cash: FundamentalsPoint[] | null;
  mode: "annual" | "quarterly";
  /** True when the panel toggle is on Quarterly but this section fell back to annual data (semi-annual quarterly filings too sparse) — renders the same "Annual" honesty qualifier §04–§06 use. */
  showAnnualQualifier?: boolean;
  currencyCode: string | null;
}) {
  const groups = alignByPeriod({ debt, fcf: freeCashFlow, cash }, mode);
  if (groups.length === 0) return null;

  const fmt = (v: number) => formatCompactCurrency(v, currencyCode);

  const series: ComboSeriesDef[] = [
    { id: "debt", label: "Debt", color: SERIES_COLORS.debt, kind: "bar", axis: "primary", values: groups.map((g) => g.values.debt), formatValue: fmt },
    { id: "fcf", label: "Free cash flow", color: SERIES_COLORS.freeCashFlow, kind: "bar", axis: "primary", values: groups.map((g) => g.values.fcf), formatValue: fmt },
    { id: "cash", label: "Cash & equivalents", color: SERIES_COLORS.cash, kind: "bar", axis: "primary", values: groups.map((g) => g.values.cash), formatValue: fmt },
  ];

  return (
    <div>
      <SectionHeader index="07" title="Debt Level & Coverage" qualifier={showAnnualQualifier ? "Annual" : undefined} />
      <ComboChart
        categories={groups.map((g) => g.label)}
        series={series}
        height={SECTION_H_PAIR_BOTTOM}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
        formatPrimaryAxis={makeMoneyAxisFormat(currencyCode)}
        ariaLabel="Debt, free cash flow and cash by period"
      />
    </div>
  );
}

// ── §03 Dividend history (all three legacy shapes) ────────────────────────────

/**
 * CRITICAL LABELING (founder explicit — never present the yield line as a
 * bare "dividend yield"): every surface says "Annualised yield", and the
 * tooltip's per-row detail sub-line discloses BOTH calculation inputs
 * (`ttmDividendTotal`, `priceOnDate`) inline — e.g. "₹20.50 TTM ÷ ₹402.00
 * price" — never just the bare percentage. A null `annualisedYieldPct`
 * renders via `tooltipFallback` ("Annualised yield unavailable"), never a
 * fabricated 0%. Same discipline for the new TTM-dividend-growth line's
 * comparison basis ("vs ₹18.20 TTM a year earlier").
 *
 * DEVIATION FROM BRIEF (carried over from the pre-migration component):
 * Yahoo's `events.dividends` feed carries no interim/final/special payout
 * TYPE classification — omitted rather than fabricated, same house honesty
 * convention this ticket enforces for the yield/growth figures themselves.
 *
 * Dividends stay hardcoded ₹ regardless of `debtCoverage.currencyCode` (plan
 * §6) — this section deliberately does NOT receive a currencyCode prop.
 */
function DividendsSection({ dividends }: { dividends: DividendRow[] }) {
  const shape = classifyDividendRows(dividends);
  const fmtRupee = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;
  const fmtSignedPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  if (shape === "payout") {
    const rows = [...(dividends as DividendPayoutRow[])].sort((a, b) => a.date.localeCompare(b.date));
    const hasYield = rows.some((r) => r.annualisedYieldPct != null);
    const hasGrowth = rows.some((r) => r.growthPct != null);

    const series: ComboSeriesDef[] = [
      {
        id: "amount",
        label: "Dividend (₹/share)",
        color: SERIES_COLORS.dividend,
        kind: "bar",
        axis: "primary",
        values: rows.map((r) => r.amount),
        formatValue: fmtRupee,
      },
    ];
    if (hasYield) {
      series.push({
        id: "yield",
        label: "Annualised yield",
        color: SERIES_COLORS.yieldLine,
        kind: "line",
        axis: "secondary",
        dashed: true,
        values: rows.map((r) => r.annualisedYieldPct),
        formatValue: fmtPct,
        tooltipDetail: (idx) => {
          const r = rows[idx];
          return r.ttmDividendTotal != null && r.priceOnDate != null
            ? `${fmtRupee(r.ttmDividendTotal)} TTM ÷ ${fmtRupee(r.priceOnDate)} price`
            : null;
        },
        tooltipFallback: () => "Annualised yield unavailable",
      });
    }
    if (hasGrowth) {
      series.push({
        id: "growth",
        label: "TTM dividend growth",
        color: SERIES_COLORS.divGrowth,
        kind: "line",
        axis: "secondary",
        dashed: true,
        values: rows.map((r) => r.growthPct),
        formatValue: fmtSignedPct,
        tooltipDetail: (idx) => {
          const r = rows[idx];
          if (r.ttmDividendTotalPrevYear == null) return null;
          // Drift-fallback disclosure: when the strict prior-year window was
          // empty and the basis anchored at last year's comparable payout,
          // name that date explicitly (fundamentals.ts's growthBasisDate).
          return r.growthBasisDate
            ? `vs ${fmtRupee(r.ttmDividendTotalPrevYear)} TTM as of ${formatShortDate(r.growthBasisDate)}`
            : `vs ${fmtRupee(r.ttmDividendTotalPrevYear)} TTM a year earlier`;
        },
      });
    }

    return (
      <div>
        <SectionHeader index="03" title="Dividend Profile" />
        <ComboChart
          categories={rows.map((r) => formatShortDate(r.date))}
          series={series}
          height={SECTION_H_PAIR_TOP}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
          formatPrimaryAxis={makeMoneyAxisFormat(null)}
          formatSecondaryAxis={hasYield || hasGrowth ? makePercentAxisFormat() : undefined}
          ariaLabel="Dividend per payout, annualised yield and TTM dividend growth"
        />
      </div>
    );
  }

  if (shape === "legacyYear") {
    const rows = [...(dividends as LegacyDividendYearRow[])].sort((a, b) => a.year - b.year);
    const hasYield = rows.some((r) => r.yieldPct != null);

    const series: ComboSeriesDef[] = [
      {
        id: "amount",
        label: "Dividend (₹/share)",
        color: SERIES_COLORS.dividend,
        kind: "bar",
        axis: "primary",
        values: rows.map((r) => r.totalDividend),
        formatValue: fmtRupee,
      },
    ];
    if (hasYield) {
      series.push({
        id: "yield",
        label: "Annualised yield",
        color: SERIES_COLORS.yieldLine,
        kind: "line",
        axis: "secondary",
        dashed: true,
        values: rows.map((r) => r.yieldPct),
        formatValue: fmtPct,
        tooltipFallback: () => "Annualised yield unavailable",
      });
    }

    return (
      <div>
        <SectionHeader index="03" title="Dividend Profile" />
        <ComboChart
          categories={rows.map((r) => (r.isYtd ? `${r.year} YTD` : `${r.year}`))}
          series={series}
          height={SECTION_H_PAIR_TOP}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
          formatPrimaryAxis={makeMoneyAxisFormat(null)}
          formatSecondaryAxis={hasYield ? makePercentAxisFormat() : undefined}
          ariaLabel="Dividend per share and annualised yield by year"
        />
      </div>
    );
  }

  // legacyEvent — original pre-yield-sprint shape, bars-only, never had a yield field.
  const rows = [...(dividends as LegacyDividendEventRow[])].sort((a, b) => a.date.localeCompare(b.date));
  const series: ComboSeriesDef[] = [
    {
      id: "amount",
      label: "Dividend (₹/share)",
      color: SERIES_COLORS.dividend,
      kind: "bar",
      axis: "primary",
      values: rows.map((r) => r.amount),
      formatValue: fmtRupee,
    },
  ];
  return (
    <div>
      <SectionHeader index="03" title="Dividend Profile" />
      <ComboChart
        categories={rows.map((r) => formatShortDate(r.date))}
        series={series}
        height={SECTION_H_PAIR_TOP}
        width={SECTION_W_PAIR}
        maxDisplayWidth={SECTION_MAX_DISPLAY_W}
        formatPrimaryAxis={makeMoneyAxisFormat(null)}
        ariaLabel="Dividend per payout"
        legend={false}
      />
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

export function FundamentalsPanel({
  annualRevenue,
  annualNetIncome,
  annualDilutedEps,
  quarterlyRevenue,
  quarterlyNetIncome,
  quarterlyDilutedEps,
  dividends,
  debtCoverage,
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
  const ebitda = (activeMode === "annual" ? debtCoverage?.annualEbitda : debtCoverage?.quarterlyEbitda) ?? null;
  // Sprint 1, T1.1 — timeseries-derived figures (§01/02/07) render in
  // whatever currency Yahoo actually reported (INFY = USD); dividends and
  // key stats deliberately stay ₹-only (see DividendsSection's doc comment).
  const currencyCode = debtCoverage?.currencyCode ?? "INR";

  const latestQuarterEps =
    quarterlyDilutedEps && quarterlyDilutedEps.length > 0 ? quarterlyDilutedEps[quarterlyDilutedEps.length - 1] : null;

  // Sprint 2, T2.2 — the "Reported in ..." chip reads the RAW `debtCoverage`
  // value (never the `?? "INR"`-defaulted `currencyCode` above), since a
  // null currencyCode (no debtCoverage fetched yet) must show no chip at
  // all, not silently imply "INR confirmed."
  const rawCurrencyCode = debtCoverage?.currencyCode ?? null;
  const showCurrencyChip = rawCurrencyCode != null && rawCurrencyCode !== "INR";

  return (
    <section className="space-y-4">
      {/* Founder 2026-08-02: section heading OUTSIDE the card, matching the
          "Analyst opinions" pattern — the old small-caps in-card label is gone. */}
      <h2 className="text-xl font-semibold text-ink-900">Fundamentals</h2>
      <Card>
      <CardContent className="space-y-6 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            {showCurrencyChip && (
              <span className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500">
                Reported in {rawCurrencyCode}
              </span>
            )}
          </div>
          {fetchedAt && (
            <p className="text-[11px] text-ink-400">
              Source: Yahoo Finance — may lag official filings · as of {formatFetchedAt(fetchedAt)}
            </p>
          )}
        </div>

        {hasKeyStats && keyStats && (
          <div>
            <p className="mb-2 text-base font-semibold text-ink-900">Key stats</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {keyStats.marketCap !== undefined && <KeyStat label="Market cap" value={formatCompactCurrency(keyStats.marketCap, "INR")} />}
              {keyStats.trailingPE !== undefined && <KeyStat label="P/E ratio (TTM)" value={keyStats.trailingPE.toFixed(1)} />}
              {keyStats.dividendYield !== undefined && (
                <KeyStat label="Dividend yield" value={`${(keyStats.dividendYield * 100).toFixed(2)}%`} />
              )}
              {keyStats.trailingEps !== undefined && <KeyStat label="EPS (TTM)" value={`₹${keyStats.trailingEps.toFixed(2)}`} />}
              {/*
                Beta — three tiles are possible depending on what this row has cached:
                  - beta1Y and/or beta5Y present (self-computed vs. NIFTY 50, per-field
                    independent so a symbol with <3y of history can still show a valid
                    1Y beta with an honest null 5Y): render whichever of the two exists,
                    each its own tile.
                  - neither present but the legacy Yahoo `beta` is (row not yet refetched
                    since this feature shipped): fall back to the single old tile.
                  - none present: no beta tile at all.
              */}
              {keyStats.beta1Y !== undefined && <KeyStat label="Beta (1Y · daily vs NIFTY 50)" value={keyStats.beta1Y.toFixed(2)} />}
              {keyStats.beta5Y !== undefined && <KeyStat label="Beta (5Y · monthly vs NIFTY 50)" value={keyStats.beta5Y.toFixed(2)} />}
              {keyStats.beta1Y === undefined && keyStats.beta5Y === undefined && keyStats.beta !== undefined && (
                <KeyStat label="Beta (5Y monthly)" value={keyStats.beta.toFixed(2)} />
              )}
              {keyStats.floatShares !== undefined && (
                <KeyStat label="Shares float" value={formatCompactCurrency(keyStats.floatShares, "INR").replace("₹", "")} />
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold text-ink-900">Financials</p>
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
        )}

        {/* §01 — full-width hero chart (founder-approved plan §7). */}
        <IncomeStatementSection revenue={revenue} netIncome={netIncome} ebitda={ebitda} mode={activeMode} currencyCode={currencyCode} />

        {/*
          §02–§07 — the 2-column deck grid (plan §7). Every child below is
          EITHER the section's own root `<div>` (header + chart together) OR
          `null` — never an always-present wrapper — so an empty section
          truly renders nothing and `grid-template-columns: repeat(2, 1fr)`
          naturally reflows the remaining cells around the gap. §04–06 are
          annual-only regardless of the toggle above (fed `annualXxx` props
          directly, never `activeMode`-switched) — their SectionHeader shows
          an "Annual" qualifier while the toggle is on Quarterly so that
          mismatch is explicit rather than silently inconsistent.
        */}
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <EpsSection points={eps} mode={activeMode} currencyCode={currencyCode} />
          {hasDividends && dividends && <DividendsSection dividends={dividends} />}

          {debtCoverage && (
            <OperatingEfficiencySection
              annualRevenue={annualRevenue}
              annualNetPPE={debtCoverage.annualNetPPE}
              annualAccountsReceivable={debtCoverage.annualAccountsReceivable}
              annualInventory={debtCoverage.annualInventory}
              toggleMode={activeMode}
            />
          )}
          {debtCoverage && (
            <CapitalStructureSection
              annualTotalAssets={debtCoverage.annualTotalAssets}
              annualDebt={debtCoverage.annualDebt}
              annualStockholdersEquity={debtCoverage.annualStockholdersEquity}
              annualRevenue={annualRevenue}
              currencyCode={currencyCode}
              toggleMode={activeMode}
            />
          )}

          {debtCoverage && (
            <AssetBaseCompositionSection
              annualNetPPE={debtCoverage.annualNetPPE}
              annualCurrentAssets={debtCoverage.annualCurrentAssets}
              annualTotalAssets={debtCoverage.annualTotalAssets}
              currencyCode={currencyCode}
              toggleMode={activeMode}
            />
          )}
          {debtCoverage &&
            (() => {
              // Founder 2026-08-02: "quarterly debt level coverage not
              // properly shown" — balance-sheet items report SEMI-annually
              // for many NSE names (RELIANCE: 2 quarterly points; TCS: 5),
              // so quarterly mode rendered a sparse 2-bar chart with no FCF.
              // When the quarterly series is that thin (< 3 periods), fall
              // back to the ANNUAL data with the same explicit "Annual"
              // qualifier §04–§06 already use in quarterly mode.
              const quarterlyPeriods = new Set([
                ...(debtCoverage.quarterlyDebt ?? []).map((p) => p.periodEnd),
                ...(debtCoverage.quarterlyCash ?? []).map((p) => p.periodEnd),
              ]).size;
              const useQuarterly = activeMode === "quarterly" && quarterlyPeriods >= 3;
              return (
                <DebtCoverageSection
                  debt={useQuarterly ? debtCoverage.quarterlyDebt : debtCoverage.annualDebt}
                  freeCashFlow={useQuarterly ? null : debtCoverage.annualFreeCashFlow}
                  cash={useQuarterly ? debtCoverage.quarterlyCash : debtCoverage.annualCash}
                  mode={useQuarterly ? "quarterly" : "annual"}
                  showAnnualQualifier={activeMode === "quarterly" && !useQuarterly}
                  currencyCode={currencyCode}
                />
              );
            })()}
        </div>
      </CardContent>
      </Card>
    </section>
  );
}
