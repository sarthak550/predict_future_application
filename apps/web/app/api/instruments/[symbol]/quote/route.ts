import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/instruments/[symbol]/quote
 *
 * Quote-driven intrabar ticks — thin server-side proxy to apps/api's
 * `/api/finance/instruments/[symbol]/quote`, same loopback pattern as the
 * sibling `/intraday` proxy. Deliberately its own tiny endpoint rather than
 * a query param on `/intraday`: this is polled every ~4-5s by
 * `use-live-quote-tick.ts` while `/intraday` stays on its existing 60s
 * background-poll cadence — conflating the two would either slow this one
 * down to 60s (defeating the point) or speed the full-series fetch up to
 * 4-5s (needless load for data that mostly hasn't changed).
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/instruments/${encodeURIComponent(symbol)}/quote`;

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
      return NextResponse.json({ error: "Live quote temporarily unavailable." }, { status: 502 });
    }

    const response = NextResponse.json(body, { status: upstream.status });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/instruments/quote] upstream fetch failed for ${symbol}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Live quote temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
