"use client";

/**
 * Horizontal filter bar for /opinions. Deliberately plain <select> elements
 * (not a mobile-style bottom sheet) — changing a filter navigates to a new
 * URL via router.push, so every filter combination is a shareable link and
 * the browser back button works as expected. Resets `page` to 1 whenever a
 * filter changes (a stale page number past the new filtered result count
 * would otherwise render an empty page silently).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";

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
}: {
  instrumentOptions: string[];
  analystOptions: { slug: string | null; name: string }[];
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
    </div>
  );
}
