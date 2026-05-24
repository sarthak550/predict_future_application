/**
 * Distributed rate limiter backed by Upstash Redis.
 *
 * S42-T7: Replaces the previous in-memory Map implementation which was
 * per-Vercel-instance (cold starts reset counters; concurrent instances each
 * maintained independent state). This version uses atomic Redis INCR + PEXPIRE
 * so limits are enforced consistently across all function invocations.
 *
 * Dev fallback: if UPSTASH_REDIS_REST_URL is unset (typical local dev), all
 * requests are allowed and a one-time console.warn is emitted.
 *
 * Usage:
 *   const result = await checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
 *   if (!result.allowed) return 429;
 */

import { redis } from "./redis";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// Detect missing Redis config at module load so we warn exactly once.
const REDIS_AVAILABLE = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

if (!REDIS_AVAILABLE) {
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are unset — " +
      "rate-limiting is DISABLED (all requests allowed). " +
      "Set these env vars in dev or deploy to enforce limits."
  );
}

/**
 * Checks and increments the rate-limit bucket for the given key.
 *
 * Uses atomic INCR + PEXPIRE: the TTL is set only on the first write so the
 * window is fixed from the first request (sliding within the window is not
 * supported by design — simpler and cheaper on Redis).
 *
 * @param key       - Unique string key identifying the (subject, action) pair.
 * @param limit     - Maximum number of requests allowed within the window.
 * @param windowMs  - Window duration in milliseconds.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (!REDIS_AVAILABLE) {
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowMs };
  }

  const prefixed = `rl:${key}`;

  // INCR is atomic; if the key doesn't exist Redis creates it at 0 then increments.
  const count = await redis.incr(prefixed);

  // Set TTL only on the first write to anchor the window start.
  if (count === 1) {
    await redis.pexpire(prefixed, windowMs);
  }

  const ttlMs = await redis.pttl(prefixed);
  // pttl returns -2 if key doesn't exist, -1 if no TTL — fall back to windowMs.
  const resetAt = Date.now() + (ttlMs > 0 ? ttlMs : windowMs);

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/**
 * Resets the rate-limit bucket for the given key.
 * Use this after a successful OTP confirmation to clear the failed-attempt counter.
 */
export async function resetRateLimit(key: string): Promise<void> {
  if (!REDIS_AVAILABLE) {
    return;
  }
  await redis.del(`rl:${key}`);
}
