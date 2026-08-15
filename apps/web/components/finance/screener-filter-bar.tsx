"use client";

/**
 * /screener filter bar (Growth Loop Sprint G4, Decision 4). Same
 * URL-param-driven navigation pattern as OpinionsFilterBar (router.push on
 * change, so every combination is a shareable/bookmarkable link) — but a
 * much simpler control set: every option list here is STATIC (window
 * presets, the minGraded dropdown's fixed 4 values, the sentiment-lean
 * enum, CANONICAL_SECTOR_LABELS), not server-computed cascading counts, so
 * there's no need for opinionsQuery.ts's per-dimension option-fetching
 * machinery. Filters compose as independent AND clauses (see
 * screenerQuery.ts's own doc comment) — picking a sector never changes
 * which lean/minGraded options are offered, unlike /opinions' cascade.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";
import { CANONICAL_SECTOR_LABELS } from "@/lib/finance/sectorTaxonomy";
import { MIN_GRADED_OPTIONS, SCREENER_WINDOW_OPTIONS, SENTIMENT_LEAN_OPTIONS } from "@/lib/finance/screenerFilters";

export function ScreenerFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const currentWindow = searchParams.get("window") ?? "30d";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ink-400">Window</span>
        {SCREENER_WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setParam("window", opt.key)}
            aria-pressed={currentWindow === opt.key}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              currentWindow === opt.key
                ? "bg-ink-900 text-white"
                : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <Select
        aria-label="Minimum graded calls"
        value={searchParams.get("minGraded") ?? ""}
        onChange={(e) => setParam("minGraded", e.target.value)}
        className="w-auto min-w-[10rem]"
      >
        {MIN_GRADED_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value === 0 ? "" : opt.value}>
            {opt.value === 0 ? "Min graded calls: Any" : `Min graded calls: ${opt.label}`}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by sentiment lean"
        value={searchParams.get("lean") ?? ""}
        onChange={(e) => setParam("lean", e.target.value)}
        className="w-auto min-w-[12rem]"
      >
        <option value="">All sentiment leans</option>
        {SENTIMENT_LEAN_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by sector"
        value={searchParams.get("sector") ?? ""}
        onChange={(e) => setParam("sector", e.target.value)}
        className="w-auto min-w-[12rem]"
      >
        <option value="">All sectors</option>
        {CANONICAL_SECTOR_LABELS.map((sector) => (
          <option key={sector} value={sector}>
            {sector}
          </option>
        ))}
      </Select>
    </div>
  );
}
