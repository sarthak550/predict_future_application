/**
 * Lightweight retry for idempotent GET fetches.
 *
 * Retries ONLY on failures that are plausibly transient:
 *   - transport-level failures (React Native fetch throws `TypeError: Network request
 *     failed` when the request never gets an HTTP response — flaky Wi-Fi, a dropped
 *     socket, connection-pool contention when many requests fire at once)
 *   - transient server statuses: 429 / 502 / 503 / 504
 *
 * It NEVER retries deterministic HTTP errors (401/403/404/422/500…) — those are real
 * responses, not blips, and retrying would only delay the inevitable or mask a bug.
 *
 * ONLY wrap idempotent calls (GETs). Do NOT wrap POST/PATCH/DELETE — a retried mutation
 * can double-apply.
 */

export function isRetryableNetworkError(err: unknown): boolean {
  // Transport failure: no HTTP response ever arrived.
  if (err instanceof TypeError && /network request failed/i.test(err.message)) {
    return true;
  }
  // Transient server statuses (ApiClientError carries `status`).
  const status = (err as { status?: number } | null | undefined)?.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; retryable?: (err: unknown) => boolean } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const retryable = opts.retryable ?? isRetryableNetworkError;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !retryable(err)) throw err;
      // Exponential backoff: 400ms, 800ms, …
      await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}
