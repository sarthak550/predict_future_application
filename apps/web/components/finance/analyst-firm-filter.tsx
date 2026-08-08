"use client";

/**
 * Firm filter for /analysts (the Analyst Scorecard directory) — founder ask,
 * 2026-08-08: "if someone believes in JP Morgan's analysts they should be able to
 * filter accordingly." Same `router.push`-driven URL-state idiom as
 * OpinionsFilterBar (components/finance/opinions-filter-bar.tsx): changing the
 * filter navigates to a new `?firm=` URL, so every filtered view is a shareable
 * link and the browser back button works as expected. `/analysts` is a server
 * component that fetches ALL indexable analysts up front and slices to the top
 * 100 for display (see lib/finance/analysts.ts) rather than paginating in SQL, so
 * filtering server-side by `?firm=` before that slice is the simplest correct
 * mechanism — no client-side re-fetch needed.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";
import type { FirmOption } from "@/lib/finance/analysts";

export function AnalystFirmFilter({ firmOptions }: { firmOptions: FirmOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setFirm = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set("firm", value);
    } else {
      next.delete("firm");
    }
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    // Labeled explicitly ("Firm:") rather than relying on the select's own
    // "All firms" default text to communicate what this control does — a
    // primary, visible filter next to the analyst list (founder ask,
    // 2026-08-08), not a control someone has to discover by opening it.
    <label className="flex items-center gap-2 text-sm font-medium text-ink-600">
      Firm
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
    </label>
  );
}
