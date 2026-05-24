import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

/**
 * GET /api/admin/redis-smoke?secret=<CRON_SECRET>
 *
 * Smoke-tests Upstash Redis connectivity without touching any business data.
 * Increments a counter key on every call — verifies durable state across cold starts.
 *
 * Auth: CRON_SECRET query param (same pattern as all cron routes).
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const counter = await redis.incr("smoke:counter");
    return NextResponse.json({ ok: true, counter });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[redis-smoke] Redis error:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 503 }
    );
  }
}
