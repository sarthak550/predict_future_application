import { NextResponse } from "next/server";

import { fetchFnoStockUniverse } from "@/lib/marketMoves/optionChain";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/options/fo-universe
 *
 * Paper Trading Phase 3 (T3) — the full F&O-eligible single-stock universe
 * (~210 names confirmed live, symbol + display company name), derived fresh
 * from fo_mktlots.csv on every (cache-gated, 6h TTL) fetch — see
 * lib/marketMoves/optionChain.ts's fetchFnoStockUniverse for the derivation
 * (every CSV row not in the index-derivative denylist). Never a hardcoded
 * list.
 *
 * Public endpoint — no auth required, same posture as the chain/expiries
 * endpoints this sits alongside. Ship-once-filter-client-side: ~210 rows is
 * small enough that apps/web fetches this once and filters in the browser
 * (the chain browser's stock combobox and the "Paper trade this call" CTA's
 * F&O-eligibility check both share the one cached payload) — no server-side
 * typeahead endpoint for a dataset this small.
 *
 * 502 (not 500) on a totally empty upstream result (fo_mktlots.csv
 * unreachable and no prior good cache) so callers render a clean "temporarily
 * unavailable" state instead of crashing.
 */
export async function GET() {
  const universe = await fetchFnoStockUniverse();
  if (universe.length === 0) {
    return NextResponse.json({ error: "F&O stock universe temporarily unavailable." }, { status: 502 });
  }

  const response = NextResponse.json({ universe });
  response.headers.set("Cache-Control", "public, max-age=3600");
  return response;
}
