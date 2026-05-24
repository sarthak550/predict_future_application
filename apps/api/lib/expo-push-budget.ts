import { redis } from "./redis";

const KEY = "expo:tokens-sent";
const BUCKET_LIMIT = Number(process.env.EXPO_PUSH_HOURLY_LIMIT ?? "10000");
const WINDOW_SEC = 60 * 60;

/**
 * Try to spend `n` tokens from the hourly Expo budget. Returns true if budget
 * available (and consumed), false if exhausted.
 *
 * Atomic INCRBY + EXPIRE-on-first-write. Distributed across all Vercel function instances.
 * Dev fallback: if Redis unset, always returns true (no rate-limiting in dev).
 *
 * Edge case: if `n` itself exceeds BUCKET_LIMIT, we'd otherwise INCRBY the
 * counter to `n`, lock out the rest of the hour, and not have actually sent
 * anything (the caller checks our return value and skips). Short-circuit on
 * the over-cap request without touching Redis so the budget stays intact.
 */
export async function trySpendPushBudget(n: number): Promise<boolean> {
  if (!process.env.UPSTASH_REDIS_REST_URL) return true; // dev — no-op
  if (n <= 0) return true;
  if (n > BUCKET_LIMIT) return false;
  const current = await redis.incrby(KEY, n);
  if (current === n) {
    await redis.expire(KEY, WINDOW_SEC);
  }
  return current <= BUCKET_LIMIT;
}
