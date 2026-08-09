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

import { useState, type ReactNode } from "react";
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

/** `YYYY-MM-DD` for the caller's LOCAL wall-clock date — deliberately not UTC (Date#toISOString would shift the date near midnight for any IST/US viewer), and matches how a native `<input type="date">`'s own value/max are always interpreted: a plain calendar date, no timezone. */
function toDateOnly(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateOnly(): string {
  return toDateOnly(new Date());
}

/** `days=7` means "today and the 6 days before it" — 7 calendar days total, inclusive of today, matching how "last 7 days" already reads elsewhere in this app (e.g. getSentimentSplit's rolling window). */
function daysAgoDateOnly(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return toDateOnly(d);
}

/**
 * Preset chips (founder ask, 2026-08-09: "better control... make better
 * sense of data" — most users click a preset rather than type two dates).
 * `from`/`to` are computed fresh on every render against "today" rather than
 * memoized, so a tab left open across midnight still computes the correct
 * range on the next interaction — cheap enough (four Date computations) that
 * memoizing would be premature.
 */
function buildPresets(): { key: string; label: string; from: string; to: string }[] {
  const to = todayDateOnly();
  const year = new Date().getFullYear();
  return [
    { key: "7d", label: "7d", from: daysAgoDateOnly(7), to },
    { key: "30d", label: "30d", from: daysAgoDateOnly(30), to },
    { key: "90d", label: "90d", from: daysAgoDateOnly(90), to },
    { key: "ytd", label: "YTD", from: `${year}-01-01`, to },
  ];
}

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

  // --- Date range (2026-08-09 feature) -----------------------------------
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";
  const today = todayDateOnly();
  const presets = buildPresets();
  const matchedPreset = presets.find((p) => p.from === currentFrom && p.to === currentTo);
  const isAllTime = !currentFrom && !currentTo;
  // "Custom" is active whenever the current range isn't All-time and doesn't
  // exactly match a preset — covers both a hand-picked range AND a shared
  // link someone sent with an arbitrary from/to. Seeds the initial open/
  // closed state of the custom inputs below; see that state's own comment
  // for why it isn't recomputed on every render.
  const isCustomRange = !isAllTime && !matchedPreset;
  // Once opened (by the user clicking Custom, or because the page loaded
  // with an already-custom range), the two date inputs stay visible even if
  // their own onChange briefly produces a range that happens to match a
  // preset — collapsing the inputs the user is actively looking at out from
  // under them would be a worse experience than leaving them open.
  const [customOpen, setCustomOpen] = useState(isCustomRange);

  const setDateRange = (from: string | undefined, to: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString());
    if (from) next.set("from", from);
    else next.delete("from");
    if (to) next.set("to", to);
    else next.delete("to");
    next.delete("page");
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const applyPreset = (preset: { from: string; to: string }) => {
    setCustomOpen(false);
    setDateRange(preset.from, preset.to);
  };

  // "All-time" clears the params entirely rather than setting an explicit
  // wide range (founder brief, section 2) — it degrades to the exact same
  // all-time code path that exists today for every currently-shared link.
  const clearDateRange = () => {
    setCustomOpen(false);
    setDateRange(undefined, undefined);
  };

  // Validation (founder brief, section 2): end defaults to today when only
  // start is given; start > end is clamped (not an error) rather than
  // silently producing a zero-result range; no future dates — clamped here
  // as well as via each input's own `max` attribute, since `max` alone
  // doesn't stop every browser/input method from producing a later value.
  const handleFromChange = (value: string) => {
    let from: string | undefined = value || undefined;
    let to: string | undefined = currentTo || undefined;
    if (from) {
      if (from > today) from = today;
      if (!to) to = today;
      else if (from > to) to = from;
    }
    setDateRange(from, to);
  };

  const handleToChange = (value: string) => {
    let to: string | undefined = value || undefined;
    let from: string | undefined = currentFrom || undefined;
    if (to) {
      if (to > today) to = today;
      if (from && from > to) from = to;
    }
    setDateRange(from, to);
  };

  return (
    <div className="space-y-3">
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-400">Date range</span>
        {presets.map((preset) => (
          <DateRangeChip key={preset.key} active={matchedPreset?.key === preset.key} onClick={() => applyPreset(preset)}>
            {preset.label}
          </DateRangeChip>
        ))}
        <DateRangeChip active={isAllTime} onClick={clearDateRange}>
          All-time
        </DateRangeChip>
        <DateRangeChip active={isCustomRange || customOpen} onClick={() => setCustomOpen(true)}>
          Custom
        </DateRangeChip>

        {customOpen && (
          <span className="flex flex-wrap items-center gap-2 pl-1">
            <label className="flex items-center gap-1.5 text-xs text-ink-500">
              From
              <input
                type="date"
                aria-label="Custom range start date"
                value={currentFrom}
                max={today}
                onChange={(e) => handleFromChange(e.target.value)}
                className="h-9 rounded-xl border border-ink-200 bg-white px-2 text-sm text-ink-900 outline-none transition focus:border-signal-sky focus:ring-2 focus:ring-signal-sky/20"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-500">
              To
              <input
                type="date"
                aria-label="Custom range end date"
                value={currentTo}
                max={today}
                onChange={(e) => handleToChange(e.target.value)}
                className="h-9 rounded-xl border border-ink-200 bg-white px-2 text-sm text-ink-900 outline-none transition focus:border-signal-sky focus:ring-2 focus:ring-signal-sky/20"
              />
            </label>
          </span>
        )}
      </div>
    </div>
  );
}

function DateRangeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-ink-900 text-white" : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
      }`}
    >
      {children}
    </button>
  );
}
