"use client";

/**
 * Founder-feedback pass (2026-08-06) — TradingView's Technicals DETAIL view
 * ("runs all the indicators and generates signal based on all indicators…
 * help traders understand which indicator is telling what"), rendered under
 * the existing gauge (`technicals-gauge.tsx`). Purely presentational —
 * `detail`/`rating` are `lib/ta/technicals.ts`'s `computeTechnicalDetail`/
 * `computeTechnicalRating` outputs, both computed once by `chart-workbench.tsx`
 * over the SAME candle array + memo key, same "compute in the parent,
 * render in the child" split this program already uses throughout.
 *
 * Two collapsible sections (Moving Averages / Oscillators), each with its
 * own group tally in the header (reads `rating.ma`/`rating.oscillators`
 * directly — by construction always equal to a tally of this component's
 * own rows, since both come from the SAME rule table's `evaluate()` calls;
 * see `technicals.ts`'s module doc and `selfcheck.ts`'s
 * `checkTechnicalDetailConsistency`). Each evaluated row's signal badge is
 * the `SignalReasonTrigger` hover/tap trigger (founder: "the purpose of
 * paper trading is learning as well") — a skipped row (not enough bars
 * loaded yet) renders its own honest "needs N bars" text instead, never a
 * badge.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { DetailRow, TechnicalDetail, TechnicalRating, Vote } from "@/lib/ta/technicals";
import { SignalReasonTrigger } from "./signal-reason-trigger";

const SIGNAL_BADGE_CLASS: Record<Vote, string> = {
  buy: "bg-emerald-50 text-emerald-700",
  sell: "bg-rose-50 text-rose-700",
  neutral: "bg-ink-100 text-ink-500"
};
const SIGNAL_LABEL: Record<Vote, string> = { buy: "Buy", sell: "Sell", neutral: "Neutral" };

function DetailRowLine({ row }: { row: DetailRow }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-50 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-xs text-ink-600">{row.label}</span>
      {row.skipped ? (
        <span className="shrink-0 text-[10px] italic text-ink-300">needs {row.minBars} bars</span>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-[11px] text-ink-500">{row.value}</span>
          <SignalReasonTrigger reason={row.reason}>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${SIGNAL_BADGE_CLASS[row.signal]}`}>
              {SIGNAL_LABEL[row.signal]}
            </span>
          </SignalReasonTrigger>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  tally
}: {
  title: string;
  rows: DetailRow[];
  tally: { buy: number; sell: number; neutral: number };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-ink-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {title}
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-ink-400">
          {tally.buy} Buy · {tally.sell} Sell · {tally.neutral} Neutral
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-100 px-3 py-1">
          {rows.map((row) => (
            <DetailRowLine key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SignalsTable({ detail, rating }: { detail: TechnicalDetail; rating: TechnicalRating }) {
  if (detail.computedAtIndex < 0) return null; // no candles loaded yet — nothing honest to show.

  return (
    <div className="mb-3 space-y-2">
      <Section title="Moving Averages" rows={detail.ma} tally={rating.ma} />
      <Section title="Oscillators" rows={detail.oscillators} tally={rating.oscillators} />
    </div>
  );
}
