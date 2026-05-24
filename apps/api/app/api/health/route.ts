import { NextResponse } from "next/server";

/**
 * GET /api/health
 *
 * Returns 200 with service status. Includes a Redis smoke check when
 * UPSTASH_REDIS_REST_URL is configured; returns "skipped" when env vars are absent
 * (local dev without Redis) so the endpoint remains usable in all environments.
 */
export async function GET() {
  let redisStatus: "ok" | "skipped" | "error" = "skipped";
  let redisError: string | undefined;

  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    try {
      // Lazy import so module init errors are caught here, not at startup.
      const { redis } = await import("@/lib/redis");
      await redis.set("health:ping", "ok", { ex: 60 });
      const val = await redis.get("health:ping");
      redisStatus = val === "ok" ? "ok" : "error";
    } catch (err) {
      redisStatus = "error";
      redisError = err instanceof Error ? err.message : String(err);
      console.error("[health] Redis check failed:", redisError);
    }
  }

  const healthy = redisStatus !== "error";

  return NextResponse.json(
    {
      ok: healthy,
      service: "@predict-future/api",
      timestamp: new Date().toISOString(),
      redis: redisStatus,
      ...(redisError ? { redisError } : {}),
    },
    { status: healthy ? 200 : 503 }
  );
}
