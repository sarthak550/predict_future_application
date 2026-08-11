import { nseSymbolMatchesInstrumentTicker, refineStockNews } from "@predict-future/business-rules";
import { computeReturnsStrip, type ReturnsStrip } from "@predict-future/business-rules/marketPulse/returns";
import { isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import {
  isIndexUniverseSymbol,
  normalizeIndexDisplayName,
  getIndexUniverseEntry,
  INDEX_UNIVERSE_OPINION_TICKER,
  INDEX_UNIVERSE_DISPLAY_NAME,
} from "@predict-future/business-rules/finance/indexUniverse";
import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import { EMPTY_INSTRUMENT_ENRICHMENT, getOrFetchInstrumentEnrichment, type InstrumentEnrichmentData } from "@/lib/finance/enrichment";
import { fetchIndexInstrumentSpark } from "@/lib/finance/fundamentals";
import { fetchIndexBySlug } from "@/lib/finance/indices";
import { getLongTailIndexBySymbol } from "@/lib/finance/indexLongTail";
import { TRADABLE_UNDERLYING_TO_INDEX_SLUG } from "@/lib/finance/indexTradableAlias";
import { hasIndexConstituentList, fetchIndexConstituents } from "@/lib/finance/indexConstituents";
import { getEtfRegistryEntry, getEtfsTrackingIndex, type EtfRegistryEntry } from "@/lib/finance/etfRegistry";
import { prisma } from "@/lib/prisma";

// Enough sessions for a 1Y timeframe on the interactive chart (~250 trading
// days) — the mobile API keeps its own smaller window.
const SPARK_SESSIONS = 260;
/** Index History Stage 3 (2026-08-12) — below this many self-owned sessions, a hasLiveIndexPipe index's daily chart prefers the Yahoo fetch instead (see `spark`'s own doc comment). Chosen well under a month of trading days — enough to distinguish "genuinely thin/just-backfilled" from "essentially empty" without discarding a real, if short, self-owned series in favor of Yahoo. */
const OWNED_SPARK_FLOOR = 30;
// 2026-08-09: bumped from 10 (founder: don't hard-cap news reading) — the
// instrument news tab now also supports "Load more" beyond this initial
// batch (PulseTabs' newsSymbol prop -> /api/pulse/news?symbol=), so this is
// purely the first-page size, not a hard ceiling.
const NEWS_LIMIT = 20;
/** Over-fetch factor before the refineStockNews quality pipeline (dedup/quality can only shrink the set). */
const NEWS_FETCH_MULTIPLE = 6;
const FILINGS_LIMIT = 10;
const OPINIONS_LIMIT = 100; // founder 2026-07-26: show ALL calls (card scrolls); 100 = sane hard cap per the unbounded-findMany audit rule
/** Opinions considered "recent enough to match" for both the returned list and the sentiment split. */
const OPINION_LOOKBACK_DAYS = 90;

export interface InstrumentQuote {
  sessionDate: Date;
  close: number;
  prevClose: number;
  changePercent: number;
  volume: number;
  deliveryPct: number | null;
}

export interface InstrumentSparkPoint {
  sessionDate: Date;
  close: number;
}

export interface InstrumentNewsRow {
  id: string;
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: Date;
  summary: string | null;
}

export interface InstrumentFilingRow {
  id: string;
  source: "NSE" | "BSE";
  tickerSymbol: string;
  companyName: string;
  eventType: string;
  headline: string;
  detailUrl: string | null;
  announcedAt: Date;
}

export interface InstrumentOpinionRow {
  id: string;
  quote: string;
  headline: string | null;
  instrument: string | null;
  instrumentTicker: string | null;
  sourceUrl: string;
  direction: OpinionDirection;
  publishedAt: Date;
  resolutionStatus: OpinionResolutionStatus;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  expert: { name: string; slug: string | null; organization: string };
}

export interface InstrumentSentiment {
  bullish: number;
  bearish: number;
  neutral: number;
  totalCount: number;
  /** Days the sentiment split is computed over — surfaced so the UI's copy always matches the actual window. */
  lookbackDays: number;
}

/**
 * Indices Consolidation (2026-08-12) Ask 2a — the metrics the retired slim
 * `/indices/[slug]` page used to show (open/high/low/prevClose, 52-week
 * range, P/E, dividend yield, advances/declines/unchanged), plus P/B for
 * free since the live allIndices snapshot (`IndexRow`) already carries it.
 * Sourced from that SAME snapshot for every index kind: the 35
 * hasLiveIndexPipe symbols look it up via their own slug (tradable ->
 * TRADABLE_UNDERLYING_TO_INDEX_SLUG, INDEX_UNIVERSE -> its own `slug`
 * field), the long tail reuses `longTailLiveQuote` (already fetched for the
 * quote header — see below, no second network call). Null for a plain
 * equity, or for an index whose snapshot fetch failed this request (never
 * fabricated).
 */
export interface InstrumentIndexMetrics {
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** ISO timestamp the snapshot this metrics object came from was fetched — the slim page's "As of HH:mm IST" line's new home. */
  asOf: string;
}

/**
 * Indices Consolidation (2026-08-12) Ask 2b, founder addendum — one row per
 * index constituent, joined against our own StockEodQuote so the panel can
 * show each member's latest close and day change (never a fabricated
 * weight — see lib/finance/indexConstituents.ts's module doc on why no
 * weight column exists). `close`/`changePercent` are null for a constituent
 * with no StockEodQuote row yet (delisted/renamed/thinly covered) — the
 * panel renders that row without its change columns rather than dropping
 * the member, per the founder's explicit instruction.
 */
export interface IndexConstituentQuoteRow {
  symbol: string;
  companyName: string;
  industry: string | null;
  close: number | null;
  changePercent: number | null;
}

export interface InstrumentDetail {
  symbol: string;
  companyName: string;
  quote: InstrumentQuote | null;
  spark: InstrumentSparkPoint[];
  news: InstrumentNewsRow[];
  filings: InstrumentFilingRow[];
  opinions: InstrumentOpinionRow[];
  sentiment: InstrumentSentiment;
  /**
   * Index History Stage 2 (2026-08-11) — true for ANY index page: the 5
   * F&O-tradable underlyings, the 30 INDEX_UNIVERSE view-only indices, AND
   * now every other NSE-published index this app has self-owned
   * IndexEodQuote history for (the "long tail" — see
   * lib/finance/indexLongTail.ts). False for a plain equity.
   */
  isIndex: boolean;
  /** True when `isIndex` AND this is NOT one of the 5 tradable underlyings — drives the "Index · View only" badge. Widened from the Sprint A `isViewOnlyIndex` page-local variable to also cover the long tail. */
  viewOnlyIndex: boolean;
  /**
   * True only for the 35 symbols with a verified-live Yahoo feed (tradable +
   * INDEX_UNIVERSE) — these alone get the live 1D intraday pipe
   * (`/api/instruments/index/[symbol]/intraday`) and QuoteHeader's live
   * overlay. The long tail has no Yahoo ticker (by design — see
   * indexLongTail.ts's module doc on why it's deliberately NOT
   * hand-verified like INDEX_UNIVERSE) and so renders daily-only, exactly
   * like an equity chart minus the intraday timeframe — `quote` above is
   * therefore the ONLY price source for a long-tail page (no live overlay
   * to fall back on), unlike the 35 where a null server `quote` is normal
   * and expected (the client-side live fetch fills it in).
   */
  hasLiveIndexPipe: boolean;
  /**
   * Instrument Page v2 (T3) — 1W/1M/3M/6M/1Y/FY-to-date returns computed
   * over `spark`. Was all-null for indices (no StockEodQuote series) until
   * Index History (2026-08-11) gave indices a real daily `spark` too — now
   * computed for both. No UI currently renders this field (PerformanceStrip
   * was pulled from the page 2026-08-02 per founder — see page.tsx's own
   * comment); kept computed since it's a pure, zero-extra-I/O derivation of
   * `spark` a future surface can read for free.
   */
  performance: ReturnsStrip;
  /** Instrument Page v2 (T4) — cached Yahoo fundamentals/dividends, read-through with a background refresh trigger. All-null for indices (not fetched — see fetchInstrumentDetail). */
  enrichment: InstrumentEnrichmentData;
  /** Indices Consolidation (2026-08-12) Ask 2a — see InstrumentIndexMetrics's own doc. Null for a plain equity. */
  indexMetrics: InstrumentIndexMetrics | null;
  /** Indices Consolidation (2026-08-12) Ask 2b — see IndexConstituentQuoteRow's own doc. Null for a plain equity OR an index with no verified constituent list (indexConstituents.ts). Sorted biggest-gainer-first, losers last, members with no quote row appended at the very end (see fetchInstrumentDetail's own sort comment). */
  indexComposition: IndexConstituentQuoteRow[] | null;
  /**
   * ETF Layer (2026-08-12) — true when this symbol is a registry-confirmed
   * ETF (lib/finance/etfRegistry.ts, sourced from NSE's own eq_etfseclist.csv
   * master). Mutually exclusive with `isIndex`: an ETF is a real
   * StockEodQuote row, priced/charted exactly like an equity — it never sets
   * `isIndex`. Drives the page's "ETF" badge and swaps `FundamentalsPanel`
   * for `EtfDetailsPanel` (an ETF has no income statement/CEO/employees to
   * show — see that component's own doc on what Yahoo actually returns for
   * an Indian ETF).
   */
  isEtf: boolean;
  /** Registry facts (Underlying/tracked index/listing date/ISIN/face value) for this ETF — null for a plain equity or an index. */
  etfDetails: EtfRegistryEntry | null;
  /** ETF Layer (2026-08-12) Ask 3 — every registry-confirmed ETF hand-verified to track THIS index. Always empty for a non-index page. */
  etfsTrackingIndex: EtfRegistryEntry[];
}

/**
 * Market Pulse Phase 2 — instrument tap-through detail. Mirrors the query
 * shape of GET /api/finance/instruments/[symbol] (apps/api) but runs Prisma
 * directly against the shared DB rather than hopping HTTP to apps/api, per
 * this app's SSR/ISR convention (see fetchTopMovers/fetchLatestNews in
 * lib/finance/marketPulse.ts, getSentimentSplit in lib/finance/sentiment.ts).
 * KEEP THE MATCHING LOGIC IN LOCKSTEP with that route: both filter
 * ExpertOpinion by a startsWith(`${symbol}.`) prefix on instrumentTicker,
 * re-verified in memory with the shared nseSymbolMatchesInstrumentTicker
 * matcher, and both apply the shared refineStockNews quality pipeline to
 * MarketMoveNews.
 *
 * Returns `null` when the symbol is entirely unknown — no quote AND no news
 * AND no filings AND no opinions in the lookback window. A symbol with
 * content but no quote yet (bhavcopy not seeded) still resolves — callers
 * render a "price data pending" state rather than notFound() in that case.
 */
/** Index instrument pages: display names + the instrumentTicker index opinions are actually stored under (verified in prod: Nifty 50 calls carry "^NSEI", Bank Nifty "^NSEBANK" — never "NIFTY.<suffix>"). */
const INDEX_DISPLAY_NAME: Record<string, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Nifty Bank",
  FINNIFTY: "Nifty Financial Services",
  MIDCPNIFTY: "Nifty Midcap Select",
  NIFTYNXT50: "Nifty Next 50",
  // Index Universe Expansion (Sprint A, 2026-08-09) — the 25 view-only
  // indices' display names, sourced from INDEX_UNIVERSE (business-rules)
  // rather than hand-duplicated here, so the two never drift.
  ...INDEX_UNIVERSE_DISPLAY_NAME,
};
const INDEX_OPINION_TICKER: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  // Index Identity Audit (2026-08-10) — FINNIFTY/MIDCPNIFTY/NIFTYNXT50 are
  // 3 of the 5 tradable underlyings (isIndexOptionUnderlying) and already
  // have their own page treatment (same as NIFTY/BANKNIFTY above), so they
  // deliberately stay OUT of INDEX_UNIVERSE (see that registry's own doc
  // comment on the decoupling rule) — but were missing from THIS map
  // entirely, meaning their opinions carried a ticker with nowhere to
  // resolve. Verified live against Yahoo's chart API (376 intraday 1m bars)
  // and cross-checked against NSE /api/allIndices exact `last` value
  // 2026-08-10: "NIFTY FINANCIAL SERVICES" = NIFTY_FIN_SERVICE.NS (26466.0
  // both sides — NOT "^CNXFIN", which is the DIFFERENT "NIFTY FINANCIAL
  // SERVICES 25/50" sub-index, 28901.8 both sides), "NIFTY MIDCAP SELECT" =
  // NIFTY_MID_SELECT.NS (14875.0), "NIFTY NEXT 50" = "^NSMIDCP" (74697.55 —
  // a misleadingly-named Yahoo ticker; verified by data match, not by name).
  FINNIFTY: "NIFTY_FIN_SERVICE.NS",
  MIDCPNIFTY: "NIFTY_MID_SELECT.NS",
  NIFTYNXT50: "^NSMIDCP",
  // Index Universe Expansion (Sprint A, 2026-08-09) — extends opinion-ticker
  // resolution to every qualifying index, inheriting the caret-ticker
  // matcher bypass below for free (see fetchInstrumentDetail's own comment
  // on why INDEX_OPINION_TICKER-resolved symbols skip
  // nseSymbolMatchesInstrumentTicker entirely).
  ...INDEX_UNIVERSE_OPINION_TICKER,
};

export async function fetchInstrumentDetail(rawSymbol: string): Promise<InstrumentDetail | null> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return null;
  // Index Universe Expansion (Sprint A, 2026-08-09) — broadened from
  // isIndexOptionUnderlying alone (the 5 tradable underlyings) to also
  // recognize any INDEX_UNIVERSE view-only index. isIndexOptionUnderlying
  // itself is UNTOUCHED — it still gates only the options/futures order
  // path elsewhere; this broader `isIndex` only controls this page's own
  // "does this symbol get index treatment" branches (skip StockEodQuote-only
  // enrichment, always resolve even with zero content yet, use the index
  // intraday chart endpoint).
  // hasLiveIndexPipe is exactly the OLD (Sprint A) `isIndex` — the 35
  // symbols with a verified-live Yahoo feed. UNCHANGED logic/behavior for
  // these; see the module doc on why this stays decoupled from the broader
  // Index History Stage 2 (2026-08-11) `isIndex` below.
  const hasLiveIndexPipe = isIndexOptionUnderlying(symbol) || isIndexUniverseSymbol(symbol);
  // Index History (2026-08-11), founder: "why don't we have indices history
  // as we have of stocks" — indices have no StockEodQuote row (that table is
  // NSE-equity-only), so `spark` was always empty for them; the chart ran
  // ONLY on the live 1D intraday pipe. INDEX_OPINION_TICKER (below) already
  // carries every hasLiveIndexPipe-true symbol's verified Yahoo ticker (it
  // doubles as the ExpertOpinion resolution ticker) — reused here as the
  // Yahoo chart ticker too, one identity for both jobs, never a second value
  // invented.
  const indexYahooTicker = hasLiveIndexPipe ? INDEX_OPINION_TICKER[symbol] : undefined;

  // Index History Stage 2 (2026-08-11) — the "long tail": every other
  // NSE-published index this app has self-owned IndexEodQuote history for
  // (see lib/finance/indexLongTail.ts). Only looked up when the symbol isn't
  // already one of the 35 (a plain equity falls into this branch too — the
  // lookup is a cached in-memory Map after the first call in any 5-minute
  // window, so the added cost for the overwhelming majority of page views
  // — equities — is negligible).
  const longTailEntry = hasLiveIndexPipe ? null : await getLongTailIndexBySymbol(symbol);
  const isLongTailIndex = longTailEntry != null;
  const isIndex = hasLiveIndexPipe || isLongTailIndex;
  const viewOnlyIndex = isIndex && !isIndexOptionUnderlying(symbol);
  // Index History Stage 3 (2026-08-12) — founder bug report: "/instruments/
  // NIFTYCEMENT — no price history." Root cause: 10 of the 35 hasLiveIndexPipe
  // Yahoo tickers (the NIFTY_*.NS quote-page family — CEMENT, CHEMICALS,
  // REITS_REALTY, MICROCAP250, TOTAL_MKT, FPI_150, HEALTHCARE, OIL_AND_GAS,
  // IND_DEFENCE, INDIA_MFG) serve a live price but only ONE daily bar over a
  // 1y window — Stage 1's live-verification bar (module doc above) proved
  // INTRADAY liveness, never daily-archive DEPTH, so this gap slipped past
  // it. Meanwhile Stage 2's backfill gave every one of the 163 published
  // indices (this hasLiveIndexPipe 35 included) 260 sessions of self-owned
  // IndexEodQuote history — the SAME table the long-tail branch already
  // trusts as ITS primary spark source below. `ownedIndexName` is this
  // symbol's join key into that table for EITHER branch: `INDEX_DISPLAY_NAME`
  // for the 35 (already the exact NSE name — see that map's own doc), or the
  // long-tail entry's own verbatim `name`. Resolved once, synchronously,
  // reused by the unified owned-spark/owned-quote fetch below.
  //
  // BUG CAUGHT DURING VERIFICATION: this must be the raw NSE `name`
  // (IndexEodQuote.indexName's own convention), NOT `INDEX_DISPLAY_NAME`
  // (human-cased `displayName`, built for UI headers — see INDEX_UNIVERSE's
  // own module doc on why the two fields diverge). They're case-identical
  // for 29 of the 30 INDEX_UNIVERSE entries, but NIFTY HEALTHCARE INDEX's
  // `displayName` ("Nifty Healthcare") drops the word "Index" entirely —
  // using it here silently zeroed that one index's owned-spark join and
  // regressed it to the pre-fix single-Yahoo-bar state (caught live:
  // /instruments/NIFTYHEALTHCAREINDEX rendered only 1D/MAX buttons after an
  // initial pass of this fix, while every sibling index got its full 1Y
  // chart). `getIndexUniverseEntry(symbol)?.name` is the verbatim field;
  // the tradable 5 aren't in INDEX_UNIVERSE at all (by design), so they
  // fall through to `INDEX_DISPLAY_NAME`, which — verified programmatically
  // against all 30 INDEX_UNIVERSE entries — IS name-identical to the
  // tradable 5's own raw NSE names ("Nifty 50", "Nifty Bank", etc).
  const ownedIndexName = hasLiveIndexPipe
    ? (getIndexUniverseEntry(symbol)?.name ?? INDEX_DISPLAY_NAME[symbol] ?? null)
    : (longTailEntry?.name ?? null);

  // Indices Consolidation (2026-08-12) Ask 2a — the /indices/[slug] directory
  // slug this hasLiveIndexPipe symbol's live allIndices snapshot metrics
  // (P/E, P/B, advances/declines/etc) live under. Tradable underlyings use a
  // short mnemonic /instruments/ code ("NIFTY") that isn't derivable from
  // their NSE name (same asymmetry indexLongTail.ts documents), so they need
  // the explicit reverse lookup; every INDEX_UNIVERSE entry already carries
  // its own `slug`. Null for a long-tail index (handled separately below via
  // `longTailLiveQuote`, already fetched for the quote header) or a plain
  // equity — no snapshot lookup attempted for either.
  const metricsSlug = hasLiveIndexPipe
    ? (TRADABLE_UNDERLYING_TO_INDEX_SLUG[symbol] ?? getIndexUniverseEntry(symbol)?.slug ?? null)
    : null;
  // Indices Consolidation (2026-08-12) Ask 2b — cheap sync check, so the
  // constituent CSV fetch (and the follow-up StockEodQuote join query below)
  // is skipped entirely for every plain equity and every index without a
  // hand-verified list (see indexConstituents.ts's coverage doc).
  const wantsConstituents = hasIndexConstituentList(symbol);

  const opinionSince = new Date(Date.now() - OPINION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [
    latestQuote,
    sparkRows,
    newsRows,
    filings,
    opinionCandidates,
    indexSparkRows,
    ownedEodRows,
    longTailLiveQuote,
    metricsSnapshotRow,
    constituentListRows,
    etfDetails,
    etfsTrackingIndex,
  ] = await Promise.all([
    prisma.stockEodQuote.findFirst({
      where: { symbol },
      orderBy: { sessionDate: "desc" },
    }),
    prisma.stockEodQuote.findMany({
      where: { symbol },
      orderBy: { sessionDate: "desc" },
      take: SPARK_SESSIONS,
      select: { sessionDate: true, close: true },
    }),
    prisma.marketMoveNews.findMany({
      where: { tickerSymbol: symbol },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: NEWS_LIMIT * NEWS_FETCH_MULTIPLE,
      select: {
        id: true,
        tickerSymbol: true,
        companyName: true,
        headline: true,
        publisher: true,
        sourceUrl: true,
        publishedAt: true,
        summary: true,
      },
    }),
    prisma.marketMoveEvent.findMany({
      where: { tickerSymbol: symbol },
      orderBy: [{ announcedAt: "desc" }, { id: "asc" }],
      take: FILINGS_LIMIT,
      select: {
        id: true,
        source: true,
        tickerSymbol: true,
        companyName: true,
        eventType: true,
        headline: true,
        detailUrl: true,
        announcedAt: true,
      },
    }),
    // See the apps/api route's identical comment: startsWith(`${symbol}.`) is
    // a safe exact match on the Yahoo-style instrumentTicker ("RELIANCE.NS"),
    // cheaper than the unfiltered all-tickers scans the movers routes already
    // run in production. No index on instrumentTicker exists yet — acceptable
    // at current table size, same as those routes.
    //
    // Index History Stage 2 (2026-08-11) — a long-tail index has NO Yahoo
    // ticker (by design), so ExpertOpinion.instrumentTicker has nothing to
    // resolve under for it. Falls back to matching the raw `instrument` TEXT
    // field against this index's own NSE name instead — same exact-match
    // discipline (never fuzzy) as INDEX_UNIVERSE's own
    // resolveIndexUniverseEntryByRawName/INDEX_NAME_ALIASES, just applied at
    // read-time here rather than via a backfill script (a long-tail index's
    // opinion volume is expected to be much thinner than the 35 curated
    // ones, so a live query is cheap and always current — no backfill
    // needed to keep it in sync).
    prisma.expertOpinion.findMany({
      where: {
        suppressedAt: null,
        ...(indexYahooTicker
          ? { instrumentTicker: { equals: indexYahooTicker } }
          : isLongTailIndex
            ? { instrument: { equals: longTailEntry!.name, mode: "insensitive" as const } }
            : { instrumentTicker: { startsWith: `${symbol}.`, mode: "insensitive" as const } }),
        publishedAt: { gte: opinionSince },
      },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        quote: true,
        headline: true,
        instrument: true,
        sourceUrl: true,
        instrumentTicker: true,
        direction: true,
        publishedAt: true,
        resolutionStatus: true,
        resolutionNote: true,
        resolvedAt: true,
        expert: { select: { name: true, slug: true, organization: true } },
      },
    }),
    // Index History (2026-08-11) — a no-op Promise for every non-index
    // symbol (zero extra network call for the overwhelming majority of page
    // views), so this array stays a single Promise.all alongside the
    // existing Prisma queries rather than a second awaited round.
    //
    // Index History Stage 3 (2026-08-12) — kept as a FALLBACK source now
    // (see `ownedIndexName`'s doc comment above and `spark`'s derivation
    // below): still fetched for every hasLiveIndexPipe symbol, but only used
    // when this symbol's self-owned archive is absent or thin.
    indexYahooTicker ? fetchIndexInstrumentSpark(indexYahooTicker) : Promise.resolve(null),
    // Index History Stage 3 (2026-08-12) — self-owned daily OHLC, now the
    // PRIMARY spark/quote source for EVERY index page (the 35
    // hasLiveIndexPipe symbols included, not just the long tail — see
    // `ownedIndexName`'s doc comment above on why the 35 needed this too).
    // Desc order (newest first) so `[0]` is the latest session without a
    // second query; `spark` reverses it below, same as `sparkRows`. Also
    // replaces the old separate `livePipeIndexQuote` single-row query below
    // — this one array now serves both jobs.
    isIndex && ownedIndexName
      ? prisma.indexEodQuote.findMany({
          where: { indexName: { equals: ownedIndexName, mode: "insensitive" } },
          orderBy: { sessionDate: "desc" },
          take: SPARK_SESSIONS,
          select: { sessionDate: true, close: true, changeAbs: true, changePercent: true, volume: true },
        })
      : Promise.resolve(null),
    // Index History Stage 2 (2026-08-11) — live level/change from NSE's own
    // /api/allIndices snapshot (via the existing apps/web->apps/api loopback
    // in lib/finance/indices.ts, already used by /indices/[slug]), preferred
    // over yesterday's IndexEodQuote close for `quote` freshness during/after
    // a live session — see the brief's own "quote header from the live
    // allIndices snapshot" instruction. Best-effort: fetchIndexBySlug never
    // throws, returns null on any upstream failure, in which case `quote`
    // simply falls back to the self-owned IndexEodQuote row below.
    isLongTailIndex ? fetchIndexBySlug(longTailEntry!.slug) : Promise.resolve(null),
    // Indices Consolidation (2026-08-12) Ask 2a — the SAME live allIndices
    // snapshot fetch as `longTailLiveQuote` above, just keyed by `metricsSlug`
    // for the 35 hasLiveIndexPipe symbols instead (long-tail already covered
    // via `longTailLiveQuote`, so this is a no-op Promise for it). A no-op
    // for every plain equity too.
    metricsSlug ? fetchIndexBySlug(metricsSlug) : Promise.resolve(null),
    // Indices Consolidation (2026-08-12) Ask 2b — constituent CSV, 24h
    // in-module cached (indexConstituents.ts) so this is a near-zero-cost
    // in-memory read on every request but the first per index per day. A
    // no-op Promise for any symbol without a verified list.
    wantsConstituents ? fetchIndexConstituents(symbol) : Promise.resolve(null),
    // ETF Layer (2026-08-12) — a no-op Promise for every index (an index is
    // never itself an ETF); cheap in-memory Map lookup after the registry's
    // first fetch in any 24h window for every equity/ETF symbol.
    isIndex ? Promise.resolve(null) : getEtfRegistryEntry(symbol),
    // ETF Layer (2026-08-12) Ask 3 — a no-op Promise for every non-index page.
    isIndex ? getEtfsTrackingIndex(symbol) : Promise.resolve([]),
  ]);

  // Belt-and-suspenders re-check with the shared matcher, same as the API
  // route — EXCEPT for a symbol resolved via INDEX_OPINION_TICKER above
  // (NIFTY/BANKNIFTY), whose query already used an EXACT ticker equality,
  // not a prefix match. Real bug found 2026-08-09 (founder: "I can't see
  // opinions on NIFTY 50"): nseSymbolMatchesInstrumentTicker strips a
  // trailing ".NS"/".BO"-style suffix to compare bare symbols
  // (packages/business-rules/src/marketPulse/instrumentMatch.ts) — it has
  // no notion of a caret-prefixed index ticker like "^NSEI", so it silently
  // rejected every one of the 300+ real NIFTY 50 opinions that DID match
  // the query above. The query's `equals: "^NSEI"` is already provably
  // exact; re-verifying it through a matcher built for a different ticker
  // shape is both redundant and wrong here.
  const matchedOpinions = opinionCandidates.filter((o) => {
    const indexTicker = INDEX_OPINION_TICKER[symbol];
    if (indexTicker) return o.instrumentTicker === indexTicker;
    // Index History Stage 2 (2026-08-11) — long-tail match is by `instrument`
    // text, not `instrumentTicker` (see the query's own comment above).
    if (isLongTailIndex) {
      return o.instrument != null && normalizeIndexDisplayName(o.instrument) === normalizeIndexDisplayName(longTailEntry!.name);
    }
    if (o.instrumentTicker == null) return false;
    return nseSymbolMatchesInstrumentTicker(symbol, o.instrumentTicker);
  });

  const news = refineStockNews(newsRows, { limit: NEWS_LIMIT });

  // A known index ALWAYS resolves (a tradable/view-only page renders a live
  // 1D chart, a long-tail page renders its own self-owned OHLC history) even
  // with zero stored content — the null gate only applies to unknown symbols.
  const hasAnyContent = latestQuote != null || news.length > 0 || filings.length > 0 || matchedOpinions.length > 0;
  if (!hasAnyContent && !isIndex) return null;

  // ETF Layer (2026-08-12) — an ETF's StockEodQuote.companyName is just its
  // bare symbol (bhavcopy resolves company names off the EQUITY master,
  // which doesn't carry fund names — verified live: NIFTYBEES/GOLDBEES/
  // BANKBEES/etc all store companyName === symbol today). Prefer NSE's own
  // registry SecurityName over that no-op fallback; overridden below with
  // Yahoo's `price.longName` (a fuller, better-cased fund name — see
  // fundamentals.ts's KeyStats.yahooLongName doc) once enrichment resolves.
  let companyName =
    INDEX_DISPLAY_NAME[symbol] ??
    longTailEntry?.name ??
    (etfDetails && latestQuote?.companyName === symbol ? etfDetails.securityName : latestQuote?.companyName) ??
    filings[0]?.companyName ??
    newsRows[0]?.companyName ??
    symbol;

  // Index History Stage 2 (2026-08-11) — a long-tail index has no live
  // intraday pipe (hasLiveIndexPipe is false), so unlike the 35 where a null
  // server `quote` is normal and expected (the client fills it in), THIS is
  // the only price source the page will ever render. Self-owned
  // IndexEodQuote is primary; the live /api/allIndices snapshot
  // (`longTailLiveQuote`) overrides level/change when available for
  // same-day freshness, per the brief's own instruction. `changeAbs` (not
  // `close`) is what NSE's daily file actually reports as the day's
  // points-change, so prevClose is derived (close - changeAbs) rather than
  // stored separately — same derivation IndexEodQuote's own schema doc uses.
  // Founder 2026-08-12: "As of date is missing on indices pages" — the 35
  // hasLiveIndexPipe pages shipped a null server quote by design (the
  // client live pipe fills the level), which also dropped the dated
  // "closed at … on <date>" header line equities always show. They now
  // have their own IndexEodQuote rows (Stage 2), so synthesize the server
  // quote from the latest self-owned row — the client overlay still
  // freshens the level; the honest session date renders server-side.
  //
  // Index History Stage 3 (2026-08-12) — this block used to be TWO separate
  // near-identical derivations (`livePipeIndexQuote`, one extra findFirst
  // query, for the 35; `longTailQuote` for the long tail). Unified into one:
  // both branches now source their latest row from the SAME `ownedEodRows`
  // array fetched above (`ownedEodRows?.[0]`, desc order), so the extra
  // findFirst query is gone entirely. `liveSnapshot` is the SAME live
  // /api/allIndices snapshot fetch either branch already had
  // (`metricsSnapshotRow` for the 35, `longTailLiveQuote` for the long tail
  // — see `metricsSlug`'s doc comment) — reused here for same-day freshness
  // AND below for `indexMetrics`, rather than re-branched twice.
  const liveSnapshot = isLongTailIndex ? longTailLiveQuote : metricsSnapshotRow;
  let ownedQuote: InstrumentQuote | null = null;
  if (isIndex) {
    const latestRow = ownedEodRows?.[0] ?? null;
    if (latestRow) {
      const selfPrevClose = latestRow.close - latestRow.changeAbs;
      const liveLast = liveSnapshot?.last;
      ownedQuote = {
        sessionDate: latestRow.sessionDate,
        close: liveLast ?? latestRow.close,
        prevClose: liveLast != null ? (liveSnapshot?.previousClose ?? selfPrevClose) : selfPrevClose,
        changePercent: liveLast != null ? (liveSnapshot?.changePercent ?? latestRow.changePercent) : latestRow.changePercent,
        volume: latestRow.volume ?? 0,
        deliveryPct: null,
      };
    } else if (liveSnapshot?.last != null) {
      // Backfill hasn't reached this index yet, but the live snapshot has
      // it — still show a real level rather than "price data pending".
      ownedQuote = {
        sessionDate: new Date(),
        close: liveSnapshot.last,
        prevClose: liveSnapshot.previousClose ?? liveSnapshot.last,
        changePercent: liveSnapshot.changePercent ?? 0,
        volume: 0,
        deliveryPct: null,
      };
    }
  }

  const sentimentCounts = matchedOpinions.reduce(
    (acc, o) => {
      if (o.direction === "BULLISH") acc.bullish += 1;
      else if (o.direction === "BEARISH") acc.bearish += 1;
      else acc.neutral += 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );

  // Index History Stage 3 (2026-08-12) — founder bug report (see
  // `ownedIndexName`'s doc comment above): self-owned IndexEodQuote is now
  // the PRIMARY spark source for EVERY index, not just the long tail. Yahoo
  // (`indexSparkRows`) is kept ONLY as a fallback for a hasLiveIndexPipe
  // symbol whose self-owned archive is absent or thin (< OWNED_SPARK_FLOOR
  // sessions) — never the reverse, and never for the long tail (which has
  // no Yahoo ticker at all — `indexSparkRows` is always null there, so this
  // reduces to the unchanged long-tail behavior). `sparkRows` (StockEodQuote)
  // stays the equity-only path, untouched.
  const ownedSpark = (ownedEodRows ?? []).slice().reverse().map((r) => ({ sessionDate: r.sessionDate, close: r.close }));
  const spark = isIndex
    ? ownedSpark.length >= OWNED_SPARK_FLOOR
      ? ownedSpark
      : (indexSparkRows ?? ownedSpark)
    : sparkRows.slice().reverse();

  // Instrument Page v2 (T3) — pure, zero extra query/network call over the
  // spark series already resolved above (equity or index).
  const performance = computeReturnsStrip(spark, latestQuote?.sessionDate);

  // Instrument Page v2 (T4) — indices have no financial statements/dividend
  // history to enrich; skip the Yahoo/DB round trip entirely rather than
  // fetching fundamentals for "^NSEI.NS". (Unrelated to the daily price
  // history above, which indices DO now get — see `spark`.)
  const enrichment = isIndex ? EMPTY_INSTRUMENT_ENRICHMENT : await getOrFetchInstrumentEnrichment(symbol, companyName);
  // ETF Layer (2026-08-12) — Yahoo's fund long name, when cached, beats both
  // the registry SecurityName and the bare-symbol fallback above.
  if (etfDetails && enrichment.keyStats?.yahooLongName) {
    companyName = enrichment.keyStats.yahooLongName;
  }

  // Indices Consolidation (2026-08-12) Ask 2a — both branches read off the
  // SAME IndexRow shape (`fetchIndexBySlug`'s return type). Sourced from
  // `liveSnapshot`, computed once above (Index History Stage 3) and shared
  // with `ownedQuote`'s derivation rather than re-branched a second time.
  const indexMetrics: InstrumentIndexMetrics | null = liveSnapshot
    ? {
        peRatio: liveSnapshot.peRatio,
        pbRatio: liveSnapshot.pbRatio,
        dividendYield: liveSnapshot.dividendYield,
        advances: liveSnapshot.advances,
        declines: liveSnapshot.declines,
        unchanged: liveSnapshot.unchanged,
        open: liveSnapshot.open,
        high: liveSnapshot.high,
        low: liveSnapshot.low,
        previousClose: liveSnapshot.previousClose,
        yearHigh: liveSnapshot.yearHigh,
        yearLow: liveSnapshot.yearLow,
        asOf: liveSnapshot.asOf,
      }
    : null;

  // Indices Consolidation (2026-08-12) Ask 2b, founder addendum — the price
  // join is a SECOND awaited step (not folded into the Promise.all above)
  // because it depends on `constituentListRows`, which that same Promise.all
  // just resolved. Bounded single query (`in: constituentSymbols`, at most
  // ~750 rows for NIFTY TOTAL MARKET) — never an unbounded findMany.
  let indexComposition: IndexConstituentQuoteRow[] | null = null;
  if (constituentListRows && constituentListRows.length > 0) {
    const constituentSymbols = constituentListRows.map((r) => r.symbol);
    const constituentQuotes = await prisma.stockEodQuote.findMany({
      where: { symbol: { in: constituentSymbols } },
      orderBy: [{ symbol: "asc" }, { sessionDate: "desc" }],
      distinct: ["symbol"],
      select: { symbol: true, close: true, changePercent: true },
    });
    const quoteBySymbol = new Map(constituentQuotes.map((q) => [q.symbol, q]));
    const joined: IndexConstituentQuoteRow[] = constituentListRows.map((c) => {
      const q = quoteBySymbol.get(c.symbol);
      return {
        symbol: c.symbol,
        companyName: c.companyName,
        industry: c.industry,
        close: q?.close ?? null,
        changePercent: q?.changePercent ?? null,
      };
    });
    // Design call (founder addendum, 2026-08-12): "change-ordered beats
    // alphabetical" — biggest gainers first, biggest losers last. A member
    // with no StockEodQuote row yet has no change to rank by, so it's
    // grouped at the very end rather than interleaved into the ranked
    // portion — never dropped (still a real member), just not orderable.
    const ranked = joined
      .filter((r) => r.changePercent != null)
      .sort((a, b) => (b.changePercent as number) - (a.changePercent as number));
    const unranked = joined.filter((r) => r.changePercent == null);
    indexComposition = [...ranked, ...unranked];
  }

  return {
    symbol,
    companyName,
    quote: isIndex ? ownedQuote : latestQuote,
    spark,
    news,
    filings,
    opinions: matchedOpinions.slice(0, OPINIONS_LIMIT).map((o) => ({
      id: o.id,
      quote: o.quote,
      headline: o.headline,
      instrument: o.instrument,
      instrumentTicker: o.instrumentTicker,
      sourceUrl: o.sourceUrl,
      direction: o.direction,
      publishedAt: o.publishedAt,
      resolutionStatus: o.resolutionStatus,
      resolutionNote: o.resolutionNote,
      resolvedAt: o.resolvedAt,
      expert: { name: o.expert.name, slug: o.expert.slug, organization: canonicalizeOrgDisplay(o.expert.organization) },
    })),
    sentiment: {
      ...sentimentCounts,
      totalCount: matchedOpinions.length,
      lookbackDays: OPINION_LOOKBACK_DAYS,
    },
    performance,
    enrichment,
    isIndex,
    viewOnlyIndex,
    hasLiveIndexPipe,
    indexMetrics,
    indexComposition,
    isEtf: etfDetails != null,
    etfDetails,
    etfsTrackingIndex,
  };
}
