import { useEffect, useRef } from "react";

/**
 * Calls `callback` at the given `intervalMs`. Stops when `active` is false.
 * Safe with fast React re-renders — always uses the latest callback via ref.
 */
export function useInterval(callback: () => void, intervalMs: number, active: boolean) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
}
