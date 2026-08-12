"use client";

/**
 * Founder feature (2026-08-07) — "the ability to change the stock or option
 * or future from enlarged chart view only... click there and search for any
 * other asset." This hook is the SEARCH SOURCE half of that feature, built
 * to the brief's explicit "no new backend" constraint: it reuses the exact
 * two data sources the terminals already query, rather than inventing a
 * third.
 *
 * Stocks: `GET /api/paper-trading/symbols/search?q=` — the SAME endpoint
 * `symbol-search-input.tsx` (the equity dashboard's New Trade form) already
 * hits, backed by `StockEodQuote`'s latest session (see that route's own
 * doc for why it can't reuse apps/api's `fetchEquityNames()` directly). A
 * symbol returned here is, by construction, the exact tradeable universe —
 * the same guarantee the New Trade form already relies on.
 *
 * Indices: the 5 F&O underlyings (`INDEX_OPTION_UNDERLYINGS`, shared with
 * `option-chain-browser.tsx`'s own Index-mode search), filtered
 * client-side — there is no server endpoint for "search 5 static strings."
 * `INDEX_DISPLAY_NAMES` below is a deliberate small duplication of that same
 * file's own map (5 static labels; not worth exporting an internal symbol
 * across files for — the exact "separate domain" judgment call
 * `symbol-search-input.tsx`'s own doc already makes for Portfolios vs.
 * Paper Trading).
 *
 * Index Universe SPRINT B (2026-08-12), founder: "even though the Indices
 * are not tradable we should be able to get their charts... user can search
 * indices in Paper Trading." Widens `indexResults` with every Yahoo-verified
 * VIEW-ONLY index from `INDEX_UNIVERSE` (NSE, 35) + `BSE_INDEX_UNIVERSE`
 * (BSE, 18) — the same two registries the candles/quote/intraday routes
 * already resolve against (see `apps/api`'s index candles route, widened
 * alongside this file). Each entry now carries `tradable` so a consuming
 * popover can render a visually distinct "view only" badge and so
 * `SymbolPick.tradable` lets the receiving terminal decide in-place-chart
 * vs. navigate-to-futures — a view-only pick's `target` is NEVER set to
 * `"optionChain"`/`"futures"` (there is no such surface for these), only
 * ever `"chart"` or `undefined` (both resolve to the same in-place chart
 * switch on the equity terminal, its only currently-reachable consumer;
 * F&O terminals are gated coming-soon and don't mount this popover's own
 * navigation logic for this case). Deliberately excludes the DB-only "long
 * tail" indices (no live Yahoo intraday feed, daily-only) — those stay
 * off search entirely rather than offering a chart that would either fake
 * intraday granularity or need a second, degraded code path here; see the
 * SPRINT B report for the full reasoning.
 *
 * F&O badge: reuses `fetchFnoUniverseClient()` (already cached client-side,
 * same in-flight-dedupe module `option-chain-browser.tsx`'s Stock-mode
 * combobox depends on) to badge a stock result "F&O" instead of plain
 * "Stock" when it's also an options-eligible underlying — a nice-to-have,
 * not required by the search itself, so a slow/failed fetch degrades to
 * every stock badged plain "Stock," never a broken result list.
 *
 * Deliberately returns raw `SymbolSearchEntry[]` (not pre-flagged with
 * `isFno`) — the F&O set resolves asynchronously and independently of the
 * debounced text search, and baking the flag in at fetch-time would bake in
 * a STALE flag if the F&O universe hadn't resolved yet when a search
 * response landed. The popover reads `fnoSymbols.has(symbol)` at RENDER
 * time instead, so the badge is always current relative to whichever data
 * has resolved so far.
 */
import { useEffect, useRef, useState } from "react";

import { INDEX_OPTION_UNDERLYINGS } from "@predict-future/business-rules/papertrading/optionContract";
import { INDEX_UNIVERSE } from "@predict-future/business-rules/finance/indexUniverse";
import { BSE_INDEX_UNIVERSE } from "@predict-future/business-rules/finance/bseIndexUniverse";

import { fetchFnoUniverseClient } from "@/lib/paperTrading/fnoUniverseClient";

const DEBOUNCE_MS = 250;
const MAX_RESULTS_PER_GROUP = 8;
const RECENTS_KEY = "pf.workbench.symbolSearch.recents";
const MAX_RECENTS = 5;

/** Mirrors option-chain-browser.tsx's own INDEX_DISPLAY_NAMES — see module doc on why this is a deliberate duplication, not a shared export. */
const INDEX_DISPLAY_NAMES: Record<string, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Nifty Bank",
  FINNIFTY: "Nifty Financial Services",
  MIDCPNIFTY: "Nifty Midcap Select",
  NIFTYNXT50: "Nifty Next 50"
};

/**
 * Index Universe SPRINT B (2026-08-12) — every view-only index searchable
 * from this popover: NSE's `INDEX_UNIVERSE` (35) + BSE's
 * `BSE_INDEX_UNIVERSE` (18), computed once at module load (both source
 * arrays are static/readonly — see each registry's own module doc for the
 * Yahoo-verification bar every entry already cleared). `symbol` is the
 * `/instruments/[symbol]` code (also what the candles/quote/intraday routes
 * key on); `label` is the hand-written display name.
 */
const VIEW_ONLY_INDEX_ENTRIES: SymbolSearchEntry[] = [
  ...INDEX_UNIVERSE.map((e) => ({ symbol: e.symbol, label: e.displayName, tradable: false as const })),
  ...BSE_INDEX_UNIVERSE.map((e) => ({ symbol: e.symbol, label: e.displayName, tradable: false as const }))
];

export type SymbolSearchKind = "equity" | "index";

export interface SymbolSearchEntry {
  symbol: string;
  label: string;
  /**
   * Only meaningful for `kind: "index"` results — `true` for the 5 F&O
   * underlyings (options/futures tradable), `false` for a view-only
   * `INDEX_UNIVERSE`/`BSE_INDEX_UNIVERSE` index (chart-only, no order
   * surface exists). Always `true` for an equity result (every searchable
   * stock is, by construction, tradable on the equity ticket) — see
   * `optionChainBrowser`'s parallel F&O badge for the closest equity
   * analogue, though that one is a separate "also F&O-eligible" concept.
   */
  tradable: boolean;
}

/**
 * The value a caller acts on once the user picks a row — carries just enough
 * for the terminal-specific switch/navigate decision (see each terminal's
 * own `handleWorkbenchSymbolPick`).
 *
 * Founder bug fix (2026-08-07b) — "going from options to stock via search
 * bar is not possible, and there is no way if I have stock open then I can
 * search option chain." `target`, set ONLY by an explicit action-chip click
 * in `symbol-search-popover.tsx` (never by the row's own primary click,
 * which stays `undefined` and keeps every terminal's pre-existing
 * kind-based in-place-vs-navigate behavior exactly as before), tells the
 * receiving terminal's `handleWorkbenchSymbolPick` to skip that inference
 * entirely and navigate to the EXPLICIT destination the user asked for —
 * see symbol-search-popover.tsx's own doc for which chips a row gets and
 * why.
 */
export interface SymbolPick {
  kind: SymbolSearchKind;
  symbol: string;
  label: string;
  /** "chart" = the symbol's own dedicated chart surface (equity dashboard for a stock; the futures terminal's underlying chart for a tradable index — there is no separate index-only chart page for those. A VIEW-ONLY index's chart is the equity terminal's own in-place workbench switch, same as "chart" resolves to for an equity). "optionChain" = the options terminal, chain loaded for this underlying. "futures" = the futures terminal, ready to trade. Undefined on a plain row click (today's in-place-where-possible behavior, unchanged). */
  target?: "chart" | "optionChain" | "futures";
  /** Index Universe SPRINT B (2026-08-12) — carried through from `SymbolSearchEntry.tradable` so the receiving terminal's `handleWorkbenchSymbolPick` can tell a tradable index pick (navigate to futures/options, unchanged) apart from a view-only one (switch the chart in place, order ticket disabled) without re-deriving it. Only meaningful for `kind: "index"`. */
  tradable?: boolean;
}

export function useSymbolSearch(query: string): {
  indexResults: SymbolSearchEntry[];
  stockResults: SymbolSearchEntry[];
  /** F&O-eligible stock symbols, for badging a stock result "F&O" instead of plain "Stock" — see module doc. Empty until fetchFnoUniverseClient's first resolution. */
  fnoSymbols: Set<string>;
  loading: boolean;
} {
  const [stockResults, setStockResults] = useState<SymbolSearchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fnoSymbols, setFnoSymbols] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchFnoUniverseClient().then((list) => {
      if (!cancelled) setFnoSymbols(new Set(list.map((e) => e.symbol)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length === 0) {
      setStockResults([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetch(`/api/paper-trading/symbols/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (requestId !== requestIdRef.current) return; // a later keystroke's request already superseded this one.
          const raw: { symbol: string; companyName: string }[] = Array.isArray(data?.results) ? data.results : [];
          setStockResults(raw.slice(0, MAX_RESULTS_PER_GROUP).map((r) => ({ symbol: r.symbol, label: r.companyName, tradable: true })));
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setStockResults([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmed]);

  // Index Universe SPRINT B (2026-08-12) — tradable underlyings still lead
  // (unchanged ranking/behavior for the 5 existing rows — B3 regression),
  // then view-only matches fill the remaining slots. See `matchIndexEntries`
  // below for the full reasoning (extracted 2026-08-12b so the paper-trading
  // dashboard's docked search can share the exact same matching logic — see
  // that extraction's own doc on `matchIndexEntries`).
  const { tradableIndexMatches, viewOnlyIndexMatches } = matchIndexEntries(trimmed);
  const indexResults: SymbolSearchEntry[] = [...tradableIndexMatches, ...viewOnlyIndexMatches].slice(0, MAX_RESULTS_PER_GROUP);

  return { indexResults, stockResults, fnoSymbols, loading };
}

/**
 * Index Universe SPRINT B follow-up (2026-08-12b) — extracted from this
 * hook's own inline computation (previously duplicated verbatim, unwired,
 * into `symbol-search-input.tsx`'s equity dashboard). Founder report: "the
 * maximized workbench's popover finds indices, but the docked/compact
 * search under the equity chart still doesn't" — that surface needed the
 * SAME tradable-then-view-only index matching this hook already does, and a
 * second hand-copy would silently drift the day either registry changes
 * (e.g. a BSE index added). A pure function, no hook state, so a
 * non-debounced caller (the docked search recomputes it on every keystroke,
 * same as this hook's own inline `useSymbolSearch` body already did — it's
 * cheap client-side filtering over two small static arrays, never a fetch)
 * can call it directly.
 *
 * Each group capped independently at MAX_RESULTS_PER_GROUP so a broad
 * view-only match (e.g. "nifty") can't crowd out the tradable five; the
 * CALLER is responsible for combining + re-capping the two groups (this
 * hook's own body above does `[...tradable, ...viewOnly].slice(0,
 * MAX_RESULTS_PER_GROUP)` — the docked search does the same).
 */
export function matchIndexEntries(trimmed: string): {
  tradableIndexMatches: SymbolSearchEntry[];
  viewOnlyIndexMatches: SymbolSearchEntry[];
} {
  if (trimmed.length === 0) return { tradableIndexMatches: [], viewOnlyIndexMatches: [] };
  const upperTrimmed = trimmed.toUpperCase();
  const tradableIndexMatches: SymbolSearchEntry[] = INDEX_OPTION_UNDERLYINGS.filter(
    (sym) => sym.includes(upperTrimmed) || INDEX_DISPLAY_NAMES[sym].toUpperCase().includes(upperTrimmed)
  )
    .slice(0, MAX_RESULTS_PER_GROUP)
    .map((sym) => ({ symbol: sym, label: INDEX_DISPLAY_NAMES[sym], tradable: true as const }));
  const viewOnlyIndexMatches: SymbolSearchEntry[] = VIEW_ONLY_INDEX_ENTRIES.filter(
    (e) => e.symbol.includes(upperTrimmed) || e.label.toUpperCase().includes(upperTrimmed)
  ).slice(0, MAX_RESULTS_PER_GROUP);
  return { tradableIndexMatches, viewOnlyIndexMatches };
}

/** Last-5 recent picks (localStorage), most-recent-first, shared across ALL terminals (one global MRU — a TradingView-style symbol search remembers recents regardless of which chart you searched from). Never throws — private-mode/storage-disabled callers just see an always-empty recents list. */
export function loadRecentSymbolPicks(): SymbolPick[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is SymbolPick => {
        if (!p || typeof p !== "object") return false;
        const candidate = p as Partial<SymbolPick>;
        return (candidate.kind === "equity" || candidate.kind === "index") && typeof candidate.symbol === "string" && typeof candidate.label === "string";
      })
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function saveRecentSymbolPick(pick: SymbolPick): void {
  try {
    const existing = loadRecentSymbolPicks().filter((p) => !(p.kind === pick.kind && p.symbol === pick.symbol));
    const next = [pick, ...existing].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Preference just won't survive the refresh.
  }
}
