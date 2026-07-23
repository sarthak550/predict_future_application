import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { searchSymbols } from "@/lib/portfolios/queries";

/**
 * GET /api/paper-trading/symbols/search?q=
 *
 * Deliberate deviation from the brief's suggestion to reuse apps/api's
 * fetchEquityNames() directly: apps/web cannot import apps/api's server code (a
 * constraint already established and documented for Portfolios — see
 * lib/portfolios/queries.ts's searchSymbols doc comment). Portfolios' own
 * symbol-search route hits the exact same constraint and solves it by searching
 * StockEodQuote's latest session instead — reused here as-is rather than
 * duplicated, since it's also the exact tradeable universe for Paper Trading (a
 * symbol with no quote history can't be priced for a fill either).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const results = await searchSymbols(q);
  return NextResponse.json({ results });
}
