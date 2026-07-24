import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/paper-trading/options/universe
 *
 * Paper Trading Phase 3 (T3) — thin server-side loopback proxy to apps/api's
 * `/api/finance/options/fo-universe` — same established pattern as the sibling
 * expiries/chain proxies. Never breaks the chain browser's Stock mode or the
 * "Paper trade this call" CTA's eligibility check on a null/failed upstream: a
 * non-200 here is treated as "universe temporarily unavailable", not a crash.
 *
 * Public — no auth required (same posture as the expiries/chain proxies).
 */
export async function GET() {
  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/options/fo-universe`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    const body = await upstream.json().catch(() => null);
    if (body === null) {
      return NextResponse.json({ error: "F&O stock universe temporarily unavailable." }, { status: 502 });
    }
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/paper-trading/options/universe] upstream fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "F&O stock universe temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
