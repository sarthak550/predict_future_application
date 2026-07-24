"use client";

/**
 * Polls `callback` every `intervalMs` while the tab is visible, pausing
 * entirely when it's hidden (no wasted requests against the delayed feed) and
 * firing an immediate catch-up tick when the user returns.
 *
 * The callback is kept in a ref so a fresh closure on every parent render
 * doesn't tear down and re-arm the interval — the effect re-runs only when
 * `intervalMs` or `enabled` actually change. (Same self-cancellation family of
 * bugs as the 1D chart's fetch effect — see price-chart.tsx.)
 */
import { useEffect, useRef } from "react";

export function useVisiblePolling(callback: () => void, intervalMs: number, enabled: boolean) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId == null) intervalId = setInterval(() => callbackRef.current(), intervalMs);
    };
    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        callbackRef.current(); // catch-up tick on return
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
