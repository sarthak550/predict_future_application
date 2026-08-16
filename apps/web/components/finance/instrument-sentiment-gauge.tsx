import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { InstrumentSentiment } from "@/lib/finance/instrument";

/**
 * Instrument-scoped analyst sentiment mini-gauge for /instruments/[symbol].
 *
 * Deliberately NOT a reuse of components/finance/sentiment-gauge.tsx: that
 * component hardcodes "last 7 days" copy (matching its market-wide/opinion-
 * filter callers, both genuinely 7-day windows) — this page's sentiment is
 * computed over InstrumentDetail.sentiment.lookbackDays (90d, matching the
 * apps/api instrument-detail route), so reusing it verbatim would show
 * inaccurate copy. Same visual language (3-segment bar + legend), sized down
 * for its place inside the instrument-detail layout rather than as a
 * standalone card section.
 *
 * `exploreHref` (2026-08-09 date-range feature): optional link into
 * /opinions' interactive date-range control, pre-scoped to this instrument
 * when the page could resolve one (see instrumentLink.ts's
 * resolveCanonicalNameForSymbol) — falls back to the unscoped /opinions link
 * when it couldn't (e.g. an index or a symbol InstrumentAlias hasn't resolved
 * yet), never a dead link.
 */
export function InstrumentSentimentGauge({
  sentiment,
  exploreHref,
}: {
  sentiment: InstrumentSentiment;
  exploreHref?: string;
}) {
  const { bullish, bearish, neutral, totalCount, lookbackDays } = sentiment;

  if (totalCount === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 p-5 text-sm text-ink-500">
          <p>No analyst calls on this stock in the last {lookbackDays} days yet.</p>
          {exploreHref && <ExploreByDateRangeLink href={exploreHref} />}
        </CardContent>
      </Card>
    );
  }

  const bullishPercent = Math.round((bullish / totalCount) * 100);
  const bearishPercent = Math.round((bearish / totalCount) * 100);
  const neutralPercent = Math.max(0, 100 - bullishPercent - bearishPercent);

  const lean =
    bullishPercent > bearishPercent && bullishPercent > neutralPercent
      ? "Analysts lean bullish"
      : bearishPercent > bullishPercent && bearishPercent > neutralPercent
        ? "Analysts lean bearish"
        : "Analysts are split";

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Analyst sentiment</p>
            <p className="mt-1 text-base font-semibold text-ink-900">{lean}</p>
          </div>
          <p className="text-xs text-ink-400">
            {totalCount} analyst stance{totalCount === 1 ? "" : "s"} · last {lookbackDays} days · one per analyst
          </p>
        </div>

        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
          {bullishPercent > 0 && <div className="h-full bg-emerald-500" style={{ width: `${bullishPercent}%` }} />}
          {neutralPercent > 0 && <div className="h-full bg-ink-300" style={{ width: `${neutralPercent}%` }} />}
          {bearishPercent > 0 && <div className="h-full bg-rose-500" style={{ width: `${bearishPercent}%` }} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Bullish {bullishPercent}% ({bullish})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-ink-300" />
              Neutral {neutralPercent}% ({neutral})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Bearish {bearishPercent}% ({bearish})
            </span>
          </div>
          {exploreHref && <ExploreByDateRangeLink href={exploreHref} />}
        </div>
      </CardContent>
    </Card>
  );
}

function ExploreByDateRangeLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs font-medium text-signal-sky hover:underline">
      Explore by date range →
    </Link>
  );
}
