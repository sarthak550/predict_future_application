import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { fetchAllIndices } from "@/lib/finance/indices";
import { INDEX_SLUG_TO_TRADABLE_UNDERLYING } from "@/lib/finance/indexTradableAlias";
import { isTradableOptionUnderlyingServer } from "@/lib/paperTrading/fnoUniverseServer";

/**
 * GET /api/instruments/search?q= — global nav-bar search (public), CATEGORIZED
 * per founder spec 2026-07-25: the dropdown shows filter chips
 * All / Indices / Stocks / Funds / Bonds / Futures / Options, so every result
 * carries a `category`. The client renders chips + filters; ALL routing is
 * decided here (each result ships a ready `href`).
 *
 * Categories and their honest limits:
 *  - "stock": StockEodQuote equities (exact-symbol match ranked first — a
 *    "REL" query must never push RELIANCE out of the window; found live).
 *  - "fund": ETF rows from the same store, split out by name/symbol heuristic
 *    (companyName contains ETF/FUND/BEES or symbol ends IETF/BEES/ETF) — the
 *    bhavcopy's EQ series carries listed ETFs alongside stocks.
 *  - "index": the 5 F&O-tradable indices (→ /instruments/[symbol], richer
 *    page) + all other NSE-published indices (→ /indices/[slug]).
 *  - "option": for any F&O-eligible match (stock or index), a direct link
 *    into its option chain on the options terminal.
 *  - "bond" / "future": no data yet (bonds: we only ingest the EQ series;
 *    futures: launching with Phase 4) — the client shows an honest empty
 *    state for these chips; this route returns none.
 */

type SearchCategory = "index" | "stock" | "fund" | "option";

type SearchResultItem = {
  href: string;
  label: string;
  sublabel: string | null;
  category: SearchCategory;
};

const TRADABLE_INDEX_ENTRIES: { symbol: string; companyName: string }[] = [
  { symbol: "NIFTY", companyName: "Nifty 50" },
  { symbol: "BANKNIFTY", companyName: "Nifty Bank" },
  { symbol: "FINNIFTY", companyName: "Nifty Financial Services" },
  { symbol: "MIDCPNIFTY", companyName: "Nifty Midcap Select" },
  { symbol: "NIFTYNXT50", companyName: "Nifty Next 50" },
];

const MAX_PER_CATEGORY = 6;
const MAX_ALL_VIEW = 10;
/** Over-fetch the fuzzy DB query so the fund/stock split + exact-match dedupe never starve the visible list. */
const FUZZY_FETCH = 30;

function isFundRow(row: { symbol: string; companyName: string }): boolean {
  const name = row.companyName.toUpperCase();
  const sym = row.symbol.toUpperCase();
  return (
    /\bETF\b|EXCHANGE TRADED|MUTUAL FUND|\bBEES\b/.test(name) ||
    sym.endsWith("ETF") ||
    sym.endsWith("IETF") ||
    sym.endsWith("BEES")
  );
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const needle = q.toUpperCase();

  const [exactStock, fuzzyRows, allIndices] = await Promise.all([
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
        take: FUZZY_FETCH,
        select: { symbol: true, companyName: true },
      });
    })(),
    // 60s-cached at the apps/api layer (allIndices.ts).
    fetchAllIndices(),
  ]);

  // ── Indices ────────────────────────────────────────────────────────────────
  const tradableIndexMatches = TRADABLE_INDEX_ENTRIES.filter(
    (e) => e.symbol.includes(needle) || e.companyName.toUpperCase().includes(needle)
  );
  const infoIndexMatches = (allIndices?.indices ?? [])
    .filter((idx) => !(idx.slug in INDEX_SLUG_TO_TRADABLE_UNDERLYING))
    .filter((idx) => idx.name.toUpperCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const indexResults: SearchResultItem[] = [
    ...tradableIndexMatches.map((e) => ({
      href: `/instruments/${e.symbol}`,
      label: e.symbol,
      sublabel: e.companyName,
      category: "index" as const,
    })),
    ...infoIndexMatches.map((idx) => ({
      href: `/indices/${idx.slug}`,
      label: idx.name,
      sublabel: "NSE index",
      category: "index" as const,
    })),
  ].slice(0, MAX_PER_CATEGORY);

  // ── Stocks vs funds (ETFs split out of the same EQ-series store) ──────────
  const dedupedFuzzy = fuzzyRows.filter((r) => r.symbol.toUpperCase() !== needle);
  const orderedEquityRows = [...(exactStock ? [exactStock] : []), ...dedupedFuzzy];
  const stockResults: SearchResultItem[] = orderedEquityRows
    .filter((r) => !isFundRow(r))
    .slice(0, MAX_PER_CATEGORY)
    .map((r) => ({ href: `/instruments/${r.symbol}`, label: r.symbol, sublabel: r.companyName, category: "stock" as const }));
  const fundResults: SearchResultItem[] = orderedEquityRows
    .filter((r) => isFundRow(r))
    .slice(0, MAX_PER_CATEGORY)
    .map((r) => ({ href: `/instruments/${r.symbol}`, label: r.symbol, sublabel: r.companyName, category: "fund" as const }));

  // ── Options: direct chain links for F&O-eligible matches ──────────────────
  const optionCandidateSymbols = [
    ...tradableIndexMatches.map((e) => e.symbol),
    ...stockResults.slice(0, 4).map((r) => r.label),
  ];
  const optionEligibility = await Promise.all(
    optionCandidateSymbols.map(async (sym) => ({ sym, ok: await isTradableOptionUnderlyingServer(sym) }))
  );
  const optionResults: SearchResultItem[] = optionEligibility
    .filter((e) => e.ok)
    .slice(0, MAX_PER_CATEGORY)
    .map((e) => ({
      href: `/paper-trading/options?underlying=${encodeURIComponent(e.sym)}`,
      label: `${e.sym} option chain`,
      sublabel: "Paper Trading",
      category: "option" as const,
    }));

  // "All" view: indices and options get reserved presence so fuzzy stock
  // volume can't starve them (the NIFTY METAL lesson).
  const allView: SearchResultItem[] = [
    ...stockResults.slice(0, 1),
    ...indexResults.slice(0, 3),
    ...stockResults.slice(1),
    ...fundResults.slice(0, 2),
    ...optionResults.slice(0, 2),
  ].slice(0, MAX_ALL_VIEW);

  const response = NextResponse.json({
    // Client chips filter on `category`; `all` is the pre-ranked default view.
    results: allView,
    byCategory: {
      index: indexResults,
      stock: stockResults,
      fund: fundResults,
      option: optionResults,
      bond: [],
      future: [],
    },
  });
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
