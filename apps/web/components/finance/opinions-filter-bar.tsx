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
 *
 * Cascading firm <-> analyst (founder ask, 2026-08-08: "once user selects
 * the firm name, can we make sure the analyst names should be accordingly
 * shown there"): `analystOptions`/`firmOptions` arrive PRE-NARROWED from the
 * server (opinionsQuery.ts's fetchOpinionAnalystOptions/fetchOpinionFirmOptions)
 * based on whichever of the two is currently active — this component just
 * renders whatever list it's given. The one thing it owns is transition
 * coherence when FIRM changes: the analyst dropdown's narrowing only takes
 * effect after the navigation completes, so a stale ?analyst= from a
 * different (or no) firm scope could otherwise ride along in the URL. Rather
 * than trying to verify client-side whether the still-selected analyst
 * happens to belong to the newly-picked firm (the unscoped analyst list
 * carries no organization field to check against), we simply clear ?analyst=
 * on every firm change — a superset of "clear when incompatible" that's
 * cheap, always correct, and never leaves a stale/invalid pair in the URL.
 * Clearing FIRM back to "All firms" deliberately leaves ?analyst= alone —
 * an analyst filter alone is unambiguous regardless of firm scope.
 * The reverse direction needs no such handling: whenever a firm is active,
 * the analyst dropdown is already narrowed to that firm's roster by the
 * server, so every option a user can click is guaranteed compatible.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";
import type { OpinionAnalystOption, OpinionFirmOption } from "@/lib/finance/opinionsQuery";

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
  analystOptions: OpinionAnalystOption[];
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

  // See the file-level note above: picking a NEW firm drops any already-
  // selected analyst outright, since we can't cheaply confirm client-side
  // that they still belong to it. Clearing firm back to "All firms" leaves
  // ?analyst= untouched.
  const setFirm = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set("firm", value);
      next.delete("analyst");
    } else {
      next.delete("firm");
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
        {analystOptions.map((analyst) => (
          <option key={analyst.slug} value={analyst.slug}>
            {analyst.count !== undefined ? `${analyst.name} (${analyst.count})` : analyst.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by firm"
        value={searchParams.get("firm") ?? ""}
        onChange={(e) => setFirm(e.target.value)}
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
