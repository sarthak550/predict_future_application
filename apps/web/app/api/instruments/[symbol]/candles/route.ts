import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/instruments/[symbol]/candles?interval=1m|5m|15m|30m|60m|1d
 *
 * Charting Workbench (W1) — thin server-side proxy to apps/api's
 * `/api/finance/instruments/[symbol]/candles`, copied verbatim from the
 * equity intraday proxy (app/api/instruments/[symbol]/intraday/route.ts)
 * with only the upstream path swapped and the `interval` query param
 * forwarded — same loopback/same-box rationale as that file's doc comment
 * (apps/api owns the only Yahoo-fetching code; proxying keeps it in one
 * place instead of duplicating it into apps/web).
 */
export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const interval = new URL(request.url).searchParams.get("interval");

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = new URL(`${apiBase}/api/finance/instruments/${encodeURIComponent(symbol)}/candles`);
  if (interval) upstreamUrl.searchParams.set("interval", interval);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const body = await upstream.json().catch(() => null);
    if (body === null) {
      return NextResponse.json({ error: "Candle data temporarily unavailable." }, { status: 502 });
    }

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/instruments/candles] upstream fetch failed for ${symbol}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Candle data temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
