"use client";

/**
 * Horizontal filter bar for /opinions. Deliberately plain <select> elements
 * (not a mobile-style bottom sheet) — changing a filter navigates to a new
 * URL via router.push, so every filter combination is a shareable link and
 * the browser back button works as expected. Resets `page` to 1 whenever a
 * filter changes (a stale page number past the new filtered result count
 * would otherwise render an empty page silently).
 *
 * Firm filter (founder ask, 2026-08-08: "the firm based search is available
 * on Analyst page but not on Opinion page — we need that filter there as
 * well") mirrors /analysts' AnalystFirmFilter — same `?firm=` param, same
 * canonical-firm value shape (lib/finance/firmLink.ts, opinionsQuery.ts's
 * fetchOpinionFirmOptions) — but composes with this bar's other filters via
 * setParam rather than living as its own standalone control.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";
import type { OpinionFirmOption } from "@/lib/finance/opinionsQuery";

const DIRECTION_OPTIONS = [
  { value: "", label: "All directions" },
  { value: "BULLISH", label: "Bullish" },
  { value: "BEARISH", label: "Bearish" },
  { value: "NEUTRAL", label: "Neutral" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All calls" },
  { value: "graded", label: "Graded (HIT/MISS)" },
  { value: "pending", label: "Pending" },
];

export function OpinionsFilterBar({
  instrumentOptions,
  analystOptions,
  firmOptions,
}: {
  instrumentOptions: string[];
  analystOptions: { slug: string | null; name: string }[];
  firmOptions: OpinionFirmOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete("page");
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label="Filter by instrument"
        value={searchParams.get("instrument") ?? ""}
        onChange={(e) => setParam("instrument", e.target.value)}
        className="w-auto min-w-[10rem]"
      >
        <option value="">All instruments</option>
        {instrumentOptions.map((instrument) => (
          <option key={instrument} value={instrument}>
            {instrument}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by direction"
        value={searchParams.get("direction") ?? ""}
        onChange={(e) => setParam("direction", e.target.value)}
        className="w-auto min-w-[9rem]"
      >
        {DIRECTION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by grading status"
        value={searchParams.get("status") ?? ""}
        onChange={(e) => setParam("status", e.target.value)}
        className="w-auto min-w-[10rem]"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by analyst"
        value={searchParams.get("analyst") ?? ""}
        onChange={(e) => setParam("analyst", e.target.value)}
        className="w-auto min-w-[10rem]"
      >
        <option value="">All analysts</option>
        {analystOptions
          .filter((a): a is { slug: string; name: string } => Boolean(a.slug))
          .map((analyst) => (
            <option key={analyst.slug} value={analyst.slug}>
              {analyst.name}
            </option>
          ))}
      </Select>

      <Select
        aria-label="Filter by firm"
        value={searchParams.get("firm") ?? ""}
        onChange={(e) => setParam("firm", e.target.value)}
        className="w-auto min-w-[14rem]"
      >
        <option value="">All firms</option>
        {firmOptions.map((opt) => (
          <option key={opt.firm} value={opt.firm}>
            {opt.firm} ({opt.count})
          </option>
        ))}
      </Select>
    </div>
  );
}
