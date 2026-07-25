import { NextResponse } from "next/server";

import { getAllIndices } from "@/lib/marketMoves/allIndices";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/indices
 *
 * All-Indices informational layer — every NSE-published index (139 as of
 * 2026-07-25: 5 F&O-eligible + broad market + sectoral + strategy + thematic
 * + fixed income), live from NSE's own /api/allIndices. Public, no auth.
 *
 * Response: { asOf, indices: NormalizedIndexRow[] }. `asOf` is the actual
 * fetch timestamp of the underlying data (may lag "now" by up to the 60s
 * in-module cache TTL, or longer on a stale-if-error fallback — always
 * honest, never fabricated).
 *
 * 503 only when NSE has never been successfully reached since boot (or the
 * stale cache has since been evicted) — the directory page treats this as
 * "temporarily unavailable", not a 404.
 */
export async function GET() {
  const snapshot = await getAllIndices();
  if (!snapshot) {
    return NextResponse.json({ error: "Index data temporarily unavailable." }, { status: 503 });
  }

  const response = NextResponse.json({ asOf: snapshot.asOf, indices: snapshot.rows });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
