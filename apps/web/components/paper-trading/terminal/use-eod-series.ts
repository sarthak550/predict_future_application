"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T5/T6) — client-side daily-close EOD
 * series fetch, shared by the equity terminal (focused symbol changes via
 * search) and the options terminal (stock-underlying chart, changes via the
 * chain browser's mode/combobox). Backs PriceChart's `series` prop for every
 * non-1D timeframe. Hits the new
 * GET /api/paper-trading/instruments/[symbol]/eod-series route.
 */
import { useEffect, useState } from "react";

import type { PricePoint } from "@/components/finance/price-chart";

function formatLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit" });
}

export function useEodSeries(symbol: string | null): PricePoint[] {
  const [series, setSeries] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!symbol) {
      setSeries([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/paper-trading/instruments/${encodeURIComponent(symbol)}/eod-series`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const rows: { date: string; close: number }[] = Array.isArray(data?.series) ? data.series : [];
        setSeries(rows.map((r) => ({ date: formatLabel(r.date), close: r.close })));
      })
      .catch(() => {
        if (!cancelled) setSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return series;
}
