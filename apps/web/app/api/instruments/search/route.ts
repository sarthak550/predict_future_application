import { NextResponse } from "next/server";

import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";

import { prisma } from "@/lib/prisma";
import { fetchAllIndices } from "@/lib/finance/indices";
import { fetchLatestBseIndices } from "@/lib/finance/bseIndices";
import { INDEX_SLUG_TO_TRADABLE_UNDERLYING } from "@/lib/finance/indexTradableAlias";
import { getEtfNameMap, getEtfSymbolSet, searchEtfRegistryByName } from "@/lib/finance/etfRegistry";
import { isTradableOptionUnderlyingServer } from "@/lib/paperTrading/fnoUniverseServer";
import { isFuturesTradingEnabled, isOptionsTradingEnabled } from "@/lib/paperTrading/featureFlags";

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
 *  - "fund": ETF rows from the same store, membership decided by
 *    lib/finance/etfRegistry.ts's verified NSE registry (eq_etfseclist.csv —
 *    342 ETFs live as of 2026-08-12) rather than a name/symbol heuristic —
 *    the bhavcopy's EQ series carries listed ETFs alongside stocks with no
 *    distinct series marker, so the registry is the only reliable source.
 *  - "index": the 5 F&O-tradable indices AND, since Index History Stage 2
 *    (2026-08-11), every other NSE-published index — all link to
 *    /instruments/[symbol] now that every index has a full instrument page
 *    (self-owned daily OHLC at minimum, live Yahoo feed for the 35
 *    hand-verified ones — see business-rules' INDEX_UNIVERSE and
 *    lib/finance/indexLongTail.ts). /indices/[slug] (the slim directory)
 *    still exists and itself now links onward to /instruments/[symbol], but
 *    search no longer routes there directly — was the pre-Stage-2 behavior,
 *    when most indices had no instrument page yet. BSE Expansion Phase 2
 *    (2026-08-12) — all 133 BSE indices ALSO link to /instruments/[symbol]
 *    now (self-owned BseIndexEodQuote history at minimum, live Yahoo feed
 *    for the 18 BSE_INDEX_UNIVERSE ones), sourced from
 *    lib/finance/bseIndices.ts and clearly sublabeled "BSE index" so a
 *    result never reads as an NSE one.
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

/**
 * Empty-query defaults (founder spec: "one can have top stocks/indices
 * already there making search easier for popular assets") — the modal opens
 * pre-populated per tab: today's actual top movers for Stocks (live
 * MarketMoverSnapshot, popular universe), the 5 tradable indices + today's
 * biggest-moving informational indices, top ETFs by traded volume, and the
 * index option chains.
 */
async function buildDefaults(): Promise<NextResponse> {
  const [allIndices, bseIndices, latestMoverSession, latestEodSession, latestBondSession, etfSymbols] = await Promise.all([
    fetchAllIndices(),
    fetchLatestBseIndices(),
    prisma.marketMoverSnapshot.findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } }),
    prisma.stockEodQuote.findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } }),
    prisma.bondEodQuote.findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } }),
    getEtfSymbolSet(),
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
    latestEodSession && etfSymbols.size > 0
      ? prisma.stockEodQuote.findMany({
          where: {
            sessionDate: latestEodSession.sessionDate,
            symbol: { in: [...etfSymbols] },
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
  // BSE Expansion Phase 2 (2026-08-12) — top-moving BSE indices, same
  // "reserve a few default slots" shape as topMovingInfoIndices above,
  // clearly sublabeled so they never read as NSE results.
  const topMovingBseIndices = bseIndices
    .slice()
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 2);
  const indexResults: SearchResultItem[] = [
    ...TRADABLE_INDEX_ENTRIES.map((e) => ({
      href: `/instruments/${e.symbol}`,
      label: e.symbol,
      sublabel: e.companyName,
      category: "index" as const,
    })),
    ...topMovingInfoIndices.map((idx) => ({
      href: `/instruments/${deriveIndexSymbol(idx.name)}`,
      label: idx.name,
      sublabel: idx.changePercent != null ? pct(idx.changePercent) : "NSE index",
      category: "index" as const,
    })),
    ...topMovingBseIndices.map((idx) => ({
      href: `/instruments/${deriveIndexSymbol(idx.indexName)}`,
      label: idx.indexName,
      sublabel: `BSE index · ${pct(idx.changePercent)}`,
      category: "index" as const,
    })),
  ];

  // Founder 2026-08-12: fund results display their REAL registry names —
  // StockEodQuote.companyName for an ETF is the ticker duplicated.
  const etfNames = await getEtfNameMap();
  const fundResults: SearchResultItem[] = topFunds.map((r) => ({
    href: `/instruments/${r.symbol}`,
    label: r.symbol,
    sublabel: etfNames.get(r.symbol.toUpperCase()) ?? r.companyName,
    category: "fund" as const,
  }));

  // Founder 2026-08-12: while F&O is gated "coming soon", search must not
  // advertise option-chain/futures destinations (same rule as the index
  // pages' hidden tradable CTA — never link a user into a gated surface).
  // Flag-driven: launching options/futures restores these entries with
  // zero code changes.
  const optionResults: SearchResultItem[] = isOptionsTradingEnabled()
    ? TRADABLE_INDEX_ENTRIES.map((e) => ({
        href: `/paper-trading/options?underlying=${encodeURIComponent(e.symbol)}`,
        label: `${e.symbol} option chain`,
        sublabel: "Paper Trading",
        category: "option" as const,
      }))
    : [];

  const futureResults: SearchResultItem[] = isFuturesTradingEnabled()
    ? TRADABLE_INDEX_ENTRIES.map((e) => ({
        href: `/paper-trading/futures?underlying=${encodeURIComponent(e.symbol)}`,
        label: `${e.symbol} futures`,
        sublabel: "Paper Trading",
        category: "future" as const,
      }))
    : [];

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

  const [exactStock, fuzzyRows, allIndices, bseIndices, bondRows, etfSymbols] = await Promise.all([
    prisma.stockEodQuote.findFirst({
      where: { symbol: { equals: needle, mode: "insensitive" } },
      orderBy: { sessionDate: "desc" },
      select: { symbol: true, companyName: true, volume: true },
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
        // volume: ETF Layer (2026-08-12) — funds re-rank by liquidity below
        // (a broad query like "gold" matches 30+ ETFs alphabetically; the
        // household-name one, e.g. GOLDBEES, should surface over an
        // alphabetically-earlier but thinly-traded fund). Stocks keep their
        // existing alphabetical-then-exact-match order, unchanged.
        select: { symbol: true, companyName: true, volume: true },
      });
    })(),
    // 60s-cached at the apps/api layer (allIndices.ts).
    fetchAllIndices(),
    // BSE Expansion Phase 2 (2026-08-12) — the latest ingested session's full
    // BSE index set (~133 rows), filtered by name below same as NSE's
    // allIndices.
    fetchLatestBseIndices(),
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
    getEtfSymbolSet(),
  ]);

  // ── Indices ────────────────────────────────────────────────────────────────
  const tradableIndexMatches = TRADABLE_INDEX_ENTRIES.filter(
    (e) => e.symbol.includes(needle) || e.companyName.toUpperCase().includes(needle)
  );
  const infoIndexMatches = (allIndices?.indices ?? [])
    .filter((idx) => !(idx.slug in INDEX_SLUG_TO_TRADABLE_UNDERLYING))
    .filter((idx) => idx.name.toUpperCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  // BSE Expansion Phase 2 (2026-08-12) — same fuzzy name-contains match,
  // clearly sublabeled "BSE index" (never "NSE index") so a founder/user
  // searching e.g. "sensex" or "bankex" can tell the two apart at a glance.
  const bseIndexMatches = bseIndices
    .filter((idx) => idx.indexName.toUpperCase().includes(needle))
    .sort((a, b) => a.indexName.localeCompare(b.indexName));

  const indexResults: SearchResultItem[] = [
    ...tradableIndexMatches.map((e) => ({
      href: `/instruments/${e.symbol}`,
      label: e.symbol,
      sublabel: e.companyName,
      category: "index" as const,
    })),
    ...infoIndexMatches.map((idx) => ({
      href: `/instruments/${deriveIndexSymbol(idx.name)}`,
      label: idx.name,
      sublabel: "NSE index",
      category: "index" as const,
    })),
    ...bseIndexMatches.map((idx) => ({
      href: `/instruments/${deriveIndexSymbol(idx.indexName)}`,
      label: idx.indexName,
      sublabel: "BSE index",
      category: "index" as const,
    })),
  ].slice(0, MAX_PER_CATEGORY);

  // ── Stocks vs funds (ETFs split out of the same EQ-series store) ──────────
  const dedupedFuzzy = fuzzyRows.filter((r) => r.symbol.toUpperCase() !== needle);
  const orderedEquityRows = [...(exactStock ? [exactStock] : []), ...dedupedFuzzy];
  const stockResults: SearchResultItem[] = orderedEquityRows
    .filter((r) => !etfSymbols.has(r.symbol.toUpperCase()))
    .slice(0, MAX_PER_CATEGORY)
    .map((r) => ({ href: `/instruments/${r.symbol}`, label: r.symbol, sublabel: r.companyName, category: "stock" as const }));
  // Founder 2026-08-12: funds must be searchable by their REAL names, and
  // display them. StockEodQuote.companyName for an ETF is the ticker
  // duplicated (bhavcopy has no fund names), so (a) name-matched registry
  // entries are merged in as additional candidates the equity fuzzy query
  // could never find ("nippon", "bees", an underlying's name), and (b) every
  // fund result's sublabel prefers the registry securityName.
  const [etfNameMatches, etfNames] = await Promise.all([searchEtfRegistryByName(q), getEtfNameMap()]);
  const fuzzyFundRows = orderedEquityRows.filter((r) => etfSymbols.has(r.symbol.toUpperCase()));
  const fuzzyFundSymbols = new Set(fuzzyFundRows.map((r) => r.symbol.toUpperCase()));
  const nameOnlyFundRows = etfNameMatches
    .filter((e) => !fuzzyFundSymbols.has(e.symbol))
    .map((e) => ({ symbol: e.symbol, companyName: e.displayName, volume: 0 }));
  const fundResults: SearchResultItem[] = [...fuzzyFundRows, ...nameOnlyFundRows]
    // ETF Layer (2026-08-12) — re-rank by liquidity (see fuzzyRows' own
    // comment): a broad query can alphabetically match 30+ ETFs, and the
    // well-known, heavily-traded fund should surface over a thin one that
    // merely sorts earlier by name. Name-only registry matches carry no
    // same-session volume (volume 0) and so rank after ticker matches.
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MAX_PER_CATEGORY)
    .map((r) => ({
      href: `/instruments/${r.symbol}`,
      label: r.symbol,
      sublabel: etfNames.get(r.symbol.toUpperCase()) ?? r.companyName,
      category: "fund" as const,
    }));

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
