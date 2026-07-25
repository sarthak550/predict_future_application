import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { fetchAllIndices } from "@/lib/finance/indices";
import { INDEX_SLUG_TO_TRADABLE_UNDERLYING } from "@/lib/finance/indexTradableAlias";

/**
 * GET /api/instruments/search?q= — global nav-bar instrument search (public).
 * Matches, in ranked order:
 *   1. An EXACT symbol match against StockEodQuote (looked up directly, not
 *      just filtered out of the fuzzy list — see the RELIANCE/RELCHEMQ note
 *      below), so a well-known ticker always surfaces regardless of where it
 *      falls alphabetically among fuzzy matches.
 *   2. The five F&O-tradable indices (hand-maintained; link to
 *      /instruments/[symbol] — the richer page with sentiment/opinions/chart
 *      built for these five, see [[project_trading_terminal_sprint_a]]).
 *   3. Fuzzy StockEodQuote matches (symbol or company name contains the
 *      query), alphabetical.
 *   4. All-Indices informational matches (any of NSE's 139 published
 *      indices — "auto"/"metal" find NIFTY AUTO/NIFTY METAL etc.), EXCLUDING
 *      the five tradable ones already covered by (2) to avoid a confusing
 *      duplicate entry for the same underlying. Link to /indices/[slug].
 *
 * BUG FIXED (founder brief 2026-07-25): the old query fetched only
 * `take: MAX_RESULTS` fuzzy rows ordered alphabetically, so a query like
 * "REL" could push RELIANCE itself out of the result set entirely (or rank
 * it below alphabetically-earlier tickers like RELCHEMQ) whenever more than
 * MAX_RESULTS symbols shared that prefix. Fixed with a dedicated exact-match
 * lookup that's independent of the fuzzy query's row limit.
 */

/** Server-navigable result: the client is deliberately dumb (renders label/sublabel, routes to href) — the union of three distinct destination types (equity page / tradable-index instrument page / informational index page) is resolved here, not client-side. */
type SearchResultItem = {
  href: string;
  label: string;
  sublabel: string | null;
};

const TRADABLE_INDEX_ENTRIES: { symbol: string; companyName: string }[] = [
  { symbol: "NIFTY", companyName: "Nifty 50 (index)" },
  { symbol: "BANKNIFTY", companyName: "Nifty Bank (index)" },
  { symbol: "FINNIFTY", companyName: "Nifty Financial Services (index)" },
  { symbol: "MIDCPNIFTY", companyName: "Nifty Midcap Select (index)" },
  { symbol: "NIFTYNXT50", companyName: "Nifty Next 50 (index)" },
];

const MAX_RESULTS = 8;
/** Over-fetch the fuzzy DB query so the exact-match dedupe below never starves the visible list. */
const FUZZY_FETCH_MULTIPLE = 3;
const MAX_ALL_INDEX_MATCHES = 5;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const needle = q.toUpperCase();

  const [exactStock, fuzzyStockRows, allIndices] = await Promise.all([
    prisma.stockEodQuote.findFirst({
      where: { symbol: { equals: needle, mode: "insensitive" } },
      orderBy: { sessionDate: "desc" },
      select: { symbol: true, companyName: true },
    }),
    (async () => {
      const latest = await prisma.stockEodQuote.findFirst({
        orderBy: { sessionDate: "desc" },
        select: { sessionDate: true },
      });
      if (!latest) return [];
      return prisma.stockEodQuote.findMany({
        where: {
          sessionDate: latest.sessionDate,
          OR: [{ symbol: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }],
        },
        orderBy: { symbol: "asc" },
        take: MAX_RESULTS * FUZZY_FETCH_MULTIPLE,
        select: { symbol: true, companyName: true },
      });
    })(),
    // 60s-cached at the apps/api layer (allIndices.ts) — cheap to call on
    // every keystroke's debounced request.
    fetchAllIndices(),
  ]);

  const tradableIndexMatches = TRADABLE_INDEX_ENTRIES.filter(
    (e) => e.symbol.includes(needle) || e.companyName.toUpperCase().includes(needle)
  );

  const fuzzyStockMatches = fuzzyStockRows.filter((r) => r.symbol.toUpperCase() !== needle);

  const allIndexMatches = (allIndices?.indices ?? [])
    .filter((idx) => !(idx.slug in INDEX_SLUG_TO_TRADABLE_UNDERLYING))
    .filter((idx) => idx.name.toUpperCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_ALL_INDEX_MATCHES);

  const ordered: SearchResultItem[] = [
    ...(exactStock ? [{ href: `/instruments/${exactStock.symbol}`, label: exactStock.symbol, sublabel: exactStock.companyName }] : []),
    ...tradableIndexMatches.map((e) => ({ href: `/instruments/${e.symbol}`, label: e.symbol, sublabel: e.companyName })),
    ...fuzzyStockMatches.map((r) => ({ href: `/instruments/${r.symbol}`, label: r.symbol, sublabel: r.companyName })),
    ...allIndexMatches.map((idx) => ({ href: `/indices/${idx.slug}`, label: idx.name, sublabel: "Index" })),
  ];

  const results = ordered.slice(0, MAX_RESULTS);
  const response = NextResponse.json({ results });
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
