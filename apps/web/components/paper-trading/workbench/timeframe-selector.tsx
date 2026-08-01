"use client";

/**
 * Charting Workbench (W2, T2) — timeframe pills for the workbench's chart.
 * `intervals` is a PROP, not a mode-detection branch inside this component —
 * per the founder plan, equity/index gets the full 1m–1D set this sprint;
 * W3's premium mode narrows it to 15m/30m by passing a shorter array, no
 * change needed here when that ships.
 *
 * Persists the last-picked interval in `localStorage` under
 * `pf.workbench.interval` — a device-wide preference, restored AFTER
 * mount (reading localStorage during render would mismatch SSR/hydration,
 * same posture as price-chart.tsx's own timeframe restore).
 */
import { useEffect } from "react";

import type { CandleInterval } from "./use-workbench-candles";

const STORAGE_KEY = "pf.workbench.interval";

const LABELS: Record<CandleInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "60m": "1h",
  "1d": "1D"
};

function isCandleInterval(v: string | null, allowed: CandleInterval[]): v is CandleInterval {
  return v != null && (allowed as string[]).includes(v);
}

export function TimeframeSelector({
  intervals,
  value,
  onChange
}: {
  intervals: CandleInterval[];
  value: CandleInterval;
  onChange: (interval: CandleInterval) => void;
}) {
  // Restore the last-picked interval once, after mount — only if it's still
  // valid for THIS chart's offered interval set (a premium-mode chart
  // restoring a stale "1m" pick from an equity session would just render
  // nothing sensible).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isCandleInterval(stored, intervals) && stored !== value) onChange(stored);
    } catch {
      // Private mode / storage disabled — keep the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(interval: CandleInterval) {
    onChange(interval);
    try {
      window.localStorage.setItem(STORAGE_KEY, interval);
    } catch {
      // Preference just won't survive the refresh.
    }
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Chart timeframe">
      {intervals.map((interval) => (
        <button
          key={interval}
          type="button"
          onClick={() => pick(interval)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === interval ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-ink-100"
          }`}
        >
          {LABELS[interval]}
        </button>
      ))}
    </div>
  );
}
