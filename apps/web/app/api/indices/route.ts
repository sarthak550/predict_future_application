import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Same-box default: apps/api's `pf-api` container listens on 127.0.0.1:3001 (see EC2 prod ops). */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/indices
 *
 * Browser-facing loopback proxy to apps/api's /api/finance/indices, copied
 * verbatim (structure-wise) from the index intraday proxy
 * (app/api/instruments/index/[symbol]/intraday/route.ts). Exists for any
 * CLIENT-side fetch of the all-indices list (the /indices directory page
 * itself is a server component and calls apps/api directly via
 * lib/finance/indices.ts, one hop cheaper — see that file's doc).
 */
export async function GET() {
  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const upstreamUrl = `${apiBase}/api/finance/indices`;

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
      return NextResponse.json({ error: "Index data temporarily unavailable." }, { status: 502 });
    }

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[api/indices] upstream fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return NextResponse.json({ error: "Index data temporarily unavailable." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
