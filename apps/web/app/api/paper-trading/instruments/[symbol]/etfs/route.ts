import { NextResponse } from "next/server";

import { getEtfsTrackingIndex } from "@/lib/finance/etfRegistry";

export const dynamic = "force-dynamic";

/**
 * GET /api/paper-trading/instruments/[symbol]/etfs
 *
 * Index Universe SPRINT B (2026-08-12) — small client-fetchable JSON route,
 * same convention as this directory's own `eod-series` route (see that
 * file's doc): `getEtfsTrackingIndex` (lib/finance/etfRegistry.ts) is
 * Prisma-backed and therefore server-only, but the caller here
 * (`docked-order-ticket.tsx`'s view-only index ticket, mounted from a
 * Client Component) needs it at runtime for the "trade via ETF" pointer in
 * a non-tradable index's disclaimer — see that component's own doc. `symbol`
 * is only ever used as the registry's lookup key (it already handles a
 * non-index or unknown symbol by returning an empty array, never throwing),
 * so no index-membership check is needed here beyond that.
 *
 * Public endpoint — no auth required (same posture as every other
 * market-data-shaped route in this domain). Always `{ etfs: [] }` (never a
 * 404/500) when the symbol tracks no registry-confirmed ETF — an honest
 * "no ETF pointer available" is a normal, common outcome, not an error.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ etfs: [] });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  try {
    const etfs = await getEtfsTrackingIndex(symbol);
    const response = NextResponse.json({
      etfs: etfs.map((e) => ({ symbol: e.symbol, displayName: e.displayName }))
    });
    response.headers.set("Cache-Control", "public, max-age=3600");
    return response;
  } catch (err) {
    console.warn(`[api/paper-trading/instruments/etfs] lookup failed for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return NextResponse.json({ etfs: [] });
  }
}
