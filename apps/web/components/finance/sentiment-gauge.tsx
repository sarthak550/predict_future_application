import { Card, CardContent } from "@/components/ui/card";
import type { SentimentSplit } from "@/lib/finance/sentiment";

const LEAN_COPY: Record<SentimentSplit["dominantLean"], string> = {
  BULLISH: "Analysts lean bullish",
  BEARISH: "Analysts lean bearish",
  NEUTRAL: "Analysts lean neutral",
  MIXED: "Analysts are split",
};

/** Structural subset both SentimentSplit (7-day) and OpinionsSentimentSplit (all-time, filtered — lib/finance/opinionsQuery.ts) satisfy, so this component stays agnostic to which time-window semantics produced it. */
type SentimentGaugeSplit = Pick<
  SentimentSplit,
  "bullishCount" | "bearishCount" | "neutralCount" | "totalCount" | "bullishPercent" | "bearishPercent" | "neutralPercent" | "dominantLean"
>;

/**
 * Live sentiment split, rendered by whichever server component owns the data
 * fetch — market-wide/instrument-scoped 7-day (getSentimentSplit, homepage +
 * /opinions when no non-direction filter is active) or /opinions' own
 * filtered, all-time split (fetchOpinionsSentimentSplit) once a filter is
 * active. Pure presentational component: `title`, `metaLabel`, and
 * `emptyMessage` are caller-supplied overrides so the "last 7 days" framing
 * (true for the default split) doesn't leak into the filtered, all-time case
 * — each caller states its own basis rather than this component guessing it
 * from the data shape.
 */
export function SentimentGauge({
  split,
  title,
  metaLabel,
  emptyMessage,
}: {
  split: SentimentGaugeSplit & { scopedInstrument?: string | null };
  title?: string;
  metaLabel?: string;
  emptyMessage?: string;
}) {
  if (split.totalCount === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-ink-500">
          {emptyMessage ??
            `Not enough calls in the last 7 days${split.scopedInstrument ? ` on ${split.scopedInstrument}` : ""} to show a sentiment split yet.`}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
              {title ?? (split.scopedInstrument ? `Sentiment · ${split.scopedInstrument}` : "Market-wide sentiment")}
            </p>
            <p className="mt-1 text-lg font-semibold text-ink-900">{LEAN_COPY[split.dominantLean]}</p>
          </div>
          <p className="text-xs text-ink-400">
            {metaLabel ?? `${split.totalCount} call${split.totalCount === 1 ? "" : "s"} · last 7 days`}
          </p>
        </div>

        <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
          {split.bullishPercent > 0 && (
            <div className="h-full bg-emerald-500" style={{ width: `${split.bullishPercent}%` }} />
          )}
          {split.neutralPercent > 0 && (
            <div className="h-full bg-ink-300" style={{ width: `${split.neutralPercent}%` }} />
          )}
          {split.bearishPercent > 0 && (
            <div className="h-full bg-rose-500" style={{ width: `${split.bearishPercent}%` }} />
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Bullish {split.bullishPercent}% ({split.bullishCount})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink-300" />
            Neutral {split.neutralPercent}% ({split.neutralCount})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Bearish {split.bearishPercent}% ({split.bearishCount})
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
