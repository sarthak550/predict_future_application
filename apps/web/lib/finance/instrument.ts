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
import {
  isBseIndexUniverseSymbol,
  getBseIndexUniverseEntry,
  BSE_INDEX_UNIVERSE_OPINION_TICKER,
  BSE_INDEX_UNIVERSE_DISPLAY_NAME,
} from "@predict-future/business-rules/finance/bseIndexUniverse";
import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import { EMPTY_INSTRUMENT_ENRICHMENT, getOrFetchInstrumentEnrichment, type InstrumentEnrichmentData } from "@/lib/finance/enrichment";
import { fetchIndexInstrumentSpark } from "@/lib/finance/fundamentals";
import { fetchIndexBySlug } from "@/lib/finance/indices";
import { getLongTailIndexBySymbol } from "@/lib/finance/indexLongTail";
import { getBseLongTailIndexBySymbol } from "@/lib/finance/bseIndexLongTail";
import { TRADABLE_UNDERLYING_TO_INDEX_SLUG } from "@/lib/finance/indexTradableAlias";
import { hasIndexConstituentList, fetchIndexConstituents } from "@/lib/finance/indexConstituents";
import { hasBseIndexConstituents, fetchBseIndexConstituents } from "@/lib/finance/bseIndexConstituents";
import { getEtfRegistryEntry, getEtfsTrackingIndex, type EtfRegistryEntry } from "@/lib/finance/etfRegistry";
import { getBseFundRegistryEntry, getBseFundsTrackingIndex, type BseFundRegistryEntry } from "@/lib/finance/bseFundRegistry";
import { getIndexMembership, type IndexMembershipEntry } from "@/lib/finance/indexMembership";
import {
  isBseEquitySymbolShape,
  bareBseEquityTicker,
  clearsBseEquityFloor,
  bseEquityTurnover,
  BSE_EQUITY_FLOOR_WINDOW_SESSIONS,
} from "@/lib/finance/bseEquity";
import { latestBseQuoteByTicker, latestStockQuoteBySymbol } from "@/lib/finance/latestQuotes";
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
  /** Null for a BSE-only constituent our own company-name resolver couldn't link to an `/instruments/[symbol]` page (see bseIndexConstituents.ts's module doc, "no dead links") — the panel renders it as plain text, never a Link. Always non-null for every NSE constituent. */
  symbol: string | null;
  companyName: string;
  industry: string | null;
  close: number | null;
  changePercent: number | null;
  /** For an NSE index: free-float mcap share from NSE's live index watch (indexLiveWatch.ts) — an ESTIMATE (NSE's published weights apply capping factors we don't have). For a BSE index: BSE's own published `Weightage` from bseIndexConstituents.ts's live weight feed — NOT an estimate, BSE's own final number. Null when neither source covers this index/constituent. See `weightIsEstimate` to distinguish the two when rendering a caveat. */
  weightPct: number | null;
  /** True when `weightPct` is an estimate (the NSE branch, always true there when weightPct is non-null); false when it's a source-published weight (the BSE branch). Undefined/irrelevant when weightPct is null. */
  weightIsEstimate?: boolean;
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
   * Intraday Chart Ranges (2026-08-16) — true when this symbol has a real,
   * resolvable Yahoo ticker for the candles endpoints (apps/api's
   * `/candles`/`index/[symbol]/candles` routes), so `PriceChart`'s 1W/1M
   * chips can lazy-fetch genuine 15m/1h bars instead of re-slicing the daily
   * `spark` array. True for: a plain NSE equity/ETF (`!isIndex &&
   * !isBseEquity` — the equity candles route's `.NS`-suffix convention
   * always resolves for these, `latestQuote` presence not required), and
   * every index this page's own `hasLiveIndexPipe` field already covers (the
   * 5 tradable + ~30 NSE INDEX_UNIVERSE + ~18 BSE_INDEX_UNIVERSE indices —
   * literally the same symbols the index candles route's own
   * `resolveIndexYahooTicker` resolves, by construction). False for a
   * BSE-only equity/fund (`isBseEquity` — the equity candles route hardcodes
   * `.NS`, out of scope to fix here, see the CTO brief's instrument-class
   * table) and for a long-tail index (`isIndex && !hasLiveIndexPipe` above —
   * no yahooTicker exists to resolve, by design). Bonds never reach this
   * function's return at all (a separate page/fetcher — see
   * lib/finance/bonds.ts), so they need no explicit branch here.
   */
  supportsIntradayRanges: boolean;
  /**
   * BSE Expansion Phase 2 (2026-08-12) — true for ANY BSE index page (the 18
   * BSE_INDEX_UNIVERSE Yahoo-verified indices AND the ~115-index BSE long
   * tail — see lib/finance/bseIndexLongTail.ts). Mutually exclusive with a
   * true `isIndex` from the NSE side — a symbol is either an NSE index, a
   * BSE index, an ETF, or a plain equity, never two of those. Drives
   * QuoteHeader's "NSE"/"BSE" exchange label; everything else (`isIndex`,
   * `viewOnlyIndex`, `hasLiveIndexPipe`) already generalizes across both
   * exchanges so page.tsx needs no other BSE-specific branching.
   */
  isBseIndex: boolean;
  /**
   * BSE Expansion Phase 3A (2026-08-12) — true for a BSE-EXCLUSIVE equity
   * page: a real `BseEodQuote` row exists for this `.BO`-suffixed symbol
   * (the company failed NSE's dual-listing check at ingestion time — see
   * `BseEodQuote`'s own schema doc). A distinct FOURTH page family alongside
   * isIndex/isBseIndex/isEtf — mutually exclusive with all three (a `.BO`-
   * suffixed symbol never matches any NSE index/BSE-index/ETF branch above,
   * which is what `nseUnresolved`'s "collision-free by construction" note
   * already establishes for the BSE-index branches; the same construction
   * argument applies here).
   */
  isBseEquity: boolean;
  /** BSE scrip code for a BSE-only equity (external quote links target bseindia.com by scrip code) — null for everything else. */
  bseScripCode: string | null;
  /**
   * True when `isBseEquity` AND this stock's MAX turnover across its
   * trailing BSE_EQUITY_FLOOR_WINDOW_SESSIONS does NOT clear
   * `MIN_BSE_EQUITY_TURNOVER_RS` (lib/finance/bseEquity.ts — turnover-based,
   * not raw share volume, since 2026-08-14's floor rework). The page still
   * renders fully and honestly (never fabricated/withheld data) — this flag
   * only drives `noindex` (page.tsx's generateMetadata) and exclusion from
   * browse/search/sitemap surfaces. Always false for a non-BSE-equity page.
   */
  belowBseEquityFloor: boolean;
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
  /**
   * ETF Layer (2026-08-12) Ask 3, widened by BSE Phase 3B (2026-08-14) —
   * every registry-confirmed fund (NSE ETF registry OR BSE fund registry,
   * merged) hand-verified/embedding-matched to track THIS index. Always
   * empty for a non-index page. A mixed array by design: both entry shapes
   * structurally satisfy `{ symbol, displayName }`, all `EtfTrackingList`
   * actually reads — see that component's own doc.
   */
  etfsTrackingIndex: (EtfRegistryEntry | BseFundRegistryEntry)[];
  /**
   * BSE Expansion Phase 3B (2026-08-14) — true when this `.BO` symbol is a
   * registry-confirmed BSE-only fund (lib/finance/bseFundRegistry.ts — an
   * AMFI-ISIN-matched BseEodQuote row; see that module's own doc for why
   * this is the fund signal, not BSE's SctySrs). Mutually exclusive with
   * `isEtf` (that flag is NSE-registry-only) but drives the SAME "ETF" badge
   * and details-panel swap on page.tsx. Always false for a non-BSE-equity
   * page.
   */
  isBseFund: boolean;
  /** Registry facts for this BSE-only fund — null for a plain BSE equity, an NSE symbol, or an index. */
  bseFundDetails: BseFundRegistryEntry | null;
  /**
   * Index Membership (2026-08-12) — every covered index this stock is a
   * verified member of (lib/finance/indexMembership.ts's reverse of
   * indexConstituents.ts/indexLiveWatch.ts). Always empty for an index page
   * (an index isn't "a member of" other indices in any sense this app
   * models) — populated for both a plain equity AND an ETF, since ETF
   * membership is a real, if slightly unusual, fact (some ETFs are
   * themselves NSE index constituents); the page only RENDERS it for a
   * plain equity (see page.tsx — an ETF already shows its "Tracks" line).
   * Never fabricated: empty means "not a member of any of the ~115 covered
   * indices, or the reverse map isn't warm yet" — see that module's own doc.
   */
  indexMembership: IndexMembershipEntry[];
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

/**
 * BSE Expansion Phase 2 (2026-08-12) — the BSE-side sibling of
 * INDEX_OPINION_TICKER: `{ symbol -> verified Yahoo ticker }` for the 18
 * BSE_INDEX_UNIVERSE indices, doubling as the ExpertOpinion.instrumentTicker
 * value their opinions resolve under (e.g. "^BSESN" for BSE Sensex — the
 * ticker prod's existing, currently-unlinked SENSEX opinions already carry).
 * A BSE long-tail index (not in this map) matches by raw `instrument` text
 * instead, same asymmetry as the NSE long tail's own `isLongTailIndex`
 * branch below.
 */
const BSE_INDEX_OPINION_TICKER: Record<string, string> = {
  ...BSE_INDEX_UNIVERSE_OPINION_TICKER,
};
/** BSE-side sibling of INDEX_DISPLAY_NAME, sourced from BSE_INDEX_UNIVERSE (business-rules) so the two never drift. */
const BSE_INDEX_DISPLAY_NAME: Record<string, string> = {
  ...BSE_INDEX_UNIVERSE_DISPLAY_NAME,
};

export async function fetchInstrumentDetail(rawSymbol: string): Promise<InstrumentDetail | null> {
  // Next.js App Router dynamic params arrive PERCENT-ENCODED ("M%26M" for
  // /instruments/M&M) — without decoding, every ampersand ticker (M&M,
  // M&MFIN, J&KBANK, GMRP&UI, ...) 404s despite real StockEodQuote rows.
  // Founder-reported live 2026-08-12. try/catch: a genuinely malformed
  // percent-sequence in the URL must degrade to the raw string (-> normal
  // not-found), never throw a 500.
  let decoded = rawSymbol;
  try {
    decoded = decodeURIComponent(rawSymbol);
  } catch {
    decoded = rawSymbol;
  }
  const symbol = decoded.trim().toUpperCase();
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

  // BSE Expansion Phase 2 (2026-08-12) — additive-only BSE resolution,
  // evaluated ONLY when the NSE side found nothing (a plain equity falls
  // into this branch too, same as the NSE long-tail lookup above — the BSE
  // long-tail cache is a 5-minute in-memory Map after the first call, so the
  // added cost for the overwhelming majority of page views is negligible).
  // `nseUnresolved` is a defensive gate, not real disambiguation: every
  // BSE-derived symbol is "BSE"-prefixed by construction (see
  // business-rules/bseIndexUniverse.ts's own module doc — collision-checked
  // against the full NSE index/equity/bond universe via
  // apps/api/scripts/check-bse-collisions.ts) and therefore can never equal
  // an `hasLiveIndexPipe`/NSE-long-tail symbol in the first place. NONE of
  // the NSE branches above (`hasLiveIndexPipe`, `longTailEntry`,
  // `isLongTailIndex`) are touched by this block — the 35 hasLiveIndexPipe
  // pages and the NSE long tail remain byte-for-byte unchanged.
  const nseUnresolved = !hasLiveIndexPipe && !isLongTailIndex;
  const hasLiveBseIndexPipe = nseUnresolved && isBseIndexUniverseSymbol(symbol);
  const bseUniverseEntry = hasLiveBseIndexPipe ? getBseIndexUniverseEntry(symbol) : null;
  const bseLongTailEntry =
    nseUnresolved && !hasLiveBseIndexPipe ? await getBseLongTailIndexBySymbol(symbol) : null;
  const isBseLongTailIndex = bseLongTailEntry != null;
  const isBseIndex = hasLiveBseIndexPipe || isBseLongTailIndex;
  /** BseIndexEodQuote.indexName join key for either BSE branch — verbatim BSE display name, same role as `ownedIndexName` on the NSE side. */
  const bseIndexName = bseUniverseEntry?.name ?? bseLongTailEntry?.name ?? null;
  /** BSE Yahoo tier's ExpertOpinion ticker (see BSE_INDEX_OPINION_TICKER's own doc) — undefined for the BSE long tail, which matches by raw instrument text instead. */
  const bseIndexYahooTicker = hasLiveBseIndexPipe ? BSE_INDEX_OPINION_TICKER[symbol] : undefined;

  const isIndex = hasLiveIndexPipe || isLongTailIndex || isBseIndex;
  const viewOnlyIndex = isIndex && !isIndexOptionUnderlying(symbol);

  // BSE Expansion Phase 3A (2026-08-12) — BSE-EXCLUSIVE equities. The ".BO"
  // suffix is the single, collision-free signal (see bseEquity.ts's own doc
  // — no NSE symbol/BSE-index-derived-symbol/bond/ETF namespace ever
  // contains a literal "."), so this only needs to be gated on `!isIndex`
  // (an index symbol never has this shape anyway, but the guard costs
  // nothing and keeps the branch ordering explicit/self-documenting).
  const bseEquityTicker = !isIndex && isBseEquitySymbolShape(symbol) ? bareBseEquityTicker(symbol) : null;
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
  // BSE Index Composition (2026-08-12) — same cheap sync check, gated on the
  // BSE branch's own join key (`bseIndexName`, the BseIndexEodQuote.indexName
  // this symbol resolved to above) rather than `symbol` itself, since
  // bseIndexConstituents.ts's dictionary is keyed by BSE's own display name.
  const bseWantsConstituents = isBseIndex && bseIndexName != null && hasBseIndexConstituents(bseIndexName);

  const opinionSince = new Date(Date.now() - OPINION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [
    latestQuote,
    sparkRows,
    newsRows,
    filingsInitial,
    opinionCandidates,
    indexSparkRows,
    ownedEodRows,
    bseOwnedEodRows,
    longTailLiveQuote,
    metricsSnapshotRow,
    constituentListRows,
    bseConstituentListRows,
    etfDetails,
    etfsTrackingIndex,
    indexMembership,
    bseEquityLatestRow,
    bseEquitySparkRows,
    bseFundDetails,
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
            : // BSE Expansion Phase 2 (2026-08-12) — same two-tier match as the
              // NSE branches above, additive: only reached when NEITHER NSE
              // branch matched (indexYahooTicker unset AND isLongTailIndex
              // false), which is guaranteed for every BSE-prefixed symbol.
              bseIndexYahooTicker
              ? { instrumentTicker: { equals: bseIndexYahooTicker } }
              : isBseLongTailIndex
                ? { instrument: { equals: bseLongTailEntry!.name, mode: "insensitive" as const } }
                : // BSE Expansion Phase 3A (2026-08-12) — a BSE-only equity's
                  // ExpertOpinion.instrumentTicker is the exact page symbol
                  // ITSELF ("NSDL.BO"), not a startsWith-prefixable
                  // "SYMBOL.<exchange>" pattern the NSE-equity branch below
                  // assumes (that branch's `${symbol}.` prefix would build
                  // "NSDL.BO." — never matches anything real). Exact match,
                  // same discipline as every ticker-equals branch above.
                  bseEquityTicker
                  ? { instrumentTicker: { equals: symbol, mode: "insensitive" as const } }
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
    // BSE Expansion Phase 2 (2026-08-12) — self-owned daily OHLC, the ONLY
    // price/spark source for a BSE index page (no NSE-style live
    // /api/allIndices-equivalent snapshot exists for BSE here — the Yahoo
    // tier's freshness comes entirely from QuoteHeader's client-side live
    // overlay, same intraday-pipe mechanism the 35 NSE hasLiveIndexPipe
    // symbols already use, not a second server-side snapshot fetch). Desc
    // order (newest first), same convention as `ownedEodRows`.
    isBseIndex && bseIndexName
      ? prisma.bseIndexEodQuote.findMany({
          where: { indexName: { equals: bseIndexName, mode: "insensitive" } },
          orderBy: { sessionDate: "desc" },
          take: SPARK_SESSIONS,
          select: {
            sessionDate: true,
            close: true,
            changeAbs: true,
            changePercent: true,
            previousClose: true,
            volume: true,
            // BSE Index Metrics addendum (2026-08-12, founder: "if we already
            // have indices information like Div Yield, P/E why are they
            // missing on their pages") — widened beyond Phase 2's original
            // spark-only selection so the SAME query (already fetched for
            // every BSE index page) also feeds IndexMetricsPanel below,
            // rather than a second round trip.
            open: true,
            high: true,
            low: true,
            peRatio: true,
            pbRatio: true,
            dividendYield: true,
          },
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
    // BSE Index Composition (2026-08-12) — same shape/role as
    // `constituentListRows` above, sourced from Asia Index Pvt Ltd's own
    // live per-index constituent feed (bseIndexConstituents.ts) rather than
    // an NSE CSV. A no-op Promise for every non-BSE-index page and for a
    // BSE index whose code returned an empty Table (see that file's module
    // doc on the 11 non-equity gaps).
    bseWantsConstituents ? fetchBseIndexConstituents(bseIndexName!) : Promise.resolve(null),
    // ETF Layer (2026-08-12) — a no-op Promise for every index (an index is
    // never itself an ETF); cheap in-memory Map lookup after the registry's
    // first fetch in any 24h window for every equity/ETF symbol.
    isIndex ? Promise.resolve(null) : getEtfRegistryEntry(symbol),
    // ETF Layer (2026-08-12) Ask 3, widened by BSE Phase 3B (2026-08-14) — a
    // no-op Promise for every non-index page; for an index page, merges the
    // NSE ETF registry's tracking list with the BSE fund registry's (see
    // InstrumentDetail.etfsTrackingIndex's own doc on the mixed-array shape).
    // getEtfsTrackingIndex ALSO now returns BSE-index trackers for free (the
    // NSE registry's canon was merged with BSE index names — see
    // indexNameResolver.ts), so a BSE index page can show an NSE-listed
    // fund here (e.g. an NSE ETF tracking BSE Sensex) alongside its own
    // BSE-only funds — both legitimately "track this index," exchange of
    // listing is a separate fact `EtfTrackingList` doesn't need to show.
    isIndex
      ? Promise.all([getEtfsTrackingIndex(symbol), getBseFundsTrackingIndex(symbol)]).then(([nse, bse]) => [...nse, ...bse])
      : Promise.resolve([]),
    // Index Membership (2026-08-12) — a no-op Promise for an index page (see
    // this field's own doc on InstrumentDetail); always resolves fast, a
    // plain in-memory Map read at worst (see indexMembership.ts's own doc on
    // why it never blocks on network I/O here).
    isIndex ? Promise.resolve([]) : getIndexMembership(symbol),
    // BSE Expansion Phase 3A (2026-08-12) — a no-op Promise for every
    // non-BSE-equity page. `bseEquityTicker` is the bare ticker (no ".BO"
    // suffix) BseEodQuote.tickerSymbol is keyed by.
    bseEquityTicker
      ? prisma.bseEodQuote.findFirst({
          where: { tickerSymbol: { equals: bseEquityTicker, mode: "insensitive" } },
          orderBy: { sessionDate: "desc" },
        })
      : Promise.resolve(null),
    // `volume` is also selected here (spark otherwise only needs `close`) —
    // Floor Rework (2026-08-14): the first BSE_EQUITY_FLOOR_WINDOW_SESSIONS
    // entries of this same, already-fetched array double as the floor's
    // turnover window, avoiding a second query. See `belowBseEquityFloor`
    // below and bseEquity.ts's module doc for why.
    bseEquityTicker
      ? prisma.bseEodQuote.findMany({
          where: { tickerSymbol: { equals: bseEquityTicker, mode: "insensitive" } },
          orderBy: { sessionDate: "desc" },
          take: SPARK_SESSIONS,
          select: { sessionDate: true, close: true, volume: true },
        })
      : Promise.resolve(null),
    // BSE Expansion Phase 3B (2026-08-14) — a no-op Promise for every
    // non-BSE-equity page; cheap in-memory Map lookup after the fund
    // registry's first fetch in any 24h window (same caching shape as
    // `etfDetails` above).
    bseEquityTicker ? getBseFundRegistryEntry(bseEquityTicker) : Promise.resolve(null),
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
    // BSE Expansion Phase 2 (2026-08-12) — same additive two-tier re-check as
    // the query's own `where` clause above. Unreachable for any NSE symbol
    // (both checks above already returned).
    const bseTicker = BSE_INDEX_OPINION_TICKER[symbol];
    if (bseTicker) return o.instrumentTicker === bseTicker;
    if (isBseLongTailIndex) {
      return (
        o.instrument != null && normalizeIndexDisplayName(o.instrument) === normalizeIndexDisplayName(bseLongTailEntry!.name)
      );
    }
    // BSE Expansion Phase 3A (2026-08-12) — exact-match re-check mirroring
    // the query's own bseEquityTicker branch above. `nseSymbolMatchesInstrumentTicker`
    // below strips a trailing suffix off `o.instrumentTicker` and compares
    // the BARE result to `symbol` as-is — for a `.BO`-suffixed `symbol`
    // ("NSDL.BO") that comparison can never succeed (it would compare
    // "NSDL" to "NSDL.BO"), so this must be its own exact-equality branch,
    // not routed through that matcher.
    if (bseEquityTicker) {
      return o.instrumentTicker != null && o.instrumentTicker.toUpperCase() === symbol.toUpperCase();
    }
    if (o.instrumentTicker == null) return false;
    return nseSymbolMatchesInstrumentTicker(symbol, o.instrumentTicker);
  });

  // `let`, not `const`: an index page's news is re-scoped to its
  // constituents once the composition join below resolves (Index
  // Constituent News, 2026-08-15) — see that block's own comment.
  let news = refineStockNews(newsRows, { limit: NEWS_LIMIT });

  // BSE Expansion Phase 3A (2026-08-12) — `filingsInitial` (fetched
  // unconditionally above, keyed on `tickerSymbol: symbol`) is ALWAYS empty
  // for a BSE-equity page: apps/api's BSE announcements pipeline
  // (lib/marketMoves/bse.ts) tags a BSE-only company's filings with
  // `BSE:{scripCode}`, never the `.BO`-suffixed page symbol. A second,
  // dependent query (only reachable once `bseEquityLatestRow.scripCode` is
  // known — the same "second awaited round" pattern `indexComposition`
  // already uses below for its own constituent-dependent join) fetches the
  // REAL filings for this company via that honest, existing tag. Never
  // fabricated: a BSE-only company with zero BSE announcements simply gets
  // an empty filings list, same as any NSE equity would.
  let filings = filingsInitial;
  if (bseEquityTicker && bseEquityLatestRow) {
    filings = await prisma.marketMoveEvent.findMany({
      where: { tickerSymbol: `BSE:${bseEquityLatestRow.scripCode}` },
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
    });
  }

  // A known index ALWAYS resolves (a tradable/view-only page renders a live
  // 1D chart, a long-tail page renders its own self-owned OHLC history) even
  // with zero stored content — the null gate only applies to unknown
  // symbols. A known BSE-equity symbol (a real BseEodQuote row exists) is
  // the same "always resolves" case, one level over — see
  // `bseEquityLatestRow`'s own doc.
  const isBseEquity = bseEquityLatestRow != null;
  // Intraday Chart Ranges (2026-08-16) — see InstrumentDetail.supportsIntradayRanges's
  // own doc. Reuses `hasLiveIndexPipe`/`hasLiveBseIndexPipe` (already computed
  // above for the SAME "does a real Yahoo ticker resolve" question the index
  // candles route asks) rather than re-deriving index eligibility a second
  // way; the equity/ETF branch is a single `!isBseEquity` check since the
  // equity candles route's `.NS`-suffix convention resolves for any NSE
  // symbol string, quote-availability not required.
  const supportsIntradayRanges = isIndex ? hasLiveIndexPipe || hasLiveBseIndexPipe : !isBseEquity;
  /** BSE Expansion Phase 3B (2026-08-14) — see InstrumentDetail's own doc. Computed from the registry lookup already fetched above, not re-derived. */
  const isBseFund = bseFundDetails != null;
  const hasAnyContent = latestQuote != null || news.length > 0 || filings.length > 0 || matchedOpinions.length > 0;
  if (!hasAnyContent && !isIndex && !isBseEquity) return null;

  // ETF Layer (2026-08-12) — an ETF's StockEodQuote.companyName is just its
  // bare symbol (bhavcopy resolves company names off the EQUITY master,
  // which doesn't carry fund names — verified live: NIFTYBEES/GOLDBEES/
  // BANKBEES/etc all store companyName === symbol today). Prefer the
  // registry's `displayName` over that no-op fallback — AMFI's real,
  // ISIN-exact-joined scheme name when resolved (339/342 ETFs, 99.1% —
  // see etfRegistry.ts's 2026-08-12 AMFI addendum), else NSE's own
  // abbreviated SecurityName. Overridden below with Yahoo's `price.longName`
  // ONLY for the ~1% AMFI didn't resolve — a live comparison found AMFI's
  // name byte-identical to Yahoo's longName wherever both existed, so AMFI's
  // far higher, same-fetch coverage wins outright rather than waiting on
  // Yahoo's crumb-gated, sparsely-cached fetch (see fundamentals.ts's
  // KeyStats.yahooLongName doc).
  let companyName =
    INDEX_DISPLAY_NAME[symbol] ??
    longTailEntry?.name ??
    // BSE Expansion Phase 2 (2026-08-12) — Yahoo tier prefers its
    // hand-written displayName (matches INDEX_DISPLAY_NAME's role); the BSE
    // long tail falls back to BSE's own verbatim indexName, same as the NSE
    // long tail above.
    BSE_INDEX_DISPLAY_NAME[symbol] ??
    bseLongTailEntry?.name ??
    // BSE Expansion Phase 3B (2026-08-14) — prefer the fund registry's
    // AMFI-joined real scheme name over BSE's own (often abbreviated)
    // FinInstrmNm, same "AMFI wins when resolved" rule as the NSE ETF
    // branch below. Checked before the plain BseEodQuote.companyName
    // fallback immediately after.
    bseFundDetails?.displayName ??
    // BSE Expansion Phase 3A (2026-08-12) — BseEodQuote.companyName is the
    // UDiFF bhavcopy's own `FinInstrmNm` (real, exchange-sourced), same
    // authority tier as StockEodQuote.companyName below — checked before
    // the ETF/latestQuote branch since a BSE-equity symbol never has a
    // `latestQuote` (StockEodQuote is NSE-only) to fall through to anyway.
    bseEquityLatestRow?.companyName ??
    (etfDetails && latestQuote?.companyName === symbol ? etfDetails.displayName : latestQuote?.companyName) ??
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

  // BSE Expansion Phase 2 (2026-08-12) — no NSE-style live allIndices
  // snapshot exists for BSE here, so unlike `ownedQuote` above there is no
  // `liveSnapshot` override: the server quote is simply the latest
  // self-owned BseIndexEodQuote row. BseIndexEodQuote carries a real
  // `previousClose` field BSE publishes directly (see that model's own
  // schema doc) — preferred over the derived `close - changeAbs` NSE's table
  // requires, falling back to the derivation only when BSE's own field is
  // null. Same-day freshness for the 18 Yahoo-tier symbols comes entirely
  // from QuoteHeader's client-side live overlay (hasLiveIndexPipe below),
  // exactly like the 35 NSE hasLiveIndexPipe symbols.
  let bseOwnedQuote: InstrumentQuote | null = null;
  if (isBseIndex) {
    const latestBseRow = bseOwnedEodRows?.[0] ?? null;
    if (latestBseRow) {
      bseOwnedQuote = {
        sessionDate: latestBseRow.sessionDate,
        close: latestBseRow.close,
        prevClose: latestBseRow.previousClose ?? latestBseRow.close - latestBseRow.changeAbs,
        changePercent: latestBseRow.changePercent,
        volume: latestBseRow.volume ?? 0,
        deliveryPct: null,
      };
    }
  }

  // BSE Expansion Phase 3A (2026-08-12) — quote header + close-price history
  // sourced entirely from BseEodQuote. NO live intraday chart — the brief's
  // own honesty law ("no quote = noindex... never fabricate a 1D chart from
  // EOD data alone"): no verified live BSE equity quote source exists,
  // matching the exact same discipline the long-tail NSE/BSE INDEX branches
  // already follow for their own EOD-only tiers. `deliveryPct` is null —
  // UDiFF's equity bhavcopy carries no delivery-percentage column (unlike
  // NSE's DELIV_PER).
  let bseEquityQuote: InstrumentQuote | null = null;
  if (isBseEquity && bseEquityLatestRow) {
    bseEquityQuote = {
      sessionDate: bseEquityLatestRow.sessionDate,
      close: bseEquityLatestRow.close,
      prevClose: bseEquityLatestRow.prevClose,
      changePercent: bseEquityLatestRow.changePercent,
      volume: bseEquityLatestRow.volume,
      deliveryPct: null,
    };
  }
  // Floor Rework (2026-08-14) — turnover (close × volume), MAXed over the
  // trailing BSE_EQUITY_FLOOR_WINDOW_SESSIONS, not a single day's raw
  // volume (see bseEquity.ts's module doc for the full root-cause writeup;
  // this is the single-symbol equivalent of `summarizeBseEquityWindow` —
  // no second query needed since `bseEquitySparkRows` already holds this
  // symbol's recent sessions, most-recent-first).
  const bseEquityMaxTurnoverInWindow = (bseEquitySparkRows ?? [])
    .slice(0, BSE_EQUITY_FLOOR_WINDOW_SESSIONS)
    .reduce((max, r) => Math.max(max, bseEquityTurnover(r)), 0);
  /** BSE Expansion Phase 3A (2026-08-12) — see InstrumentDetail's own doc on why this flag never hides/drops data, only gates presentation surfaces downstream (page.tsx robots, search, sitemap). */
  const belowBseEquityFloor = isBseEquity && !clearsBseEquityFloor(bseEquityMaxTurnoverInWindow);

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
  // BSE Expansion Phase 2 (2026-08-12) — self-owned BseIndexEodQuote is the
  // ONLY spark source for a BSE index (no Yahoo daily-archive fallback is
  // wired for BSE — Phase 1's backfill already gives every BSE index
  // comfortable multi-month depth, unlike the NSE gap OWNED_SPARK_FLOOR was
  // built to paper over).
  const bseOwnedSpark = (bseOwnedEodRows ?? []).slice().reverse().map((r) => ({ sessionDate: r.sessionDate, close: r.close }));
  // BSE Expansion Phase 3A (2026-08-12) — self-owned BseEodQuote is the ONLY
  // spark source for a BSE-only equity (no Yahoo daily-archive fallback
  // wired here — same "EOD-only, no live pipe" tier as the BSE index long
  // tail).
  const bseEquitySpark = (bseEquitySparkRows ?? []).slice().reverse().map((r) => ({ sessionDate: r.sessionDate, close: r.close }));
  const spark = isIndex
    ? isBseIndex
      ? bseOwnedSpark
      : ownedSpark.length >= OWNED_SPARK_FLOOR
        ? ownedSpark
        : (indexSparkRows ?? ownedSpark)
    : isBseEquity
      ? bseEquitySpark
      : sparkRows.slice().reverse();

  // Instrument Page v2 (T3) — pure, zero extra query/network call over the
  // spark series already resolved above (equity or index).
  const performance = computeReturnsStrip(spark, (latestQuote ?? bseEquityLatestRow)?.sessionDate);

  // Instrument Page v2 (T4) — indices have no financial statements/dividend
  // history to enrich; skip the Yahoo/DB round trip entirely rather than
  // fetching fundamentals for "^NSEI.NS". (Unrelated to the daily price
  // history above, which indices DO now get — see `spark`.)
  //
  // BSE Expansion Phase 3A (2026-08-12) — a BSE-only equity DOES get
  // enrichment, via Yahoo's `.BO` ticker suffix (live-verified real
  // coverage — see enrichment.ts's own doc on this `exchange` param).
  const enrichment = isIndex
    ? EMPTY_INSTRUMENT_ENRICHMENT
    : await getOrFetchInstrumentEnrichment(symbol, companyName, isBseEquity ? "BSE" : "NSE");
  // ETF Layer (2026-08-12, AMFI addendum) — Yahoo's fund long name is now
  // ONLY the fallback for the rare ETF AMFI's ISIN join didn't resolve.
  // `displayName === securityName` is exactly that "AMFI didn't resolve"
  // signal (see etfRegistry.ts's EtfRegistryEntry doc) — when AMFI DID
  // resolve, its name is kept as-is rather than overwritten.
  if (etfDetails && enrichment.keyStats?.yahooLongName && etfDetails.displayName === etfDetails.securityName) {
    companyName = enrichment.keyStats.yahooLongName;
  }

  // Indices Consolidation (2026-08-12) Ask 2a — both branches read off the
  // SAME IndexRow shape (`fetchIndexBySlug`'s return type). Sourced from
  // `liveSnapshot`, computed once above (Index History Stage 3) and shared
  // with `ownedQuote`'s derivation rather than re-branched a second time.
  // BSE Index Metrics addendum (2026-08-12) — no NSE-style live allIndices
  // snapshot exists for BSE (see `bseOwnedQuote`'s own doc above), so this
  // reads entirely off the SAME self-owned BseIndexEodQuote history already
  // fetched for the spark chart (`bseOwnedEodRows`, desc order, [0] latest,
  // ~1y of sessions via SPARK_SESSIONS) rather than a second query.
  // yearHigh/yearLow are REAL 52-week extremes computed from our own
  // archive — high/low when BSE's feed populated them for that session,
  // falling back to close on the rows where it didn't (e.g. sovereign-bond
  // indices, which publish a blank Open/High/Low but a real Close — see
  // BseIndexEodQuote's own schema doc). advances/declines/unchanged stay
  // null: BSE publishes no per-index breadth count anywhere this pass found
  // (unlike NSE's allIndices snapshot) — IndexMetricsPanel already renders
  // the "Member stocks today" block's absence gracefully.
  const bseIndexMetrics: InstrumentIndexMetrics | null = (() => {
    if (!isBseIndex || !bseOwnedEodRows || bseOwnedEodRows.length === 0) return null;
    const latest = bseOwnedEodRows[0];
    const highs = bseOwnedEodRows.map((r) => r.high ?? r.close).filter((v): v is number => v != null);
    const lows = bseOwnedEodRows.map((r) => r.low ?? r.close).filter((v): v is number => v != null);
    return {
      peRatio: latest.peRatio,
      pbRatio: latest.pbRatio,
      dividendYield: latest.dividendYield,
      advances: null,
      declines: null,
      unchanged: null,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      previousClose: latest.previousClose ?? latest.close - latest.changeAbs,
      yearHigh: highs.length > 0 ? Math.max(...highs) : null,
      yearLow: lows.length > 0 ? Math.min(...lows) : null,
      asOf: latest.sessionDate.toISOString(),
    };
  })();

  // `let`, not `const`: the advances/declines/unchanged counts are
  // back-filled from the composition join below when the source itself
  // published none (BSE Breadth, 2026-08-15) — see that block's comment.
  let indexMetrics: InstrumentIndexMetrics | null = liveSnapshot
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
    : bseIndexMetrics;

  // Indices Consolidation (2026-08-12) Ask 2b, founder addendum — the price
  // join is a SECOND awaited step (not folded into the Promise.all above)
  // because it depends on `constituentListRows`, which that same Promise.all
  // just resolved. Bounded single query (`in: constituentSymbols`, at most
  // ~750 rows for NIFTY TOTAL MARKET) — never an unbounded findMany.
  let indexComposition: IndexConstituentQuoteRow[] | null = null;
  if (constituentListRows && constituentListRows.length > 0) {
    const constituentSymbols = constituentListRows.map((r) => r.symbol);
    // Raw DISTINCT ON (latestQuotes.ts, 2026-08-15): Prisma's findMany
    // distinct fetched every constituent's FULL history (~750 × ~257
    // sessions ≈ 190k rows for NIFTY TOTAL MARKET) to keep one row each.
    const constituentQuotes = await latestStockQuoteBySymbol(constituentSymbols);
    const quoteBySymbol = new Map(constituentQuotes.map((q) => [q.symbol, q]));
    const joined: IndexConstituentQuoteRow[] = constituentListRows.map((c) => {
      const q = quoteBySymbol.get(c.symbol);
      return {
        symbol: c.symbol,
        companyName: c.companyName,
        industry: c.industry,
        close: q?.close ?? null,
        changePercent: q?.changePercent ?? null,
        weightPct: c.weightPct ?? null,
        weightIsEstimate: c.weightPct != null ? true : undefined,
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
  } else if (bseConstituentListRows && bseConstituentListRows.length > 0) {
    // BSE Index Composition (2026-08-12) — same day-change join pattern as
    // the NSE branch above. A member with `symbol: null` is never queried
    // and never linked, but still rendered (plain text, no change columns)
    // — a real index member, just not one we can price or link yet.
    //
    // BSE Expansion Phase 3A (2026-08-12), founder: "so BSE composition do
    // not suffer with missing stocks" — `bseIndexConstituents.ts` now
    // resolves a constituent against EITHER StockEodQuote (dual-listed, NSE
    // canonical, `symbolExchange: "NSE"`) OR BseEodQuote (BSE-only, exact
    // scrip-code join, `symbolExchange: "BSE"`). Split the batched price
    // join accordingly — two indexed `IN (...)` queries (one per table),
    // never N+1.
    const nseSymbols = bseConstituentListRows.filter((r) => r.symbolExchange === "NSE" && r.symbol).map((r) => r.symbol!);
    const bseSymbols = bseConstituentListRows.filter((r) => r.symbolExchange === "BSE" && r.symbol).map((r) => r.symbol!);
    const bseTickers = bseSymbols.map((s) => s.replace(/\.BO$/i, ""));

    const [nseConstituentQuotes, bseConstituentQuotes] = await Promise.all([
      latestStockQuoteBySymbol(nseSymbols),
      latestBseQuoteByTicker(bseTickers),
    ]);
    const quoteBySymbol = new Map(nseConstituentQuotes.map((q) => [q.symbol, { close: q.close, changePercent: q.changePercent }]));
    for (const q of bseConstituentQuotes) {
      quoteBySymbol.set(`${q.tickerSymbol.toUpperCase()}.BO`, { close: q.close, changePercent: q.changePercent });
    }
    const joined: IndexConstituentQuoteRow[] = bseConstituentListRows.map((c) => {
      const q = c.symbol ? quoteBySymbol.get(c.symbol) : undefined;
      return {
        symbol: c.symbol,
        companyName: c.companyName,
        industry: c.industry,
        close: q?.close ?? null,
        changePercent: q?.changePercent ?? null,
        weightPct: c.weightPct,
        weightIsEstimate: c.weightPct != null ? false : undefined,
      };
    });
    const ranked = joined
      .filter((r) => r.changePercent != null)
      .sort((a, b) => (b.changePercent as number) - (a.changePercent as number));
    const unranked = joined.filter((r) => r.changePercent == null);
    indexComposition = [...ranked, ...unranked];
  }

  // BSE Breadth (2026-08-15, founder: BSE indices "do not show the member
  // stocks went high and low as we have in NSE indices") — NSE's counts come
  // free from its live allIndices snapshot; BSE publishes no per-index
  // breadth feed anywhere (verified 2026-08-12, see bseIndexMetrics' doc),
  // so its metrics carried null and the panel hid the "Member stocks today"
  // block. But the composition join just above already priced every member's
  // day change from our own EOD stores — the breadth is a straight count of
  // it. Fills ONLY when the source published none (a real NSE snapshot count
  // always wins) and only over priced members (an unpriced member is
  // excluded from all three buckets rather than miscounted as "unchanged").
  if (indexMetrics && indexMetrics.advances == null && indexComposition && indexComposition.length > 0) {
    const priced = indexComposition.filter((c) => c.changePercent != null);
    if (priced.length > 0) {
      indexMetrics = {
        ...indexMetrics,
        advances: priced.filter((c) => (c.changePercent as number) > 0).length,
        declines: priced.filter((c) => (c.changePercent as number) < 0).length,
        unchanged: priced.filter((c) => (c.changePercent as number) === 0).length,
      };
    }
  }

  // Index Constituent News (2026-08-15, founder ask) — an index page's Stock
  // News tab aggregates its MEMBERS' news: the direct `tickerSymbol: symbol`
  // query above is structurally empty for an index (no pipeline ever stores
  // news under an index code), so the tab sat empty on every index page.
  // One bounded IN query over the composition just resolved above — the
  // constituent symbols are already in MarketMoveNews's own namespace (bare
  // NSE / `.BO`), and refineStockNews's per-ticker cap keeps one noisy
  // large-cap from monopolizing the tab. PulseTabs already renders a
  // per-item ticker badge, so each headline self-identifies its stock. The
  // "load more" continuation resolves the same scope server-side via
  // resolveIndexNewsScope (indexNewsScope.ts) in /api/pulse/news.
  if (isIndex && indexComposition && indexComposition.length > 0) {
    const memberSymbols = indexComposition.map((c) => c.symbol).filter((s): s is string => Boolean(s));
    if (memberSymbols.length > 0) {
      const memberNewsRows = await prisma.marketMoveNews.findMany({
        where: { tickerSymbol: { in: memberSymbols } },
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
      });
      news = refineStockNews(memberNewsRows, { limit: NEWS_LIMIT });
    }
  }

  return {
    symbol,
    companyName,
    quote: isIndex ? (isBseIndex ? bseOwnedQuote : ownedQuote) : isBseEquity ? bseEquityQuote : latestQuote,
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
    // BSE Expansion Phase 2 (2026-08-12) — widened to also grant the live 1D
    // intraday pipe to the 18 BSE_INDEX_UNIVERSE symbols, same treatment as
    // the 35 NSE hasLiveIndexPipe symbols. Zero change for any NSE/equity
    // symbol: hasLiveBseIndexPipe is only ever true for a BSE-prefixed
    // symbol (see `nseUnresolved`'s own doc above).
    hasLiveIndexPipe: hasLiveIndexPipe || hasLiveBseIndexPipe,
    supportsIntradayRanges,
    isBseIndex,
    indexMetrics,
    indexComposition,
    isEtf: etfDetails != null,
    etfDetails,
    etfsTrackingIndex,
    indexMembership,
    isBseEquity,
    bseScripCode: bseEquityLatestRow?.scripCode ?? null,
    belowBseEquityFloor,
    isBseFund,
    bseFundDetails,
  };
}
