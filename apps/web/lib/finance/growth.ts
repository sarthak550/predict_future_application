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
