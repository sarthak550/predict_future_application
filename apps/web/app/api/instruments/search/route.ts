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
 *  - "future": Phase 4 (Sprint 2) — the 5 index futures (same registry as
 *    "option"'s tradable indices), a direct link into the futures terminal.
 *    Stock futures are cut this phase (see the Phase 4 brief) so this
 *    category is index-only, unlike "option" which also covers stocks.
 *  - "bond": Bonds informational layer (GS Government Securities + GB
 *    Sovereign Gold Bonds) — fuzzy match against BondEodQuote's latest
 *    session by symbol/displayName, → /bonds/[symbol]. Informational only,
 *    never a paper-trading link (unlike option/future above). NOT tradable.
 */

type SearchCategory = "index" | "stock" | "fund" | "option" | "future" | "bond";

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

/**
 * Empty-query defaults (founder spec: "one can have top stocks/indices
 * already there making search easier for popular assets") — the modal opens
 * pre-populated per tab: today's actual top movers for Stocks (live
 * MarketMoverSnapshot, popular universe), the 5 tradable indices + today's
 * biggest-moving informational indices, top ETFs by traded volume, and the
 * index option chains.
 */
async function buildDefaults(): Promise<NextResponse> {
  const [allIndices, latestMoverSession, latestEodSession, latestBondSession] = await Promise.all([
    fetchAllIndices(),
    prisma.marketMoverSnapshot.findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } }),
    prisma.stockEodQuote.findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } }),
    prisma.bondEodQuote.findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } }),
  ]);

  const [gainers, losers, topFunds, topBonds] = await Promise.all([
    latestMoverSession
      ? prisma.marketMoverSnapshot.findMany({
          where: { sessionDate: latestMoverSession.sessionDate, universe: "POPULAR", direction: "GAINER" },
          orderBy: { changePercent: "desc" },
          take: 3,
          select: { tickerSymbol: true, companyName: true, changePercent: true },
        })
      : [],
    latestMoverSession
      ? prisma.marketMoverSnapshot.findMany({
          where: { sessionDate: latestMoverSession.sessionDate, universe: "POPULAR", direction: "LOSER" },
          orderBy: { changePercent: "asc" },
          take: 3,
          select: { tickerSymbol: true, companyName: true, changePercent: true },
        })
      : [],
    latestEodSession
      ? prisma.stockEodQuote.findMany({
          where: {
            sessionDate: latestEodSession.sessionDate,
            OR: [{ symbol: { endsWith: "ETF" } }, { symbol: { endsWith: "BEES" } }, { symbol: { endsWith: "IETF" } }],
          },
          orderBy: { volume: "desc" },
          take: MAX_PER_CATEGORY,
          select: { symbol: true, companyName: true },
        })
      : [],
    // "Popular/most-traded" default per the Bonds brief T4 — by volume, same cap as every other category's defaults.
    latestBondSession
      ? prisma.bondEodQuote.findMany({
          where: { sessionDate: latestBondSession.sessionDate },
          orderBy: { volume: "desc" },
          take: MAX_PER_CATEGORY,
          select: { symbol: true, displayName: true, changePercent: true },
        })
      : [],
  ]);

  const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}% today`;

  const stockResults: SearchResultItem[] = [...gainers, ...losers].map((m) => ({
    href: `/instruments/${m.tickerSymbol}`,
    label: m.tickerSymbol,
    sublabel: `${m.companyName} · ${pct(m.changePercent)}`,
    category: "stock" as const,
  }));

  const topMovingInfoIndices = (allIndices?.indices ?? [])
    .filter((idx) => !(idx.slug in INDEX_SLUG_TO_TRADABLE_UNDERLYING))
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, 3);
  const indexResults: SearchResultItem[] = [
    ...TRADABLE_INDEX_ENTRIES.map((e) => ({
      href: `/instruments/${e.symbol}`,
      label: e.symbol,
      sublabel: e.companyName,
      category: "index" as const,
    })),
    ...topMovingInfoIndices.map((idx) => ({
      href: `/indices/${idx.slug}`,
      label: idx.name,
      sublabel: idx.changePercent != null ? pct(idx.changePercent) : "NSE index",
      category: "index" as const,
    })),
  ];

  const fundResults: SearchResultItem[] = topFunds.map((r) => ({
    href: `/instruments/${r.symbol}`,
    label: r.symbol,
    sublabel: r.companyName,
    category: "fund" as const,
  }));

  const optionResults: SearchResultItem[] = TRADABLE_INDEX_ENTRIES.map((e) => ({
    href: `/paper-trading/options?underlying=${encodeURIComponent(e.symbol)}`,
    label: `${e.symbol} option chain`,
    sublabel: "Paper Trading",
    category: "option" as const,
  }));

  const futureResults: SearchResultItem[] = TRADABLE_INDEX_ENTRIES.map((e) => ({
    href: `/paper-trading/futures?underlying=${encodeURIComponent(e.symbol)}`,
    label: `${e.symbol} futures`,
    sublabel: "Paper Trading",
    category: "future" as const,
  }));

  const bondResults: SearchResultItem[] = topBonds.map((b) => ({
    href: `/bonds/${b.symbol}`,
    label: b.displayName,
    sublabel: `${b.symbol} · ${pct(b.changePercent)}`,
    category: "bond" as const,
  }));

  const allView: SearchResultItem[] = [
    ...indexResults.slice(0, 2),
    ...stockResults.slice(0, 4),
    ...indexResults.slice(5, 7),
    ...fundResults.slice(0, 1),
    ...optionResults.slice(0, 1),
  ].slice(0, MAX_ALL_VIEW);

  const response = NextResponse.json({
    results: allView,
    byCategory: { index: indexResults, stock: stockResults, fund: fundResults, option: optionResults, bond: bondResults, future: futureResults },
  });
  response.headers.set("Cache-Control", "public, max-age=120");
  return response;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return buildDefaults();
  }

  const needle = q.toUpperCase();

  const [exactStock, fuzzyRows, allIndices, bondRows] = await Promise.all([
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
    // Bonds: fuzzy match against symbol OR the parsed displayName (so "GOI" /
    // "gold bond"-style queries surface results, not just raw NSE symbols).
    (async () => {
      const latest = await prisma.bondEodQuote.findFirst({
        orderBy: { sessionDate: "desc" },
        select: { sessionDate: true },
      });
      if (!latest) return [];
      return prisma.bondEodQuote.findMany({
        where: {
          sessionDate: latest.sessionDate,
          OR: [{ symbol: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }],
        },
        orderBy: { symbol: "asc" },
        take: MAX_PER_CATEGORY,
        select: { symbol: true, displayName: true, changePercent: true },
      });
    })(),
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

  // ── Futures: index-only (stock futures cut this phase) ────────────────────
  const futureResults: SearchResultItem[] = tradableIndexMatches.slice(0, MAX_PER_CATEGORY).map((e) => ({
    href: `/paper-trading/futures?underlying=${encodeURIComponent(e.symbol)}`,
    label: `${e.symbol} futures`,
    sublabel: "Paper Trading",
    category: "future" as const,
  }));

  // ── Bonds: informational only, no F&O/paper-trading link ───────────────────
  const bondResults: SearchResultItem[] = bondRows.slice(0, MAX_PER_CATEGORY).map((b) => ({
    href: `/bonds/${b.symbol}`,
    label: b.displayName,
    sublabel: `${b.symbol} · ${b.changePercent >= 0 ? "+" : ""}${b.changePercent.toFixed(2)}% today`,
    category: "bond" as const,
  }));

  // "All" view: indices and options get reserved presence so fuzzy stock
  // volume can't starve them (the NIFTY METAL lesson). Bonds get one reserved
  // slot so a genuine GOI/gold-bond match surfaces in the All view too,
  // without displacing the existing stock/index/fund/option/future budget.
  const allView: SearchResultItem[] = [
    ...stockResults.slice(0, 1),
    ...indexResults.slice(0, 3),
    ...stockResults.slice(1),
    ...fundResults.slice(0, 2),
    ...optionResults.slice(0, 2),
    ...futureResults.slice(0, 1),
    ...bondResults.slice(0, 1),
  ].slice(0, MAX_ALL_VIEW);

  const response = NextResponse.json({
    // Client chips filter on `category`; `all` is the pre-ranked default view.
    results: allView,
    byCategory: {
      index: indexResults,
      stock: stockResults,
      fund: fundResults,
      option: optionResults,
      bond: bondResults,
      future: futureResults,
    },
  });
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
