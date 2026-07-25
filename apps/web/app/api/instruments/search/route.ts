import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * GET /api/instruments/search?q= — global nav-bar instrument search (public).
 * Matches NSE stocks by symbol or company name against the StockEodQuote
 * store (same source the Paper Trading symbol search uses), plus the five
 * F&O indices by hand (they have no StockEodQuote rows). Results link to
 * /instruments/[symbol] — the public stock page with price history, analyst
 * opinions and news.
 */

const INDEX_ENTRIES = [
  { symbol: "NIFTY", companyName: "Nifty 50 (index)" },
  { symbol: "BANKNIFTY", companyName: "Nifty Bank (index)" },
  { symbol: "FINNIFTY", companyName: "Nifty Financial Services (index)" },
  { symbol: "MIDCPNIFTY", companyName: "Nifty Midcap Select (index)" },
  { symbol: "NIFTYNXT50", companyName: "Nifty Next 50 (index)" },
];

const MAX_RESULTS = 8;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const needle = q.toUpperCase();
  const indexMatches = INDEX_ENTRIES.filter(
    (e) => e.symbol.includes(needle) || e.companyName.toUpperCase().includes(needle)
  );

  // Latest session's rows only — symbol+name from the most recent EOD ingest.
  const latest = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  const stockRows = latest
    ? await prisma.stockEodQuote.findMany({
        where: {
          sessionDate: latest.sessionDate,
          OR: [{ symbol: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }],
        },
        orderBy: { symbol: "asc" },
        take: MAX_RESULTS,
        select: { symbol: true, companyName: true },
      })
    : [];

  const results = [...indexMatches, ...stockRows].slice(0, MAX_RESULTS);
  const response = NextResponse.json({ results });
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
