import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { searchSymbols } from "@/lib/portfolios/queries";

/**
 * GET /api/portfolios/symbols/search?q=
 *
 * Symbol/company search over StockEodQuote's latest session — the tradeable
 * universe for portfolios (a symbol with no quote history can't be priced).
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
