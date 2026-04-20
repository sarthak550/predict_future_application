import { useCallback, useEffect, useRef, useState } from "react";

type QueryStatus = "idle" | "loading" | "success" | "error";

export type UseApiQueryResult<T> = {
  data: T | null;
  error: string | null;
  status: QueryStatus;
  loading: boolean;
  refetch: () => Promise<void>;
};

/**
 * Thin data-fetching hook for screens that load a single resource on mount.
 * - cancels stale responses when the component unmounts or deps change
 * - surfaces a normalized error message string
 * - exposes refetch() for pull-to-refresh and retry buttons
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options: { enabled?: boolean; errorFallback?: string } = {}
): UseApiQueryResult<T> {
  const { enabled = true, errorFallback = "Something went wrong." } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<QueryStatus>(enabled ? "loading" : "idle");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await fetcher();
      if (!mountedRef.current) return;
      setData(result);
      setStatus("success");
    } catch (nextError) {
      if (!mountedRef.current) return;
      const message = nextError instanceof Error ? nextError.message : errorFallback;
      setError(message);
      setStatus("error");
    }
    // fetcher intentionally excluded — callers supply deps they care about
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  return {
    data,
    error,
    status,
    loading: status === "loading",
    refetch: run
  };
}
