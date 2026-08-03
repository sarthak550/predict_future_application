"use client";

/**
 * Founder-feedback pass (2026-08-06) — candle liveness audit, item (c):
 * "Updated HH:MM:SS" chip in the workbench top bar, refreshed on every
 * successful candles fetch (`use-workbench-candles.ts`'s `lastUpdatedAt`).
 * Turns muted-amber with "Stale — retrying" once the last successful fetch
 * is more than 3× the ACTUAL poll interval old (`pollIntervalMs`, the same
 * value the poll timer itself uses — see that module's own doc for why
 * these two numbers can never drift apart).
 *
 * **Render-loop law**: the displayed clock/staleness state is driven by a
 * ticking `now` STATE, updated inside a `useEffect`'s own `setInterval` —
 * same "periodic side effect via a mount effect's own timer" idiom
 * `futures-page-client.tsx`'s 30s spot-price poll already uses elsewhere in
 * this program — never a bare `Date.now()`/`new Date()` call inside the
 * render body itself, which wouldn't re-render on its own (a component is a
 * pure function of state/props, not of "whatever the wall clock reads at
 * render time") and would risk an SSR/client hydration mismatch on the
 * first paint.
 */
import { useEffect, useState } from "react";

const TICK_MS = 1000;

function formatIstTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(
    new Date(epochMs)
  );
}

export function HeartbeatChip({
  lastUpdatedAt,
  pollIntervalMs,
  cadenceNote
}: {
  /** Epoch ms of the last successful candles fetch, or `null` before the first one resolves. */
  lastUpdatedAt: number | null;
  /** The poll cadence actually in effect right now (`use-workbench-candles.ts`'s `pollIntervalMs`) — staleness fires at 3× this. */
  pollIntervalMs: number;
  /** Premium mode's own cadence framing, shown in the tooltip in place of the default equity/index note. */
  cadenceNote?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now()); // first real clock read, post-mount — avoids an SSR/client mismatch on the initial render.
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (lastUpdatedAt === null || now === null) return null; // nothing honest to show before the first fetch resolves.

  const isStale = now - lastUpdatedAt > pollIntervalMs * 3;
  const title =
    cadenceNote ??
    `Polling every ${Math.round(pollIntervalMs / 1000)}s. Actual freshness also depends on Yahoo's own delayed-data latency and apps/api's up-to-60s server-side cache on top of this poll.`;

  return (
    <span
      title={title}
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums ${
        isStale ? "bg-amber-50 text-amber-700" : "bg-ink-50 text-ink-500"
      }`}
    >
      {isStale ? "Stale — retrying" : `Updated ${formatIstTime(lastUpdatedAt)}`}
    </span>
  );
}
