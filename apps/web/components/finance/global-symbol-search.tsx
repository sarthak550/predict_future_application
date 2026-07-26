"use client";

/**
 * TradingView-style global search (founder spec 2026-07-25): the nav shows a
 * search trigger; clicking it opens a large CENTERED MODAL — search input on
 * top, category tabs beneath (All / Indices / Stocks / Funds / Bonds /
 * Futures / Options), result rows with symbol, name, a type badge and the
 * exchange tag. Full keyboard support: ↑/↓ move, Enter opens, Esc closes.
 *
 * The server (/api/instruments/search) returns a pre-ranked "All" view plus
 * per-category buckets with ready `href`s — no route logic client-side.
 * Bonds have no live data yet (only the EQ series is ingested) — that tab
 * shows an honest empty state instead of being hidden. Futures (Phase 4,
 * Sprint 2) now returns the 5 index futures, linking into the futures
 * terminal — EMPTY_CATEGORY_COPY.future only ever shows if that fetch itself
 * fails, not as a permanent "coming soon" state anymore.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchResult {
  href: string;
  label: string;
  sublabel: string | null;
  /** Phase 4 (Sprint 2) widened to include "future" — the server now returns real futures results (was previously always empty, see EMPTY_CATEGORY_COPY). */
  category: "index" | "stock" | "fund" | "option" | "future";
}

interface SearchPayload {
  results: SearchResult[];
  byCategory?: Partial<Record<CategoryKey, SearchResult[]>>;
}

type CategoryKey = "all" | "index" | "stock" | "fund" | "bond" | "future" | "option";

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "index", label: "Indices" },
  { key: "stock", label: "Stocks" },
  { key: "fund", label: "Funds" },
  { key: "bond", label: "Bonds" },
  { key: "future", label: "Futures" },
  { key: "option", label: "Options" },
];

const CATEGORY_BADGE: Record<SearchResult["category"], string> = {
  index: "Index",
  stock: "Stock",
  fund: "Fund",
  option: "Options",
  future: "Futures",
};

const EMPTY_CATEGORY_COPY: Partial<Record<CategoryKey, string>> = {
  bond: "Bonds aren't tracked yet.",
  future: "Futures aren't available right now — try again shortly.",
};

const DEBOUNCE_MS = 250;

export function GlobalSymbolSearch() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    setModalOpen(false);
    setQuery("");
    setPayload(null);
    setActiveCategory("all");
    setHighlightIdx(0);
  }, []);

  // Debounced fetch. An empty/short query STILL fetches — the server returns
  // per-tab "popular" defaults (today's movers, tradable indices, top ETFs)
  // so the modal is useful before a single keystroke (founder spec).
  useEffect(() => {
    if (!modalOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetch(`/api/instruments/search?q=${encodeURIComponent(trimmed.length >= 2 ? trimmed : "")}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setPayload(data ?? null);
          setHighlightIdx(0);
        })
        .catch(() => setPayload(null))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, modalOpen]);

  // Autofocus when the modal opens; Esc closes from anywhere in it.
  useEffect(() => {
    if (modalOpen) inputRef.current?.focus();
  }, [modalOpen]);

  function go(href: string) {
    close();
    router.push(href);
  }

  const visibleResults: SearchResult[] =
    activeCategory === "all" ? payload?.results ?? [] : payload?.byCategory?.[activeCategory] ?? [];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, Math.max(0, visibleResults.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && visibleResults[highlightIdx]) {
      e.preventDefault();
      go(visibleResults[highlightIdx].href);
    }
  }

  return (
    <>
      {/* Nav trigger — styled like an input, opens the modal (TradingView pattern). */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex w-full max-w-[280px] items-center gap-2 rounded-2xl border border-ink-200 bg-white px-3.5 py-2 text-left text-sm text-ink-400 transition hover:border-ink-300"
      >
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Search markets…
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/40 p-4 pt-[10vh] backdrop-blur-sm"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-ink-100 bg-white shadow-2xl" onKeyDown={onKeyDown}>
            <div className="border-b border-ink-100 p-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stocks, indices, funds, options…"
                autoComplete="off"
                className="w-full rounded-xl bg-ink-50/60 px-4 py-2.5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-1 border-b border-ink-100 px-3 py-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setActiveCategory(c.key);
                    setHighlightIdx(0);
                    inputRef.current?.focus();
                  }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    activeCategory === c.key ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-ink-50 hover:text-ink-900"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="min-h-[120px] flex-1 overflow-y-auto">
              {loading && visibleResults.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-400">Searching…</p>
              ) : visibleResults.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-400">{EMPTY_CATEGORY_COPY[activeCategory] ?? "No matches."}</p>
              ) : (
                visibleResults.map((r, i) => (
                  <button
                    key={`${r.category}-${r.href}`}
                    type="button"
                    onClick={() => go(r.href)}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition ${
                      i === highlightIdx ? "bg-signal-sky/10" : "hover:bg-ink-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-900">{r.label}</span>
                      {r.sublabel && <span className="block truncate text-xs text-ink-500">{r.sublabel}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-md bg-ink-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                        {CATEGORY_BADGE[r.category]}
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-300">NSE</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
