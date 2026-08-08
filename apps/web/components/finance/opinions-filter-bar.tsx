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
 * N-way cascade across firm/analyst/sector/instrument (founder ask,
 * 2026-08-08 for firm<->analyst, generalized 2026-08-09: "if I click on
 * Banking then only firms or analysts or instruments which are relevant
 * should be shown in dropdown"): every option list arrives PRE-NARROWED from
 * the server (opinionsQuery.ts's buildWhereExcluding, applied per dimension)
 * against whichever OTHER dimensions are currently active — this component
 * just renders whatever list it's given. In NORMAL one-dropdown-at-a-time use
 * this is self-maintaining and never produces an incompatible combination:
 * every option in a rendered list was already computed against every OTHER
 * currently-active filter, so picking any one of them keeps the whole set
 * mutually consistent by construction.
 *
 * The one thing this component owns is transition coherence for the two
 * BROADER-scoped dimensions (firm on the expert axis, sector on the subject
 * axis — see opinionsQuery.ts's DROP_PRECEDENCE for why these two outrank
 * their narrower siblings): changing either one's narrowing of its dependent
 * (analyst under firm; instrument under sector) only takes effect after the
 * navigation completes, so a stale, now-incompatible dependent value could
 * otherwise ride along in the URL until the next unrelated change. Rather
 * than verifying client-side whether the still-selected dependent happens to
 * remain valid (the unscoped lists carry no organization/sector field to
 * check against), we simply clear it on every firm/sector change — a
 * superset of "clear when incompatible" that's cheap, always correct, and
 * never leaves a stale pair riding in the URL. Clearing FIRM or SECTOR back
 * to "All ..." deliberately leaves the dependent alone — an analyst or
 * instrument filter alone is unambiguous regardless of firm/sector scope.
 * Firm<->sector and analyst<->instrument (cross-axis pairs) are NOT given
 * this treatment — they're less tightly coupled in practice, and the
 * server's own false-empty degrade (resolveEffectiveFilters' DROP_PRECEDENCE
 * retry) already handles the rare case a cross-axis pair does go stale,
 * without needing every dropdown to reset every other on each change.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";
import type {
  OpinionAnalystOption,
  OpinionFirmOption,
  OpinionInstrumentOption,
  OpinionSectorOption,
} from "@/lib/finance/opinionsQuery";

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
  sectorOptions,
}: {
  instrumentOptions: OpinionInstrumentOption[];
  analystOptions: OpinionAnalystOption[];
  firmOptions: OpinionFirmOption[];
  /** All four dropdowns now cascade against one another (founder ask, 2026-08-09) — see opinionsQuery.ts's buildWhereExcluding for the shared mechanism. */
  sectorOptions: OpinionSectorOption[];
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

  // See the file-level note above: picking a NEW value for a broader-scoped
  // dimension drops its dependent's already-selected value outright, since
  // we can't cheaply confirm client-side that it still belongs. Clearing the
  // broader dimension back to "All ..." leaves the dependent untouched.
  const setParamAndClearDependent = (key: string, value: string, dependentKey: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
      next.delete(dependentKey);
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
        {instrumentOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value} ({opt.count})
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
        onChange={(e) => setParamAndClearDependent("firm", e.target.value, "analyst")}
        className="w-auto min-w-[14rem]"
      >
        <option value="">All firms</option>
        {firmOptions.map((opt) => (
          <option key={opt.firm} value={opt.firm}>
            {opt.firm} ({opt.count})
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by sector"
        value={searchParams.get("sector") ?? ""}
        onChange={(e) => setParamAndClearDependent("sector", e.target.value, "instrument")}
        className="w-auto min-w-[12rem]"
      >
        <option value="">All sectors</option>
        {sectorOptions.map((opt) => (
          <option key={opt.sector} value={opt.sector}>
            {opt.sector} ({opt.count})
          </option>
        ))}
      </Select>
    </div>
  );
}
