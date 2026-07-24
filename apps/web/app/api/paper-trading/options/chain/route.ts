import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/paper-trading/options/chain?underlying=NIFTY|BANKNIFTY&expiry=DD-MMM-YYYY
 *
 * Thin server-side loopback proxy to apps/api's `/api/finance/options/chain` —
 * same pattern as the sibling expiries proxy and the existing equity intraday
 * proxy. Never breaks page render on a null/failed upstream: the chain browser
 * (T7) treats a non-200 here as "chain temporarily unavailable, try again
 * shortly", not a crash.
 *
 * Public — no auth required. Order PLACEMENT (T5) is a separate, session-gated
 * route; browsing the chain is not.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying");
  const expiry = searchParams.get("expiry");
  if (!underlying || !expiry) {
    return NextResponse.json({ error: "underlying and expiry are required." }, { status: 400 });
  }

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/options/chain?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}`;

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
      return NextResponse.json({ error: "Option chain temporarily unavailable." }, { status: 502 });
    }
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/paper-trading/options/chain] upstream fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Option chain temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
