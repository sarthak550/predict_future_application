"use client";

/**
 * Founder feature (2026-08-07) — "the ability to change the stock or option
 * or future from enlarged chart view only... like if user clicks on the top
 * left where you see the asset name they can click there and search for any
 * other asset and open the chart view directly for them." This is the
 * TradingView-style anchored popover `chart-workbench.tsx` mounts when the
 * header title button is clicked (see that file's own doc for the click
 * site and the `onSymbolPick` prop it threads to each terminal).
 *
 * Same "fixed inset-0 backdrop + absolutely-positioned panel, `left`/`top`
 * anchor props, `anchorRight = left > 320` overflow flip" idiom
 * `indicator-settings-popover.tsx`/`chart-order-intent-popover.tsx` already
 * use throughout this program — a real click on the transparent backdrop
 * (never a real click inside the panel, which stops propagation) is what
 * closes it, so the caller doesn't need its own outside-click listener.
 *
 * Search source: `useSymbolSearch` (`use-symbol-search.ts`) — the SAME two
 * data sources the terminals already query (equity search endpoint + the 5
 * F&O indices), no new backend. Empty query shows the last-5 recents
 * (localStorage, shared across all 3 terminals) instead of a live search —
 * both lists share ONE flat index (`indices` first, then `stocks`, matching
 * render order) so ArrowUp/ArrowDown/Enter/mouse-hover all agree on which
 * row is "highlighted" regardless of which branch is showing.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { loadRecentSymbolPicks, saveRecentSymbolPick, useSymbolSearch, type SymbolPick, type SymbolSearchKind } from "./use-symbol-search";

interface FlatEntry {
  kind: SymbolSearchKind;
  symbol: string;
  label: string;
  badge: string;
}

export function SymbolSearchPopover({
  left,
  top,
  onPick,
  onClose
}: {
  left: number;
  top: number;
  onPick: (pick: SymbolPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [recents] = useState<SymbolPick[]>(() => loadRecentSymbolPicks());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();
  const showingRecents = trimmed.length === 0;
  const { indexResults, stockResults, fnoSymbols, loading } = useSymbolSearch(query);

  const flatResults: FlatEntry[] = showingRecents
    ? recents.map((r) => ({ kind: r.kind, symbol: r.symbol, label: r.label, badge: r.kind === "index" ? "Index" : "Stock" }))
    : [
        ...indexResults.map((r) => ({ kind: "index" as const, symbol: r.symbol, label: r.label, badge: "Index" })),
        ...stockResults.map((r) => ({ kind: "equity" as const, symbol: r.symbol, label: r.label, badge: fnoSymbols.has(r.symbol) ? "F&O" : "Stock" }))
      ];
  const clampedHighlight = Math.min(highlightIdx, Math.max(0, flatResults.length - 1));

  function pick(entry: SymbolPick) {
    saveRecentSymbolPick(entry);
    onPick(entry);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, Math.max(0, flatResults.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = flatResults[clampedHighlight];
      if (entry) pick(entry);
    }
  }

  const anchorRight = left > 320;

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div
        className="absolute z-30 flex w-80 flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg"
        style={{ left: anchorRight ? undefined : left, right: anchorRight ? `calc(100vw - ${left}px)` : undefined, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search stock or index…"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
          />
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Close" aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {showingRecents ? (
            recents.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-ink-400">Search a stock or index to switch this chart.</p>
            ) : (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Recent</p>
                {recents.map((r, i) => (
                  <ResultRow
                    key={`recent-${r.kind}-${r.symbol}`}
                    symbol={r.symbol}
                    label={r.label}
                    badge={r.kind === "index" ? "Index" : "Stock"}
                    highlighted={i === clampedHighlight}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onClick={() => pick({ kind: r.kind, symbol: r.symbol, label: r.label })}
                  />
                ))}
              </>
            )
          ) : (
            <>
              {loading && flatResults.length === 0 && <p className="px-3 py-4 text-center text-xs text-ink-400">Searching…</p>}
              {!loading && flatResults.length === 0 && <p className="px-3 py-4 text-center text-xs text-ink-400">No matches.</p>}
              {indexResults.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Indices</p>
                  {indexResults.map((r, i) => (
                    <ResultRow
                      key={`index-${r.symbol}`}
                      symbol={r.symbol}
                      label={r.label}
                      badge="Index"
                      highlighted={i === clampedHighlight}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onClick={() => pick({ kind: "index", symbol: r.symbol, label: r.label })}
                    />
                  ))}
                </>
              )}
              {stockResults.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Stocks</p>
                  {stockResults.map((r, i) => (
                    <ResultRow
                      key={`stock-${r.symbol}`}
                      symbol={r.symbol}
                      label={r.label}
                      badge={fnoSymbols.has(r.symbol) ? "F&O" : "Stock"}
                      highlighted={indexResults.length + i === clampedHighlight}
                      onMouseEnter={() => setHighlightIdx(indexResults.length + i)}
                      onClick={() => pick({ kind: "equity", symbol: r.symbol, label: r.label })}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  symbol,
  label,
  badge,
  highlighted,
  onClick,
  onMouseEnter
}: {
  symbol: string;
  label: string;
  badge: string;
  highlighted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${highlighted ? "bg-signal-sky/10" : "hover:bg-ink-50"}`}
    >
      <span className="min-w-0 truncate">
        <span className="font-medium text-ink-900">{symbol}</span> <span className="text-ink-400">{label}</span>
      </span>
      <span className="shrink-0 rounded-md bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{badge}</span>
    </button>
  );
}
