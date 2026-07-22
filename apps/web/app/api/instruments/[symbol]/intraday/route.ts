import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/instruments/[symbol]/intraday
 *
 * Thin server-side proxy to apps/api's `/api/finance/instruments/[symbol]/intraday`.
 *
 * Unlike the rest of apps/web's finance data (which reads Postgres directly
 * via its own Prisma client — see lib/finance/instrument.ts), intraday ticks
 * are never persisted: they're a live NSE fetch that only apps/api's
 * lib/marketMoves/nse.ts cookie-handshake fetcher can make. Proxying keeps
 * that NSE-fetching logic in exactly one place instead of duplicating the
 * Akamai cookie dance into apps/web.
 *
 * Same-box deployment (both apps run as sibling Docker containers on one
 * EC2 host behind Caddy — see project_ec2_prod_ops / web-live-ec2 memory) so
 * this is a loopback call, not a public internet hop: keeps the browser
 * same-origin (no CORS) and avoids a public round-trip. `API_INTERNAL_URL`
 * overrides the default for any deployment where the two apps aren't
 * co-located.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/instruments/${encodeURIComponent(symbol)}/intraday`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const body = await upstream.json().catch(() => null);
    if (body === null) {
      return NextResponse.json({ error: "Intraday data temporarily unavailable." }, { status: 502 });
    }

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/instruments/intraday] upstream fetch failed for ${symbol}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Intraday data temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
