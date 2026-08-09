"use client";

/**
 * Shared "is this actually live" affordance for homepage sparkline surfaces
 * (Indian Economy tiles, Instrument Research cards) — founder complaint
 * 2026-08-09: "the plots/charts we are showing... are not live or at least
 * looks live." Mirrors `homepage-live-chart.tsx`'s established pulsing-dot +
 * honest-disclosure copy convention, so the whole homepage speaks one visual
 * language for "live" instead of inventing a second one here.
 *
 * Three states, in order of legibility:
 *   - `isLive` (market open AND a fresh tick has landed) — pulsing emerald
 *     dot, "Live".
 *   - market open but NOT ticking (no live-quote source wired for this
 *     tile — e.g. SENSEX/USD-INR, which have no per-symbol quote route
 *     today, see economy-tile-live.tsx) — static ink dot, "Market open ·
 *     delayed a few min". Deliberately NOT "Live": that would claim a
 *     per-second freshness this tile can't actually back up.
 *   - market closed — static dot, "Market closed · last session" (this
 *     product's established honest-disclosure convention, matching
 *     homepage-live-chart.tsx / option-chain-browser.tsx / premium-chart.tsx).
 *
 * `asOfMs` (when this data was actually produced — the live tick's receipt
 * time, or the server-render's own fetch timestamp) drives a real "Updated
 * Xs ago" label, ticking client-side on a bare `setInterval` — zero network
 * cost, never fabricates a value, just makes genuine recency legible
 * instead of only implied.
 */
import { useEffect, useState } from "react";

function elapsedLabel(asOfMs: number, nowMs: number): string {
  const deltaSec = Math.max(0, Math.round((nowMs - asOfMs) / 1000));
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHour = Math.round(deltaMin / 60);
  return `${deltaHour}h ago`;
}

/**
 * Ticking "Updated Xs ago" label — re-renders every second while `asOfMs`
 * is under a minute old, backs off to a 30s tick once the delta reads in
 * minutes (no point re-rendering every second for a stable "12m ago").
 */
function useElapsedLabel(asOfMs: number | null): string | null {
  const [nowMs, setNowMs] = useState<number | null>(asOfMs != null ? Date.now() : null);

  useEffect(() => {
    if (asOfMs == null) return;
    setNowMs(Date.now());
    const tick = () => setNowMs(Date.now());
    const deltaSec = (Date.now() - asOfMs) / 1000;
    const intervalMs = deltaSec < 60 ? 1000 : 30_000;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [asOfMs]);

  if (asOfMs == null || nowMs == null) return null;
  return elapsedLabel(asOfMs, nowMs);
}

export function LiveStatusBadge({
  marketOpen,
  isLive,
  asOfMs,
}: {
  marketOpen: boolean;
  isLive: boolean;
  asOfMs: number | null;
}) {
  const elapsed = useElapsedLabel(asOfMs);

  const label = !marketOpen ? "Market closed · last session" : isLive ? "Live" : "Market open · delayed a few min";

  const dotClass = isLive ? "animate-pulse bg-emerald-500" : "bg-ink-300";
  const textClass = isLive ? "text-emerald-600" : "text-ink-400";

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium ${textClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
      {elapsed && <span className="text-ink-300">· {elapsed}</span>}
    </span>
  );
}
