"use client";

/**
 * Debounced symbol/company search for the Paper Trading New Trade form. Hits
 * GET /api/paper-trading/symbols/search?q= — structurally identical to Portfolios'
 * own components/portfolios/symbol-search-input.tsx, duplicated (not imported)
 * per the "separate domain" architectural decision: Paper Trading doesn't share
 * UI or route code with Portfolios, only the pure math package.
 *
 * Index Universe SPRINT B follow-up (2026-08-12b) — founder report: "indices
 * are still not searchable in paper trading," after Sprint B (2026-08-12)
 * only wired the MAXIMIZED WORKBENCH's own popover
 * (`workbench/symbol-search-popover.tsx`). This component is the OTHER
 * search surface — the docked/compact search rendered directly under the
 * equity terminal's chart (`paper-trading-dashboard.tsx`'s `chart` slot,
 * both the "search to start trading" empty state and the always-visible box
 * under an already-focused chart) — which the founder is at least as likely
 * to be typing into first, since it's visible without ever clicking
 * "maximize." It hit the equity/ETF-only `/symbols/search` route and had no
 * index awareness at all.
 *
 * New optional `includeIndices` prop (default off — the New Trade form's own
 * usage, which places a REAL Buy/Sell order, omits it and stays
 * byte-identical: an index pick has no order surface to route to there).
 * When on, ALSO merges in the two static index universes via
 * `matchIndexEntries` (`workbench/use-symbol-search.ts`, extracted from that
 * hook's own inline computation specifically so this component doesn't hand-
 * duplicate the registry-matching logic — see that extraction's own doc). No
 * new backend: matching is pure client-side filtering over two small static
 * arrays, same as the workbench popover already does; the equity route/
 * `close`-price fetch below is completely untouched.
 *
 * An index row's pick funnels through the new `onSelectIndex` callback
 * (never `onSelect`, whose `PaperSymbolOption` shape has no room for
 * `kind`/`tradable` and whose ONLY caller, the New Trade form, must never
 * receive one) — the caller decides what "picking an index in the docked
 * search" means (see `paper-trading-dashboard.tsx`'s `handleDockedIndexPick`
 * for the equity terminal's own answer: the compact chart slot has no index-
 * chart home of its own — `focusedIndexSymbol`'s doc — so a view-only pick
 * opens the maximized workbench on it instead of trying to fake an in-place
 * switch).
 */
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { matchIndexEntries, type SymbolPick } from "@/components/paper-trading/workbench/use-symbol-search";

export interface PaperSymbolOption {
  symbol: string;
  companyName: string;
  close: number;
}

const DEBOUNCE_MS = 300;

export function PaperTradingSymbolSearchInput({
  value,
  onSelect,
  onSelectIndex,
  includeIndices,
  disabled
}: {
  value: string;
  onSelect: (option: PaperSymbolOption) => void;
  /** Required when `includeIndices` is true — see this file's own module doc. Ignored otherwise. */
  onSelectIndex?: (pick: SymbolPick) => void;
  /** Default off — see this file's own module doc for why the New Trade form must never turn this on. */
  includeIndices?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<PaperSymbolOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetch(`/api/paper-trading/symbols/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setResults(data?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Index Universe SPRINT B follow-up (2026-08-12b) — pure client-side, not
  // debounced (cheap filtering over two small static arrays, no fetch — same
  // as `use-symbol-search.ts`'s own inline computation), so it's always in
  // sync with the live `query` even while `results` is still mid-debounce.
  // Omitted entirely (both arrays stay empty) when `includeIndices` isn't
  // set — the New Trade form's usage never computes or renders these.
  const trimmedQuery = query.trim();
  const { tradableIndexMatches, viewOnlyIndexMatches } = includeIndices
    ? matchIndexEntries(trimmedQuery)
    : { tradableIndexMatches: [], viewOnlyIndexMatches: [] };
  const indexMatches = [...tradableIndexMatches, ...viewOnlyIndexMatches];

  function pickIndex(pick: SymbolPick) {
    onSelectIndex?.(pick);
    setQuery(pick.symbol);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={includeIndices ? "Search symbol, company, or index…" : "Search symbol or company…"}
        disabled={disabled}
        autoComplete="off"
      />
      {open && trimmedQuery.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-ink-200 bg-white shadow-lg">
          {loading && results.length === 0 && indexMatches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-400">Searching…</p>
          ) : results.length === 0 && indexMatches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-400">No matches.</p>
          ) : (
            <>
              {indexMatches.map((entry) => (
                <button
                  key={`index-${entry.symbol}`}
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    pickIndex({ kind: "index", symbol: entry.symbol, label: entry.label, tradable: entry.tradable })
                  }
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink-900">{entry.symbol}</span>{" "}
                    <span className="text-ink-400">{entry.label}</span>
                  </span>
                  <span className="shrink-0 rounded-md bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                    {entry.tradable ? "Index" : "Index · view only"}
                  </span>
                </button>
              ))}
              {results.map((r) => (
                <button
                  key={r.symbol}
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(r);
                    setQuery(r.symbol);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink-900">{r.symbol}</span>{" "}
                    <span className="text-ink-400">{r.companyName}</span>
                  </span>
                  <span className="shrink-0 text-ink-500">₹{r.close.toLocaleString("en-IN")}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
