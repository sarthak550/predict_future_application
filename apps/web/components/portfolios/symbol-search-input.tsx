"use client";

/**
 * Debounced symbol/company search for the manage panel's add-transaction form.
 * Hits GET /api/portfolios/symbols/search?q= (owner-authenticated route — see
 * apps/web/app/api/portfolios/symbols/search/route.ts), which is scoped to
 * StockEodQuote's latest session (the exact tradeable universe for portfolios).
 */
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

export interface SymbolOption {
  symbol: string;
  companyName: string;
  close: number;
}

const DEBOUNCE_MS = 300;

export function SymbolSearchInput({
  value,
  onSelect,
  disabled
}: {
  /** Controlled display value — lets the parent reset the field after a successful submit. */
  value: string;
  onSelect: (option: SymbolOption) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SymbolOption[]>([]);
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
      fetch(`/api/portfolios/symbols/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setResults(data?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search symbol or company…"
        disabled={disabled}
        autoComplete="off"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-ink-200 bg-white shadow-lg">
          {loading ? (
            <p className="px-4 py-3 text-sm text-ink-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-400">No matches.</p>
          ) : (
            results.map((r) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
