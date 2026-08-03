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
 *
 * **Founder-feedback pass — the Custom section.** A THIRD collapsible
 * section, "custom strategy… a '+' button for user to build and customise
 * the parameters and allowing to name these strategies — e.g. see what
 * RSI(20) or Momentum(15) signals." `customRows` is pre-computed by
 * `chart-workbench.tsx` (same "compute in the parent" split as `detail`/
 * `rating` above) via `lib/ta/technicals.ts`'s `evaluateCustomSignal` — this
 * component stays purely presentational for the Custom section too, it only
 * owns the builder popover's transient open/closed UI state (never the
 * persisted `CustomSignalItem[]` array itself, which `chart-workbench.tsx`
 * owns and localStorage-persists, same split `indicator-active-strip.tsx`'s
 * "+"/gear buttons use for `IndicatorDialog`/`IndicatorSettingsPopover`).
 * The section's own tally is computed HERE, from `customRows` alone — it
 * deliberately never reads `rating` or feeds into it: custom signals are
 * purely informational, the rating dial stays pure standard-methodology (a
 * muted note under the section header says so explicitly, so this isn't
 * left to be discovered the hard way).
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";

import type { DetailRow, TechnicalDetail, TechnicalRating, Vote } from "@/lib/ta/technicals";
import { SignalReasonTrigger } from "./signal-reason-trigger";
import type { CustomSignalItem } from "./custom-signal-builder";

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

/** A custom row reuses `DetailRowLine`'s exact value/badge/`SignalReasonTrigger` markup, but the LEFT side shows the user's own instance name (never the bare rule label — `row.label`/`row.id` are rule-family-scoped, see `evaluateCustomSignal`'s own doc), and the right side gets two extra controls: edit (reopens the builder, pre-filled) and remove. `row` can be `undefined` for one render tick right after a rule swap in the builder before this component's parent recomputes its memo — rendered as a muted "—", never a crash. */
function CustomRowLine({
  item,
  row,
  onEdit,
  onRemove
}: {
  item: CustomSignalItem;
  row: DetailRow | undefined;
  onEdit: (item: CustomSignalItem, anchor: { left: number; top: number }) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-50 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-xs text-ink-600">{item.name}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {!row ? (
          <span className="text-[10px] italic text-ink-300">—</span>
        ) : row.skipped ? (
          <span className="text-[10px] italic text-ink-300">needs {row.minBars} bars</span>
        ) : (
          <>
            <span className="tabular-nums text-[11px] text-ink-500">{row.value}</span>
            <SignalReasonTrigger reason={row.reason}>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${SIGNAL_BADGE_CLASS[row.signal]}`}>
                {SIGNAL_LABEL[row.signal]}
              </span>
            </SignalReasonTrigger>
          </>
        )}
        <button
          type="button"
          title="Edit"
          aria-label={`Edit ${item.name}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onEdit(item, { left: rect.left, top: rect.bottom + 4 });
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Remove"
          aria-label={`Remove ${item.name}`}
          onClick={() => onRemove(item.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-rose-100 hover:text-rose-600"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The THIRD section — see module doc. Its own tally is derived from `rows` ALONE (never `rating`), by construction incapable of feeding the gauge above. */
function CustomSection({
  items,
  rows,
  onAdd,
  onEdit,
  onRemove
}: {
  items: CustomSignalItem[];
  rows: ReadonlyMap<string, DetailRow | undefined>;
  onAdd: (anchor: { left: number; top: number }) => void;
  onEdit: (item: CustomSignalItem, anchor: { left: number; top: number }) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tally = { buy: 0, sell: 0, neutral: 0 };
  for (const item of items) {
    const row = rows.get(item.id);
    if (!row || row.skipped) continue;
    tally[row.signal] += 1;
  }

  return (
    <div className="rounded-xl border border-ink-100">
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-ink-700"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          Custom
        </button>
        <span className="shrink-0 tabular-nums text-[10px] text-ink-400">
          {items.length > 0 ? `${tally.buy} Buy · ${tally.sell} Sell · ${tally.neutral} Neutral` : "No custom signals"}
        </span>
        <button
          type="button"
          title="Add custom signal"
          aria-label="Add custom signal"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onAdd({ left: rect.left, top: rect.bottom + 4 });
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-sky-100 hover:text-sky-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="border-t border-ink-100 px-3 py-1">
          <p className="py-1.5 text-[10px] italic text-ink-400">Custom signals don&apos;t affect the rating above.</p>
          {items.length === 0 ? (
            <p className="pb-1.5 text-xs text-ink-400">No custom signals yet — tap + above to build one, e.g. RSI(20) or Momentum(15).</p>
          ) : (
            items.map((item) => <CustomRowLine key={item.id} item={item} row={rows.get(item.id)} onEdit={onEdit} onRemove={onRemove} />)
          )}
        </div>
      )}
    </div>
  );
}

export function SignalsTable({
  detail,
  rating,
  customItems,
  customRows,
  onAddCustomSignal,
  onEditCustomSignal,
  onRemoveCustomSignal
}: {
  detail: TechnicalDetail;
  rating: TechnicalRating;
  /** The user's persisted custom signal instances — owned/localStorage-persisted by `chart-workbench.tsx`, see `custom-signal-builder.tsx`'s own doc. */
  customItems: CustomSignalItem[];
  /** `item.id -> DetailRow`, pre-computed by the parent (`evaluateCustomSignal` per item) over the SAME candles `detail`/`rating` were computed from — same "compute in the parent, render in the child" split as those two props. */
  customRows: ReadonlyMap<string, DetailRow | undefined>;
  onAddCustomSignal: (anchor: { left: number; top: number }) => void;
  onEditCustomSignal: (item: CustomSignalItem, anchor: { left: number; top: number }) => void;
  onRemoveCustomSignal: (id: string) => void;
}) {
  if (detail.computedAtIndex < 0) return null; // no candles loaded yet — nothing honest to show.

  return (
    <div className="mb-3 space-y-2">
      <Section title="Moving Averages" rows={detail.ma} tally={rating.ma} />
      <Section title="Oscillators" rows={detail.oscillators} tally={rating.oscillators} />
      <CustomSection items={customItems} rows={customRows} onAdd={onAddCustomSignal} onEdit={onEditCustomSignal} onRemove={onRemoveCustomSignal} />
    </div>
  );
}
