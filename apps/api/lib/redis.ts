import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production"
    );
  }
  console.warn(
    "[redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are unset — " +
      "falling back to in-memory mock (dev only). " +
      "Rate-limiting and push-token buckets will NOT be durable across restarts."
  );
}

/**
 * Shared Upstash Redis client.
 *
 * In production: reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN from env.
 * In development: if env vars are absent the client still initialises (Upstash SDK
 * will throw on actual calls, which surfaces the missing-config error early).
 *
 * Callers: apps/api/lib/rate-limit.ts, push-token bucket routes, smoke-test endpoint.
 *
 * Setup:
 *   1. Create a free database at https://console.upstash.com
 *   2. Copy "REST URL" → UPSTASH_REDIS_REST_URL
 *   3. Copy "REST Token" → UPSTASH_REDIS_REST_TOKEN
 *   4. Add both to Vercel project env vars (all environments)
 */
export const redis = Redis.fromEnv();
