import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/paper-trading/options/expiries?underlying=NIFTY|BANKNIFTY
 *
 * Thin server-side loopback proxy to apps/api's
 * `/api/finance/options/expiries` — same established pattern as
 * `apps/web/app/api/instruments/[symbol]/intraday/route.ts`: only apps/api's
 * lib/marketMoves/optionChain.ts (built on nse.ts's cookie handshake) can reach
 * NSE's option-chain endpoints, so this keeps that fetching logic in exactly
 * one place instead of duplicating it into apps/web.
 *
 * Public — no auth required (the chain browser is reachable signed-out; only
 * order placement requires a session).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying");
  if (!underlying) {
    return NextResponse.json({ error: "underlying is required." }, { status: 400 });
  }

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/options/expiries?underlying=${encodeURIComponent(underlying)}`;

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
      return NextResponse.json({ error: "Option chain expiries temporarily unavailable." }, { status: 502 });
    }
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/paper-trading/options/expiries] upstream fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Option chain expiries temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
