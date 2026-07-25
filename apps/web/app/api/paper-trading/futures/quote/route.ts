import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/paper-trading/futures/quote?underlying=NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYNXT50
 *
 * Thin server-side loopback proxy to apps/api's `/api/finance/futures/quote`
 * — same pattern as the sibling option-chain proxy. Never breaks page render
 * on a null/failed upstream: a non-200 here should be treated as "futures
 * quote temporarily unavailable, try again shortly", not a crash.
 *
 * Public — no auth required. Order placement (Sprint 2) is a separate,
 * session-gated route; quoting is not.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying");
  if (!underlying) {
    return NextResponse.json({ error: "underlying is required." }, { status: 400 });
  }

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/futures/quote?underlying=${encodeURIComponent(underlying)}`;

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
      return NextResponse.json({ error: "Futures quote temporarily unavailable." }, { status: 502 });
    }
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/paper-trading/futures/quote] upstream fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Futures quote temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
