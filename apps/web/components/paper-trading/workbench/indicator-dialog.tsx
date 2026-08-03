"use client";

/**
 * TA Suite Sprint S2, T1 — the indicator library modal, replacing
 * `indicator-picker.tsx`'s hardcoded 6-chip picker as the primary
 * add-indicator entry point. Search box + category tabs (Trend / Bands /
 * Momentum / Volatility / Volume / Custom) + rows showing name, a Main/Sub
 * badge, and a one-line plain-English description sourced from
 * `indicator-registry.ts` (product-gap addition per the brief: a retail
 * user picking "MFI" or "CMF" off a bare acronym list has no idea what they
 * do).
 *
 * Clicking a row ADDS a new instance with default params (never toggles —
 * see `indicator-registry.ts`'s multi-instance model doc) — repeat clicks
 * on the SAME row add multiple independent instances (the MA(9)+MA(21)
 * product-gap fix), each getting its own row in the active-indicator strip.
 * The dialog itself has no "already added" de-duplication logic for this
 * reason; the only cap enforced here is D4's sub-pane instance ceiling
 * (`subCount >= MAX_SUB_PANE_INSTANCES` disables every SUB-pane row, with
 * an explanatory title — the same "disabled toggle, not silent eviction"
 * posture `indicator-picker.tsx` already established for its 2-sub-pane
 * cap, carried forward at the new cap of 4).
 */
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import {
  INDICATOR_CATEGORIES,
  INDICATOR_REGISTRY,
  isIndicatorAllowed,
  MAX_SUB_PANE_INSTANCES,
  type IndicatorCategory
} from "./indicator-registry";

export function IndicatorDialog({
  mode,
  interval,
  subCount,
  onAdd,
  onClose
}: {
  mode: "spot" | "premium";
  interval: string;
  /** Current count of active SUB-pane instances (across all names) — the instance-count cap check, per the CEO brief's explicit "not a name-count check" correction. */
  subCount: number;
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IndicatorCategory>("Trend");
  const trimmed = query.trim().toLowerCase();
  const subCapReached = subCount >= MAX_SUB_PANE_INSTANCES;

  const allRows = useMemo(() => Object.values(INDICATOR_REGISTRY), []);

  const visibleRows = useMemo(() => {
    const base = trimmed.length > 0 ? allRows.filter((m) => m.name.toLowerCase().includes(trimmed) || (m.displayLabel ?? "").toLowerCase().includes(trimmed) || m.description.toLowerCase().includes(trimmed)) : allRows.filter((m) => m.category === category);
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows, trimmed, category]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-ink-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
          <p className="text-sm font-semibold text-ink-900">Indicators</p>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Close" aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-ink-100 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search indicators…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
          />
        </div>

        {trimmed.length === 0 && (
          <div className="flex flex-wrap gap-1 border-b border-ink-100 px-3 py-2">
            {INDICATOR_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === cat ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {visibleRows.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-400">No indicators match “{query}”.</p>}
          {visibleRows.map((meta) => {
            const allowed = isIndicatorAllowed(meta.name, { mode, interval });
            const capBlocked = meta.pane === "sub" && subCapReached;
            const disabled = !allowed || capBlocked;
            const title = !allowed
              ? mode === "premium" && meta.premiumDisabled
                ? "Not available for option premium data (no real traded volume)"
                : "Not available on this timeframe"
              : capBlocked
                ? `Remove a sub-pane indicator first (max ${MAX_SUB_PANE_INSTANCES} at once)`
                : undefined;
            return (
              <button
                key={meta.displayLabel ?? meta.name}
                type="button"
                disabled={disabled}
                title={title}
                onClick={() => !disabled && onAdd(meta.name)}
                className="flex w-full items-start gap-2 border-b border-ink-50 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-ink-800">{meta.displayLabel ?? meta.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        meta.pane === "main" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {meta.pane}
                    </span>
                    {meta.isCustom && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Custom</span>}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-ink-500">{meta.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
