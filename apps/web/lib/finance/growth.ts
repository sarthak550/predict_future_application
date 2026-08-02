/**
 * Fundamentals Panel v2 (Sprint 1, T1.2) — pure YoY growth math for
 * fundamentals-timeseries series. No I/O, no React; a plain function so it's
 * trivially reusable across every chart section that needs a growth line
 * (§01 revenue growth this sprint; §04's multi-line growth panel inherits
 * this same function in Sprint 2 — see the founder-approved plan's §3).
 */

import type { FundamentalsPoint } from "@/lib/finance/fundamentals";

export type GrowthMode = "annual" | "quarterly";

/**
 * Year-over-year growth for a fundamentals series, keyed by `periodEnd` —
 * the SAME key `alignByPeriod` (fundamentals-panel.tsx) groups periods by,
 * so a caller can join this map straight onto its aligned period groups.
 *
 * Both modes use the identical comparison: each point vs. the point whose
 * `periodEnd` is EXACTLY one calendar year earlier (same month/day, year−1).
 * For annual data that's "vs the prior fiscal year"; for quarterly data
 * Yahoo's periodEnd dates are stable per fiscal quarter (e.g. always
 * "-06-30" for a given quarter), so the same exact-date lookup also
 * correctly finds "the same quarter last year" — never a nearest-prior or
 * index-offset lookup, either of which could silently misalign across a
 * missing or late-reported period.
 *
 * Null (never fabricated, never 0) when: no point exists at exactly that
 * prior date, the prior value is <= 0 (a growth % against a loss-making or
 * zero base isn't a meaningful percentage), or `periodEnd` fails to parse.
 * The first period in any series is always null — no prior year can ever
 * exist for it. Callers doing quarterly-mode gating should treat "every
 * value in the returned map is null" as "omit this line + show a footnote"
 * (see fundamentals-panel.tsx's IncomeStatementSection).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `mode` is part of the locked public signature (plan §3: `yoyGrowth(points, mode)`) for API clarity/future differentiation; the exact-date comparison below is identical for both modes today (see doc comment above).
export function yoyGrowth(points: FundamentalsPoint[] | null, mode: GrowthMode): Map<string, number | null> {
  const result = new Map<string, number | null>();
  if (!points || points.length === 0) return result;

  const byPeriodEnd = new Map(points.map((p) => [p.periodEnd, p.value]));

  for (const p of points) {
    const d = new Date(p.periodEnd);
    if (Number.isNaN(d.getTime())) {
      result.set(p.periodEnd, null);
      continue;
    }
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const priorPeriodEnd = `${d.getUTCFullYear() - 1}-${mm}-${dd}`;
    const priorValue = byPeriodEnd.get(priorPeriodEnd);

    if (priorValue == null || priorValue <= 0) {
      result.set(p.periodEnd, null);
      continue;
    }
    result.set(p.periodEnd, ((p.value - priorValue) / priorValue) * 100);
  }

  return result;
}

/**
 * Sequential quarter-over-quarter growth, keyed by `periodEnd` — each quarter
 * vs. the IMMEDIATELY PRECEDING quarter (founder 2026-08-02: "on the
 * quarterly plots lets have quarterly growth instead of annual"). With
 * Yahoo's ~5 cached quarters this yields ~4 computable points where the YoY
 * same-quarter comparison yields ~1 — but it is a DIFFERENT metric (seasonal
 * businesses swing QoQ), so every consumer must label it "QoQ", never bare
 * "growth" and never interchangeably with `yoyGrowth`.
 *
 * "Immediately preceding" is validated by date, not array index: the prior
 * point's `periodEnd` must fall 60–120 days earlier — a missing or
 * late-reported quarter breaks the chain to null rather than silently
 * comparing across a gap. Null (never 0) when: no valid prior quarter, prior
 * value <= 0, or unparseable dates. The first quarter is always null.
 */
export type QoqGrowthPoint = {
  pct: number;
  /** The prior quarter this growth was computed against — consumers MUST disclose it in the tooltip ("vs Jun 2025"), because Yahoo's quarterly series has real holes. */
  basisPeriodEnd: string;
  /** True when the comparison skipped over an unreported quarter (gap > ~1 quarter) — consumers append "(prior quarter unreported)" so a 2-quarter jump is never silently presented as sequential. */
  basisIsNonAdjacent: boolean;
};

export function qoqGrowth(points: FundamentalsPoint[] | null): Map<string, QoqGrowthPoint | null> {
  const result = new Map<string, QoqGrowthPoint | null>();
  if (!points || points.length === 0) return result;

  const sorted = [...points].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const d = new Date(p.periodEnd);
    const pd = prev ? new Date(prev.periodEnd) : null;

    if (!prev || !pd || Number.isNaN(d.getTime()) || Number.isNaN(pd.getTime())) {
      result.set(p.periodEnd, null);
      continue;
    }
    const gapDays = (d.getTime() - pd.getTime()) / 86_400_000;
    // Yahoo's quarterly series genuinely skips quarters (e.g. Sep-2025 absent
    // for RELIANCE and TCS alike, verified 2026-08-02) — a strict adjacent-
    // quarter rule nulled half the line ("quarterly growths are still not
    // there properly", founder). Compare vs the previous REPORTED quarter up
    // to ~2 quarters back, flagging non-adjacency so the tooltip disclosure
    // keeps it honest; beyond that (or a non-positive base) stays null.
    if (gapDays < 60 || gapDays > 200 || prev.value <= 0) {
      result.set(p.periodEnd, null);
      continue;
    }
    result.set(p.periodEnd, {
      pct: ((p.value - prev.value) / prev.value) * 100,
      basisPeriodEnd: prev.periodEnd,
      basisIsNonAdjacent: gapDays > 120,
    });
  }

  return result;
}
