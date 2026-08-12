/**
 * Instrument Page v2 (T4) — read-through cache + stale-while-revalidate
 * orchestrator for `InstrumentEnrichment` (Decision 1 fundamentals + 3
 * schema + Decision 4 on-demand news refresh).
 *
 * `getOrFetchInstrumentEnrichment` is called from the instrument-detail page
 * alongside `fetchInstrumentDetail` (Promise.all, same architecture
 * fetchInstrumentDetail itself already uses for its own parallel queries —
 * see that file's doc comment). It ALWAYS returns immediately with whatever
 * is cached (or all-null on a true first-ever visit) and never awaits the
 * live Yahoo/Google fetches — those run as fire-and-forget background
 * promises.
 *
 * Fire-and-forget is safe here specifically because apps/web runs as a
 * long-lived Node process on EC2 behind Caddy, not serverless — the process
 * is never killed mid-request, so an un-awaited promise keeps running on the
 * same event loop after the response is sent. Do not port this pattern to a
 * serverless/Vercel context without re-checking that assumption.
 *
 * BSE Expansion Phase 3A (2026-08-12) — `getOrFetchInstrumentEnrichment`'s
 * new optional `exchange` param ("NSE" default, unchanged for every existing
 * caller) lets a BSE-only-equity page opt into Yahoo's `.BO` ticker suffix
 * instead of `.NS`. Live-verified 2026-08-12: Yahoo genuinely covers
 * BSE-only small/mid-caps under `.BO` (e.g. "NSDL.BO", "AMBALALSA.BO",
 * "ANDHRAPET.BO" all returned real, price-matching `chart` data) — the
 * assigning brief's fallback ("if Yahoo lacks BSE-only names, ship without
 * enrichment") does not apply; coverage exists, so it's wired through.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  fetchAnnualFundamentals,
  fetchDividendHistory,
  fetchQuarterlyFundamentals,
  fetchDebtCoverage,
  fetchKeyStats,
  computeBetas,
  type DividendRow,
  type FundamentalsPoint,
  type DebtCoverage,
  type KeyStats,
} from "@/lib/finance/fundamentals";
import { fetchGoogleNewsForTicker } from "@/lib/finance/googleNews";

/** Fundamentals are quarterly-cadence data — a week-old cache is still fresh. */
const FUNDAMENTALS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Key stats include trailing P/E which moves with price — refresh daily, not weekly. */
const KEY_STATS_TTL_MS = 24 * 60 * 60 * 1000;
/** News moves intraday — recheck a visited long-tail symbol every 6h, matching the Market Pulse cron's own freshness bar for its universe. */
const NEWS_TTL_MS = 6 * 60 * 60 * 1000;

export type InstrumentEnrichmentData = {
  annualRevenue: FundamentalsPoint[] | null;
  annualNetIncome: FundamentalsPoint[] | null;
  annualDilutedEps: FundamentalsPoint[] | null;
  quarterlyRevenue: FundamentalsPoint[] | null;
  quarterlyNetIncome: FundamentalsPoint[] | null;
  quarterlyDilutedEps: FundamentalsPoint[] | null;
  /**
   * One row per dividend PAYOUT event — ₹/share amount plus a joined
   * trailing-12-month "annualised yield" as of that payout's date. See
   * fetchDividendHistory's doc comment for the full contract. Typed as the
   * union `DividendRow[]` (not `DividendPayoutRow[]`) because a row read
   * back from the DB may still hold an older shape this app previously
   * wrote (per-calendar-year, or the original per-event shape with no yield
   * fields at all) — see fundamentals-panel.tsx's shape-detection for how
   * each renders.
   */
  dividends: DividendRow[] | null;
  /** TradingView-style Key Stats snapshot (crumb-authenticated Yahoo quoteSummary) — null until first successful fetch. */
  keyStats: KeyStats | null;
  /** Debt level and coverage series — null until first successful fetch. */
  debtCoverage: DebtCoverage | null;
  /** Null = never successfully attempted. Surfaced so the UI can caption "as of <date>" per the house honesty convention. */
  fundamentalsFetchedAt: Date | null;
};

/** All-null enrichment — returned for a true first-ever visit (nothing cached yet) or for symbols enrichment is never fetched for (indices). Exported so callers can share the same "nothing here yet" shape without duplicating field lists. */
export const EMPTY_INSTRUMENT_ENRICHMENT: InstrumentEnrichmentData = {
  annualRevenue: null,
  annualNetIncome: null,
  annualDilutedEps: null,
  quarterlyRevenue: null,
  quarterlyNetIncome: null,
  quarterlyDilutedEps: null,
  dividends: null,
  keyStats: null,
  debtCoverage: null,
  fundamentalsFetchedAt: null,
};

/**
 * Background fundamentals refresh. Writes an optimistic `fundamentalsFetchedAt`
 * BEFORE fetching (cheap check-and-set race guard — see file doc comment and
 * Decision 4's identical pattern for news; the exact failure mode of two
 * near-simultaneous requests both fetching is harmless, not "never
 * fetches"). Only overwrites a series field when the fresh fetch actually
 * returned data for it — an `undefined` field is skipped by Prisma and
 * leaves the previous cached value in place, so a partial Yahoo hiccup
 * degrades to "some series refreshed, others kept their last good value,"
 * never a wipe.
 */
async function refreshFundamentalsInBackground(
  symbol: string,
  companyName: string,
  exchange: "NSE" | "BSE" = "NSE"
): Promise<void> {
  const now = new Date();
  try {
    await prisma.instrumentEnrichment.upsert({
      where: { symbol },
      update: { fundamentalsFetchedAt: now, companyName },
      create: { symbol, companyName, fundamentalsFetchedAt: now },
    });
  } catch (err) {
    console.error(`[enrichment] fundamentals lock-write failed for ${symbol}:`, err);
    return;
  }

  // BSE Expansion Phase 3A (2026-08-12) — `symbol` (the cache key / row
  // identity, e.g. "NSDL.BO") already carries the page's ".BO" suffix for a
  // BSE-only equity, but every fundamentals.ts fetcher appends its OWN
  // exchange suffix onto whatever ticker it's given — passing the full
  // ".BO"-suffixed symbol straight through would build a broken
  // "NSDL.BO.BO" Yahoo URL. Strip it back to the bare ticker here.
  const yahooTicker = exchange === "BSE" ? symbol.replace(/\.BO$/i, "") : symbol;
  const yahooSuffix: "NS" | "BO" = exchange === "BSE" ? "BO" : "NS";

  const [annual, quarterly, dividends, debtCoverage] = await Promise.all([
    fetchAnnualFundamentals(yahooTicker, yahooSuffix),
    fetchQuarterlyFundamentals(yahooTicker, yahooSuffix),
    fetchDividendHistory(yahooTicker, yahooSuffix),
    fetchDebtCoverage(yahooTicker, yahooSuffix),
  ]);

  const data: Prisma.InstrumentEnrichmentUpdateInput = {};
  if (annual.revenue) data.annualRevenue = annual.revenue as Prisma.InputJsonValue;
  if (annual.netIncome) data.annualNetIncome = annual.netIncome as Prisma.InputJsonValue;
  if (annual.dilutedEps) data.annualDilutedEps = annual.dilutedEps as Prisma.InputJsonValue;
  if (quarterly.revenue) data.quarterlyRevenue = quarterly.revenue as Prisma.InputJsonValue;
  if (quarterly.netIncome) data.quarterlyNetIncome = quarterly.netIncome as Prisma.InputJsonValue;
  if (quarterly.dilutedEps) data.quarterlyDilutedEps = quarterly.dilutedEps as Prisma.InputJsonValue;
  // dividends: null means the fetch itself failed (keep old value); [] is a
  // valid "no dividends declared" answer and MUST be written, not skipped.
  if (dividends !== null) data.dividends = dividends as Prisma.InputJsonValue;
  // debtCoverage: write when ANY series returned — per-series absence inside
  // the blob is the honest signal. `currencyCode` (Sprint 1, T1.1) is a
  // derived scalar, not a series, and must NOT count as "data" here — a
  // batch that returned a currencyCode but zero usable series (shouldn't
  // happen in practice, since currencyCode is only ever set from a series
  // that itself succeeded, but kept explicit for correctness) must still be
  // treated as a total failure, matching pre-T1.1 behavior exactly.
  const debtCoverageSeries = Object.fromEntries(Object.entries(debtCoverage).filter(([key]) => key !== "currencyCode"));
  if (Object.values(debtCoverageSeries).some((s) => s !== null)) data.debtCoverage = debtCoverage as unknown as Prisma.InputJsonValue;

  if (Object.keys(data).length === 0) return; // total failure across every series — nothing to persist.

  try {
    await prisma.instrumentEnrichment.update({ where: { symbol }, data });
  } catch (err) {
    console.error(`[enrichment] fundamentals result-write failed for ${symbol}:`, err);
  }
}

/**
 * Background on-demand news refresh (Decision 4). Same optimistic-lock
 * pattern as fundamentals. Writes land directly in the existing
 * `MarketMoveNews` table on its existing `dedupeKey`, upserted with the
 * SAME shape/logic the market-moves-news cron uses — any row this creates
 * is automatically picked up by both this page's own news query on the
 * NEXT visit and the cron's own future re-fetch, for free.
 */
async function refreshNewsInBackground(symbol: string, companyName: string): Promise<void> {
  const now = new Date();
  try {
    await prisma.instrumentEnrichment.upsert({
      where: { symbol },
      update: { newsLastCheckedAt: now, companyName },
      create: { symbol, companyName, newsLastCheckedAt: now },
    });
  } catch (err) {
    console.error(`[enrichment] news lock-write failed for ${symbol}:`, err);
    return;
  }

  const items = await fetchGoogleNewsForTicker(symbol, companyName);
  for (const item of items) {
    try {
      await prisma.marketMoveNews.upsert({
        where: { dedupeKey: item.dedupeKey },
        update: {
          headline: item.headline,
          publisher: item.publisher,
          sourceUrl: item.sourceUrl,
          publishedAt: item.publishedAt,
        },
        create: {
          tickerSymbol: item.tickerSymbol,
          companyName: item.companyName,
          headline: item.headline,
          publisher: item.publisher,
          sourceUrl: item.sourceUrl,
          dedupeKey: item.dedupeKey,
          publishedAt: item.publishedAt,
        },
      });
    } catch (err) {
      console.error(`[enrichment] news upsert failed for ${symbol} (${item.dedupeKey}):`, err);
    }
  }
}

/**
 * Read-through entry point. Always resolves fast (one indexed read) with
 * whatever's cached; may additionally kick off background refreshes that
 * this call does not wait on. Never throws.
 */
export async function getOrFetchInstrumentEnrichment(
  rawSymbol: string,
  companyName: string,
  exchange: "NSE" | "BSE" = "NSE"
): Promise<InstrumentEnrichmentData> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return EMPTY_INSTRUMENT_ENRICHMENT;

  let row: Awaited<ReturnType<typeof prisma.instrumentEnrichment.findUnique>> = null;
  try {
    row = await prisma.instrumentEnrichment.findUnique({ where: { symbol } });
  } catch (err) {
    console.error(`[enrichment] read failed for ${symbol}:`, err);
  }

  const fundamentalsStale =
    !row?.fundamentalsFetchedAt || Date.now() - row.fundamentalsFetchedAt.getTime() > FUNDAMENTALS_TTL_MS;
  if (fundamentalsStale) {
    void refreshFundamentalsInBackground(symbol, companyName, exchange).catch((err) =>
      console.error(`[enrichment] unhandled fundamentals refresh error for ${symbol}:`, err)
    );
  }

  const newsStale = !row?.newsLastCheckedAt || Date.now() - row.newsLastCheckedAt.getTime() > NEWS_TTL_MS;
  if (newsStale) {
    // Google News on-demand refresh is exchange-agnostic (a plain search by
    // ticker + company name, no Yahoo-suffix concept) — works unchanged for
    // a BSE-only company's full page symbol.
    void refreshNewsInBackground(symbol, companyName).catch((err) =>
      console.error(`[enrichment] unhandled news refresh error for ${symbol}:`, err)
    );
  }

  const keyStatsStale = !row?.keyStatsFetchedAt || Date.now() - row.keyStatsFetchedAt.getTime() > KEY_STATS_TTL_MS;
  if (keyStatsStale) {
    void refreshKeyStatsInBackground(symbol, companyName, exchange).catch((err) =>
      console.error(`[enrichment] unhandled key-stats refresh error for ${symbol}:`, err)
    );
  }

  if (!row) return EMPTY_INSTRUMENT_ENRICHMENT;

  return {
    annualRevenue: (row.annualRevenue as FundamentalsPoint[] | null) ?? null,
    annualNetIncome: (row.annualNetIncome as FundamentalsPoint[] | null) ?? null,
    annualDilutedEps: (row.annualDilutedEps as FundamentalsPoint[] | null) ?? null,
    quarterlyRevenue: (row.quarterlyRevenue as FundamentalsPoint[] | null) ?? null,
    quarterlyNetIncome: (row.quarterlyNetIncome as FundamentalsPoint[] | null) ?? null,
    quarterlyDilutedEps: (row.quarterlyDilutedEps as FundamentalsPoint[] | null) ?? null,
    dividends: (row.dividends as DividendRow[] | null) ?? null,
    keyStats: (row.keyStats as KeyStats | null) ?? null,
    debtCoverage: (row.debtCoverage as DebtCoverage | null) ?? null,
    fundamentalsFetchedAt: row.fundamentalsFetchedAt,
  };
}

/**
 * Background Key Stats refresh — same optimistic-lock pattern as the
 * fundamentals refresher: stamp keyStatsFetchedAt FIRST (cheap race guard),
 * then fetch via the crumb session and persist only on success (a transport/
 * auth failure keeps yesterday's snapshot rather than blanking it).
 *
 * Also computes Beta (1Y daily) / Beta (5Y monthly) against NIFTY 50 (see
 * fundamentals.ts's `computeBetas` and beta.ts's methodology doc comment) —
 * bundled into this same refresh cycle since both are part of the same Key
 * Stats tile grid and share the same daily TTL.
 *
 * `keyStats` is a single opaque JSON column, not per-field columns — an
 * `update` REPLACES the whole blob, it does not merge. `fetchKeyStats`
 * (crumb-gated quoteSummary) and `computeBetas` (plain chart-endpoint
 * fetches, no crumb) are independent failure domains: either can succeed
 * while the other fails. The upsert's returned row supplies the PREVIOUS
 * snapshot as a base so a fresh success on only one side still lands
 * without silently wiping the other side's last-known-good values.
 */
async function refreshKeyStatsInBackground(symbol: string, companyName: string, exchange: "NSE" | "BSE" = "NSE"): Promise<void> {
  const now = new Date();
  let previous: KeyStats | null = null;
  try {
    const row = await prisma.instrumentEnrichment.upsert({
      where: { symbol },
      update: { keyStatsFetchedAt: now, companyName },
      create: { symbol, companyName, keyStatsFetchedAt: now },
    });
    previous = (row.keyStats as KeyStats | null) ?? null;
  } catch (err) {
    console.error(`[enrichment] key-stats lock-write failed for ${symbol}:`, err);
    return;
  }

  // See refreshFundamentalsInBackground's identical comment on why the
  // page's ".BO"-suffixed symbol must be stripped back to a bare ticker
  // before it's handed to fundamentals.ts's Yahoo fetchers.
  const yahooTicker = exchange === "BSE" ? symbol.replace(/\.BO$/i, "") : symbol;
  const yahooSuffix: "NS" | "BO" = exchange === "BSE" ? "BO" : "NS";

  const [stats, betas] = await Promise.all([fetchKeyStats(yahooTicker, yahooSuffix), computeBetas(yahooTicker, yahooSuffix)]);
  const statsChanged = stats !== null && Object.keys(stats).length > 0;
  const betasChanged = betas.beta1Y != null || betas.beta5Y != null;
  if (!statsChanged && !betasChanged) return; // total failure on both sides → keep previous snapshot untouched

  const merged: KeyStats = { ...(previous ?? {}), ...(stats ?? {}) };
  if (betas.beta1Y != null) merged.beta1Y = betas.beta1Y;
  if (betas.beta5Y != null) merged.beta5Y = betas.beta5Y;

  try {
    await prisma.instrumentEnrichment.update({
      where: { symbol },
      data: { keyStats: merged as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error(`[enrichment] key-stats result-write failed for ${symbol}:`, err);
  }
}

/**
 * Warm-up batch processor for the warm-enrichment cron: awaits the SAME
 * refresh functions the read-through path fires (fundamentals + key stats;
 * news stays visit-driven — pre-fetching Google News for 2,100 unvisited
 * symbols would be ~waste and rate-limit risk for pages nobody opened).
 * Sequential with a small politeness delay between symbols.
 */
export async function warmEnrichmentBatch(
  batch: { symbol: string; companyName: string }[]
): Promise<{ processed: number; symbols: string[] }> {
  const symbols: string[] = [];
  for (const { symbol, companyName } of batch) {
    try {
      await refreshFundamentalsInBackground(symbol, companyName);
      await refreshKeyStatsInBackground(symbol, companyName);
      symbols.push(symbol);
    } catch (err) {
      console.error(`[enrichment] warm batch failed for ${symbol}:`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { processed: symbols.length, symbols };
}
