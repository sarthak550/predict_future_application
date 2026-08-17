import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/instruments/index/[symbol]/captured-intraday?indexName=...&sessions=...
 *
 * "Serious Charts" Program, Workstream B (2026-08-17) — thin server-side
 * proxy to apps/api's `/api/finance/instruments/index/[symbol]/captured-intraday`,
 * copied verbatim from the index candles proxy (app/api/instruments/index/
 * [symbol]/candles/route.ts) with only the upstream path swapped and
 * `indexName`/`sessions` forwarded instead of `interval`. Validation happens
 * entirely upstream — this proxy passes apps/api's 400 through unchanged.
 */
export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const requestUrl = new URL(request.url);
  const indexName = requestUrl.searchParams.get("indexName");
  const sessions = requestUrl.searchParams.get("sessions");

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = new URL(`${apiBase}/api/finance/instruments/index/${encodeURIComponent(symbol)}/captured-intraday`);
  if (indexName) upstreamUrl.searchParams.set("indexName", indexName);
  if (sessions) upstreamUrl.searchParams.set("sessions", sessions);

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
      return NextResponse.json({ error: "Captured intraday data temporarily unavailable." }, { status: 502 });
    }

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/instruments/index/captured-intraday] upstream fetch failed for ${symbol}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Captured intraday data temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
