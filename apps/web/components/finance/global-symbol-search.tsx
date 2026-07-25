"use client";

/**
 * Nav-bar global instrument search: type a stock or index name anywhere on
 * the site → jump straight to its /instruments/[symbol] page (price history,
 * analyst opinions, news, filings) without detouring through Market Pulse or
 * Paper Trading. Debounced against /api/instruments/search; keyboard: Enter
 * opens the top result, Escape closes.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface SearchResult {
  symbol: string;
  companyName: string;
}

const DEBOUNCE_MS = 250;

export function GlobalSymbolSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetch(`/api/instruments/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setResults(data?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function go(symbol: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(`/instruments/${encodeURIComponent(symbol)}`);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-[260px]">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.length > 0) go(results[0].symbol);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search stocks & indices…"
        autoComplete="off"
        className="w-full rounded-2xl border border-ink-200 bg-white px-3.5 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-signal-sky focus:outline-none"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border border-ink-200 bg-white shadow-lg">
          {loading && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-400">No matches.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => go(r.symbol)}
                className="block w-full px-4 py-2.5 text-left transition hover:bg-ink-50"
              >
                <span className="text-sm font-semibold text-ink-900">{r.symbol}</span>
                {r.companyName && <span className="ml-2 text-xs text-ink-500">{r.companyName}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
