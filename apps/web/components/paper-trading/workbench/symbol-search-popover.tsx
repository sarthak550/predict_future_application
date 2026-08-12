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
 *
 * **Founder bug fix (2026-08-07b) — per-row ACTION CHIPS.** Verbatim: "going
 * from options to stock via search bar is not possible, and there is no way
 * if I have stock open then I can search option chain." The row's PRIMARY
 * click (the symbol/label button) keeps every terminal's existing
 * in-place-where-possible behavior exactly as before (`pick.target` is
 * `undefined`) — the chips are a SEPARATE, explicit "go here" action
 * (`pick.target` set, see `use-symbol-search.ts`'s own doc), always
 * navigating regardless of which terminal the popover happens to be open
 * on. An F&O-eligible stock row gets `[Chart] [Option chain]`; a plain
 * (non-F&O) stock row gets `[Chart]` only (no chain exists to open); an
 * index row gets `[Options] [Futures]` — no separate index "Chart" chip: an
 * index has no chart surface of its own outside the futures terminal, and
 * both the Options and Futures chips already land on a maximized chart
 * there (`&workbench=`), so a third, identically-destined button would be
 * pure clutter, not a real third destination. (This is a deliberate,
 * documented trim of the brief's literal "[Chart][Options][Futures]"
 * 3-chip phrasing for indices — see the CTO final report.)
 *
 * `ResultRow` is a `<div>`, never a `<button>`, with the primary click
 * target and each chip as SIBLING `<button>`s inside it — this codebase has
 * a real prior bug from nesting an interactive element inside a `<button>`
 * (the tool-flyout close bug, DOM click bubbling reopened the menu it just
 * closed — see `project_ta_suite_founder_feedback_2026_08_03` memory), so a
 * chip button living INSIDE the row's own `<button>` is not just invalid
 * HTML here, it's a known bug shape. Being real `<button>`s also gives the
 * chips native Tab reachability for free, satisfying the "reachable but
 * don't over-engineer" keyboard bar without any custom focus management.
 *
 * Index Universe SPRINT B (2026-08-12) — a view-only index row (`entry.kind
 * === "index" && !entry.tradable`) gets the visually distinct badge "Index ·
 * view only" (never plain "Index," which the 5 tradable underlyings keep)
 * and a single `[Chart]` chip whose target is always `"chart"` — never
 * `"optionChain"`/`"futures"`, which don't exist for these. The primary row
 * click carries `tradable: false` through in its own `SymbolPick` too (see
 * `pick()` call sites below), so a receiving terminal never has to
 * re-derive it.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { loadRecentSymbolPicks, saveRecentSymbolPick, useSymbolSearch, type SymbolPick, type SymbolSearchKind } from "./use-symbol-search";

interface FlatEntry {
  kind: SymbolSearchKind;
  symbol: string;
  label: string;
  badge: string;
  /** Only meaningful for kind "equity" — drives whether the row gets an "Option chain" chip. Always false for an index row (indices get their own fixed chip set regardless of this flag — see `chipsFor`). */
  isFno: boolean;
  /** Only meaningful for kind "index" — see `SymbolSearchEntry.tradable`'s own doc. Ignored (always effectively true) for kind "equity". */
  tradable: boolean;
}

interface ActionChip {
  label: string;
  target: NonNullable<SymbolPick["target"]>;
}

/**
 * See this file's own module doc for why TRADABLE indices get 2 chips, not
 * the brief's literal 3. A VIEW-ONLY index (Index Universe SPRINT B,
 * 2026-08-12) gets exactly one `[Chart]` chip — there is no options chain or
 * futures ladder for these, so offering those chips would be a dead end.
 */
function chipsFor(entry: FlatEntry): ActionChip[] {
  if (entry.kind === "index") {
    if (!entry.tradable) return [{ label: "Chart", target: "chart" }];
    return [
      { label: "Options", target: "optionChain" },
      { label: "Futures", target: "futures" }
    ];
  }
  const chips: ActionChip[] = [{ label: "Chart", target: "chart" }];
  if (entry.isFno) chips.push({ label: "Option chain", target: "optionChain" });
  return chips;
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
    ? recents.map((r) => {
        // Index Universe SPRINT B (2026-08-12) — a recent saved before this
        // change never had `tradable` persisted; `!== false` defaults an
        // absent value to `true`, matching the only kind of index pick that
        // could have been saved before today (one of the 5 tradable
        // underlyings) — never misrenders an old recent as view-only.
        const indexTradable = r.tradable !== false;
        return {
          kind: r.kind,
          symbol: r.symbol,
          label: r.label,
          badge: r.kind === "index" ? (indexTradable ? "Index" : "Index · view only") : "Stock",
          isFno: r.kind === "equity" && fnoSymbols.has(r.symbol),
          tradable: r.kind === "index" ? indexTradable : true
        };
      })
    : [
        ...indexResults.map((r) => ({
          kind: "index" as const,
          symbol: r.symbol,
          label: r.label,
          badge: r.tradable ? "Index" : "Index · view only",
          isFno: false,
          tradable: r.tradable
        })),
        ...stockResults.map((r) => ({
          kind: "equity" as const,
          symbol: r.symbol,
          label: r.label,
          badge: fnoSymbols.has(r.symbol) ? "F&O" : "Stock",
          isFno: fnoSymbols.has(r.symbol),
          tradable: true
        }))
      ];
  const clampedHighlight = Math.min(highlightIdx, Math.max(0, flatResults.length - 1));

  /** Primary row click (today's behavior, `target` undefined) AND every action-chip click (explicit `target`) both funnel through here — a chip pick is just as much a "recent" as a plain pick. */
  function pick(entry: SymbolPick) {
    saveRecentSymbolPick({ kind: entry.kind, symbol: entry.symbol, label: entry.label, tradable: entry.tradable });
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
            flatResults.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-ink-400">Search a stock or index to switch this chart.</p>
            ) : (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Recent</p>
                {flatResults.map((entry, i) => (
                  <ResultRow
                    key={`recent-${entry.kind}-${entry.symbol}`}
                    entry={entry}
                    highlighted={i === clampedHighlight}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onClick={() => pick({ kind: entry.kind, symbol: entry.symbol, label: entry.label, tradable: entry.tradable })}
                    onNavigate={(target) => pick({ kind: entry.kind, symbol: entry.symbol, label: entry.label, target, tradable: entry.tradable })}
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
                  {flatResults.slice(0, indexResults.length).map((entry, i) => (
                    <ResultRow
                      key={`index-${entry.symbol}`}
                      entry={entry}
                      highlighted={i === clampedHighlight}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onClick={() => pick({ kind: "index", symbol: entry.symbol, label: entry.label, tradable: entry.tradable })}
                      onNavigate={(target) => pick({ kind: "index", symbol: entry.symbol, label: entry.label, target, tradable: entry.tradable })}
                    />
                  ))}
                </>
              )}
              {stockResults.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Stocks</p>
                  {flatResults.slice(indexResults.length).map((entry, i) => (
                    <ResultRow
                      key={`stock-${entry.symbol}`}
                      entry={entry}
                      highlighted={indexResults.length + i === clampedHighlight}
                      onMouseEnter={() => setHighlightIdx(indexResults.length + i)}
                      onClick={() => pick({ kind: "equity", symbol: entry.symbol, label: entry.label })}
                      onNavigate={(target) => pick({ kind: "equity", symbol: entry.symbol, label: entry.label, target })}
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

/**
 * A `<div>`, never a `<button>` — the primary label and every action chip
 * below are SIBLING `<button>`s inside it (see this file's own module doc
 * for why nesting a chip button inside a row button is a known bug shape
 * here, not just invalid HTML). `onMouseEnter` on the outer div keeps mouse
 * hover highlighting the whole row (including while hovering a chip),
 * matching the pre-chip behavior exactly.
 */
function ResultRow({
  entry,
  highlighted,
  onClick,
  onNavigate,
  onMouseEnter
}: {
  entry: FlatEntry;
  highlighted: boolean;
  /** Primary-click: today's per-terminal in-place-where-possible behavior, unchanged. */
  onClick: () => void;
  /** Chip click: explicit navigate, see use-symbol-search.ts's `SymbolPick.target` doc. */
  onNavigate: (target: NonNullable<SymbolPick["target"]>) => void;
  onMouseEnter: () => void;
}) {
  const chips = chipsFor(entry);
  return (
    <div
      onMouseEnter={onMouseEnter}
      className={`flex w-full flex-col gap-1 px-3 py-1.5 text-sm ${highlighted ? "bg-signal-sky/10" : "hover:bg-ink-50"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="min-w-0 flex-1 truncate text-left">
          <span className="font-medium text-ink-900">{entry.symbol}</span> <span className="text-ink-400">{entry.label}</span>
        </button>
        <span className="shrink-0 rounded-md bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{entry.badge}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.target}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onNavigate(chip.target)}
            className="rounded-full border border-ink-200 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500 hover:border-signal-sky/60 hover:bg-signal-sky/10 hover:text-signal-sky"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
