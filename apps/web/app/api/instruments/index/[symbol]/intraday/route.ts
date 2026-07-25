import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/instruments/index/[symbol]/intraday
 *
 * Trading Terminal UI Overhaul (Sprint A, T2) — thin server-side proxy to
 * apps/api's /api/finance/instruments/index/[symbol]/intraday, copied
 * verbatim from the equity intraday proxy
 * (app/api/instruments/[symbol]/intraday/route.ts) with only the upstream
 * path swapped — same loopback/same-box rationale as that file's doc comment.
 * `symbol` must be NIFTY or BANKNIFTY; anything else is rejected upstream
 * with a 400 that this proxy passes through unchanged.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/instruments/index/${encodeURIComponent(symbol)}/intraday`;

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
      return NextResponse.json({ error: "Intraday data temporarily unavailable." }, { status: 502 });
    }

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/instruments/index/intraday] upstream fetch failed for ${symbol}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Intraday data temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
