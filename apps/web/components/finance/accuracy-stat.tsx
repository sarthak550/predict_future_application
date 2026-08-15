/**
 * Trust Layer Sprint T2 — shared accuracy display logic (Decision 2 of
 * cto_assignment_brief_trust_layer_sprint.md), built once and applied at every surface
 * that renders an analyst hit-rate percentage:
 *   - apps/web/app/analysts/page.tsx (leaderboard cards)
 *   - apps/web/app/analysts/[slug]/page.tsx (profile hero stat AND per-instrument sidebar)
 *   - apps/web/app/page.tsx (homepage "Top Analysts" card)
 *
 * Three tiers by resolvedCount (n):
 *   n < 3   ("provisional")  — untouched by this file. Callers already show "Building a
 *                              track record" / suppress the percentage entirely; nothing
 *                              here changes that.
 *   3 <= n < 10 ("low")      — percentage still renders, but de-emphasized (caller
 *                              supplies the muted className), plus a Badge
 *                              variant="warning" "Low sample" linking to
 *                              /methodology#sample-size (a Link, not a hover tooltip —
 *                              tooltips don't work on mobile touch and this sprint
 *                              requires desktop + mobile-web parity).
 *   n >= 10 ("normal")       — unchanged bold treatment, just gains the CI caption.
 *
 * All four call sites get "{n} graded calls · 95% CI {lower}-{upper}%" somewhere in
 * their existing secondary-text slot — this is additive to the "{n} graded calls"
 * caption already present on 3 of the 4 sites, not a new layout element.
 *
 * Deliberately does NOT touch computeCredibilityScore/computeScorecard or the
 * indexable-profile gate (T1's constraint) — LOW_SAMPLE_MAX_RESOLVED_CALLS below is a
 * pure display concept, not part of the credibility formula.
 */
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { computeWilsonInterval, PROVISIONAL_MIN_RESOLVED_CALLS } from "@predict-future/business-rules";
import { formatPercent } from "@/lib/utils";

/**
 * Upper boundary of the "low sample" display tier — a resolvedCount at or above this
 * gets the full-confidence bold treatment. Distinct from business-rules'
 * PROVISIONAL_MIN_RESOLVED_CALLS (3, below which no percentage renders at all) and
 * INDEXABLE_MIN_RESOLVED_CALLS (5, which gates search-engine indexing) — this is purely
 * about how prominently a real, already-shown number is displayed.
 */
export const LOW_SAMPLE_MAX_RESOLVED_CALLS = 10;

export type AccuracyTier = "provisional" | "low" | "normal";

export function getAccuracyTier(resolvedCount: number): AccuracyTier {
  if (resolvedCount < PROVISIONAL_MIN_RESOLVED_CALLS) return "provisional";
  if (resolvedCount < LOW_SAMPLE_MAX_RESOLVED_CALLS) return "low";
  return "normal";
}

/**
 * "95% CI {lower}-{upper}%", rounded to whole percentage points (matches formatPercent's
 * existing precision — no false precision like "29.7-90.4%" on a small sample). Returns
 * null when resolvedCount is 0 (nothing to compute a CI on).
 */
export function formatCiRange(hitCount: number, resolvedCount: number): string | null {
  const ci = computeWilsonInterval(hitCount, resolvedCount);
  if (!ci) return null;
  return `95% CI ${Math.round(ci.lower * 100)}–${Math.round(ci.upper * 100)}%`;
}

/** "{n} graded calls · 95% CI {lower}-{upper}%" — Decision 2's exact caption copy. */
export function formatAccuracyCaption(hitCount: number, resolvedCount: number): string {
  const gradedLabel = `${resolvedCount} graded call${resolvedCount === 1 ? "" : "s"}`;
  const ciRange = formatCiRange(hitCount, resolvedCount);
  return ciRange ? `${gradedLabel} · ${ciRange}` : gradedLabel;
}

/**
 * Just the percentage text node — a drop-in replacement for `formatPercent(hitRate)` at
 * any of the 4 accuracy surfaces. Callers keep their own wrapping element (p/div) and
 * font-size class; this only decides which of the two caller-supplied weight/color
 * classNames applies, based on the tier. Only ever called where resolvedCount >= 3
 * (callers handle the n<3 "no percentage" case themselves before reaching this).
 */
export function AccuracyPercent({
  hitCount,
  resolvedCount,
  normalClassName,
  mutedClassName,
}: {
  hitCount: number;
  resolvedCount: number;
  normalClassName: string;
  mutedClassName: string;
}) {
  const tier = getAccuracyTier(resolvedCount);
  const hitRate = resolvedCount > 0 ? hitCount / resolvedCount : 0;
  return <span className={tier === "low" ? mutedClassName : normalClassName}>{formatPercent(hitRate)}</span>;
}

/**
 * The "Low sample" badge alone — reuses Badge variant="warning" verbatim (same visual
 * language as sentiment-gauge.tsx's "Small sample" badge), wrapped in a Link to
 * /methodology#sample-size rather than a hover tooltip (mobile-web parity requirement).
 */
export function LowSampleBadge({ className }: { className?: string }) {
  return (
    <Link href="/methodology#sample-size" className={className}>
      <Badge variant="warning">Low sample</Badge>
    </Link>
  );
}

/**
 * Renders formatAccuracyCaption's text plus (tier === "low") the LowSampleBadge, as
 * inline children — deliberately NOT wrapped in its own block element, so callers can
 * drop it straight inside their existing caption <p> without an extra nested wrapper
 * (this sprint must not touch container/layout classes on the pages it edits).
 *
 * `badgeClassName` defaults to a plain inline badge; the leaderboard/homepage cards use
 * a "stretched link" pattern (CardContent has pointer-events-none, only specific opted-in
 * children re-enable it — see app/analysts/page.tsx's FirmLink for the precedent), so
 * those callers must pass `pointer-events-auto relative z-20` or the badge's Link will be
 * visually present but unclickable, sitting under the invisible full-card link.
 */
export function AccuracyCaption({
  hitCount,
  resolvedCount,
  badgeClassName = "inline-block align-middle",
}: {
  hitCount: number;
  resolvedCount: number;
  badgeClassName?: string;
}) {
  const tier = getAccuracyTier(resolvedCount);
  return (
    <>
      {formatAccuracyCaption(hitCount, resolvedCount)}
      {tier === "low" && (
        <>
          {" "}
          <LowSampleBadge className={badgeClassName} />
        </>
      )}
    </>
  );
}
