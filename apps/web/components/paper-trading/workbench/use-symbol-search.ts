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

export type SymbolSearchKind = "equity" | "index";

export interface SymbolSearchEntry {
  symbol: string;
  label: string;
}

/** The value a caller acts on once the user picks a row — carries just enough for the terminal-specific switch/navigate decision (see each terminal's own `handleWorkbenchSymbolPick`). */
export interface SymbolPick {
  kind: SymbolSearchKind;
  symbol: string;
  label: string;
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
          setStockResults(raw.slice(0, MAX_RESULTS_PER_GROUP).map((r) => ({ symbol: r.symbol, label: r.companyName })));
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

  const indexResults: SymbolSearchEntry[] =
    trimmed.length === 0
      ? []
      : INDEX_OPTION_UNDERLYINGS.filter((sym) => sym.includes(trimmed.toUpperCase()) || INDEX_DISPLAY_NAMES[sym].toUpperCase().includes(trimmed.toUpperCase()))
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((sym) => ({ symbol: sym, label: INDEX_DISPLAY_NAMES[sym] }));

  return { indexResults, stockResults, fnoSymbols, loading };
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
