/**
 * POST /api/cron/market-moves-movers
 *
 * Market Pulse — two enrichment sources feed `MarketMoverSnapshot`, one row
 * per (sessionDate, universe, tickerSymbol). Both sources write BOTH movers
 * universes every run — "ALL" (every listed security, no market-cap cap) and
 * "POPULAR" (NIFTY 100 constituents, the recognizable large-cap names) — so
 * the Top Movers universe toggle always has fresh data on either side:
 *
 *  1. LIVE (intraday): polls NSE's `allSec` live-variations endpoint (see
 *     apps/api/lib/marketMoves/nse.ts — the same Akamai-blocking caveat
 *     documented there applies here). Hard-capped by NSE itself at the
 *     top ~20 gainers/losers; we store the top 25 of whatever it returns.
 *     Weekday + market-hours gated (09:15-15:30 IST, Mon-Fri) — silently
 *     no-ops outside that window rather than upserting stale/closed-market
 *     snapshots from the live endpoint. No holiday-calendar awareness in
 *     Phase 1 (see marketHours.ts doc comment).
 *
 *  2. EOD (full-market): fetches NSE's keyless end-of-day bhavcopy CSV ONCE
 *     (see apps/api/lib/marketMoves/bhavcopy.ts's fetchBhavcopySession)
 *     covering EVERY listed EQ-series security (~2,380 names, ~1,993 after a
 *     liquidity filter) and derives TWO shapes from that single fetch:
 *       - the top 100 gainers/losers by % change → `MarketMoverSnapshot`
 *         (not capped at 20/direction like the live endpoint), and
 *       - every liquid (volume > 1,000) name's close/prevClose/volume/
 *         delivery% → `StockEodQuote` (Market Pulse Phase 2 — powers the
 *         /instruments/[symbol] detail page + mobile stock sheet, and is
 *         also the intended future portfolio-valuation source, so it's
 *         written unconditionally on every EOD pass regardless of whether
 *         the session happened to produce any movers).
 *     This pass runs when either:
 *       (a) the request is `?source=eod` explicitly, or
 *       (b) the request lands outside market hours (i.e. the case where the
 *           live-pass gate above would otherwise just skip) AND that day's
 *           bhavcopy file has already been published by NSE (it typically
 *           appears some time after the 15:30 IST close; requesting it
 *           earlier — or on a weekend/holiday with no session — 404s, in
 *           which case this run falls back to the original "skipped"
 *           no-op response).
 *     Re-running the EOD pass simply re-upserts the same ~200 rows
 *     (idempotent) with fresh ranks — safe to hit repeatedly through the
 *     evening until the file appears.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header). Intended
 * cadence — mirrors the existing EC2 crontab pattern (see run-cron.sh):
 *   LIVE, every 15 min during market hours:
 *     15,30,45,0 9-15 * * 1-5 curl -s -X POST https://<host>/api/cron/market-moves-movers \
 *         -H "Authorization: Bearer $CRON_SECRET"
 *   EOD, once after close (19:15 IST = 13:45 UTC), explicit ?source=eod so
 *   it doesn't depend on the outside-market-hours auto-fallback timing:
 *     45 13 * * 1-5 curl -s -X POST "https://<host>/api/cron/market-moves-movers?source=eod" \
 *         -H "Authorization: Bearer $CRON_SECRET"
 *   (run-cron.sh on the box currently takes just a route name and has no
 *   query-string passthrough — recommend either extending it to accept an
 *   optional second arg appended as `?source=eod`, or adding this as a
 *   standalone crontab line with the raw curl command above. Not applied to
 *   the crontab as part of this change — see CTO report.)
 *   (the crontab's own schedule is a coarse filter; this route's own gates
 *   are the source of truth and safely no-op if the crontab fires
 *   early/late/on a holiday).
 *
 * isUnusualVolume is a same-day cross-sectional heuristic (today's volume vs.
 * the median of today's scanned universe) — see schema doc comment on
 * MarketMoverSnapshot for why this isn't a true historical rolling average.
 * Computed identically (median of the batch being upserted) for both the
 * LIVE and EOD passes.
 *
 * Prod note: run `prisma db push` to land the MarketMoverSnapshot model
 * before activating this cron (already applied — see Phase 1 notes).
 */

import { NextResponse } from "next/server";

import { fetchBhavcopySession, type FetchedEodQuote } from "@/lib/marketMoves/bhavcopy";
import { fetchNseMovers, type FetchedMoversByUniverse } from "@/lib/marketMoves/nse";
import type { FetchedMarketMover } from "@/lib/marketMoves/types";
import { isNseWeekdayMarketHours, getIstSessionDate } from "@/lib/marketMoves/marketHours";
import { prisma } from "@/lib/prisma";
import { notifyWebRevalidate } from "@/lib/webRevalidate";

/** MarketMoverSnapshot's `universe` column values — see the schema doc comment. */
type MoversUniverse = "ALL" | "POPULAR";

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

/** Simple median helper for the cross-sectional unusual-volume heuristic. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const UNUSUAL_VOLUME_MULTIPLE = 3;
const TOP_N_PER_DIRECTION_LIVE = 100; // union of NSE's variation groups yields ~60–90/direction; never cap below what the source provides
const TOP_N_PER_DIRECTION_EOD = 100; // full-market pass: NSE's bhavcopy has no 20/direction cap, so we can store far deeper

/**
 * Shared upsert path for both the LIVE and EOD passes: enriches company
 * names, computes the cross-sectional unusual-volume heuristic and rank,
 * and upserts into MarketMoverSnapshot keyed on (sessionDate, universe,
 * tickerSymbol). Re-running with the same (sessionDate, universe) is
 * idempotent — later ranks simply overwrite earlier ones for that day.
 */
async function upsertMovers(
  movers: FetchedMarketMover[],
  sessionDate: Date,
  topNPerDirection: number,
  universe: MoversUniverse
): Promise<{ gainers: number; losers: number; upserted: number; failed: number }> {
  // Enrichment: fall back to the most recently seen announcement company name
  // for any symbol whose mover row didn't resolve one (e.g. missing from the
  // equity master) before falling back to the raw ticker.
  const symbols = movers.map((m) => m.tickerSymbol);
  const knownCompanies = await prisma.marketMoveEvent.findMany({
    where: { tickerSymbol: { in: symbols }, source: "NSE" },
    select: { tickerSymbol: true, companyName: true },
    // orderBy before distinct → Postgres DISTINCT ON (tickerSymbol) ORDER BY
    // announcedAt DESC, so we get the MOST RECENT company name per symbol.
    orderBy: { announcedAt: "desc" },
    distinct: ["tickerSymbol"],
  });
  const companyNameBySymbol = new Map(knownCompanies.map((c) => [c.tickerSymbol, c.companyName]));

  const volumes = movers.map((m) => m.volume).filter((v) => v > 0);
  const medianVolume = median(volumes);

  const gainers = movers
    .filter((m) => m.direction === "GAINER")
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, topNPerDirection);
  const losers = movers
    .filter((m) => m.direction === "LOSER")
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, topNPerDirection);

  // REPLACE the session's (sessionDate, universe) rows atomically instead of
  // upserting by ticker. Upserting left orphans behind: a symbol written by an
  // earlier pass (e.g. the intraday top-20) that doesn't appear in a later pass
  // (the EOD top-100) kept its old rank/percent — so generations of writes
  // interleaved and the "sorted" list came out shuffled with duplicate ranks.
  // Delete-then-create in one transaction guarantees each pass owns the whole
  // (session, universe) snapshot — scoped to `universe` so writing one universe
  // never clobbers the other's rows for the same session.
  const now = new Date();
  const rows = [...gainers, ...losers].flatMap((m, idx) => {
    const rank = (idx < gainers.length ? idx : idx - gainers.length) + 1;
    const isUnusualVolume = medianVolume > 0 && m.volume >= medianVolume * UNUSUAL_VOLUME_MULTIPLE;
    // Name priority: a resolved name on the mover row itself (equity-master
    // match, in either fetcher) wins; only when the symbol was unmapped there
    // (companyName === ticker) do we fall back to an announcement-derived
    // name, then the ticker.
    const resolvedName = m.companyName !== m.tickerSymbol ? m.companyName : null;
    const companyName = resolvedName ?? companyNameBySymbol.get(m.tickerSymbol) ?? m.companyName;
    return [{
      sessionDate,
      universe,
      tickerSymbol: m.tickerSymbol,
      companyName,
      changePercent: m.changePercent,
      changeAbs: m.changeAbs,
      volume: m.volume,
      lastPrice: m.lastPrice,
      avgVolume: null,
      isUnusualVolume,
      direction: m.direction,
      rank,
      snapshotAt: now,
    }];
  });

  let upserted = 0;
  let failed = 0;
  try {
    await prisma.$transaction([
      prisma.marketMoverSnapshot.deleteMany({ where: { sessionDate, universe } }),
      prisma.marketMoverSnapshot.createMany({ data: rows, skipDuplicates: true }),
    ]);
    upserted = rows.length;
  } catch (err) {
    failed = rows.length;
    console.error(`[cron/market-moves-movers] session replace failed (universe=${universe}):`, err);
  }

  return { gainers: gainers.length, losers: losers.length, upserted, failed };
}

/** Per-universe result shape shared by the LIVE and EOD pass responses. */
type UniversePassResult =
  | { fetched: number; upserted: number; reason: "no_data" }
  | { fetched: number; gainers: number; losers: number; upserted: number; failed: number };

/** Upserts one universe's movers, or reports "no_data" without writing anything for an empty fetch. */
async function upsertUniverse(
  movers: FetchedMarketMover[],
  sessionDate: Date,
  topNPerDirection: number,
  universe: MoversUniverse
): Promise<UniversePassResult> {
  if (movers.length === 0) {
    return { fetched: 0, upserted: 0, reason: "no_data" };
  }
  const result = await upsertMovers(movers, sessionDate, topNPerDirection, universe);
  return { fetched: movers.length, ...result };
}

/** Runs the intraday LIVE pass (NSE's capped ~top-20/direction variations endpoint) for BOTH universes. */
async function runLivePass(sessionDate: Date) {
  const moversByUniverse = await fetchNseMovers().catch((err: unknown) => {
    console.error("[cron/market-moves-movers] NSE live fetch threw unexpectedly:", err);
    return { all: [], popular: [] } as FetchedMoversByUniverse;
  });

  // Sequential, not Promise.all: each pass is its own delete+create transaction
  // scoped to a disjoint `universe`, but running them one at a time keeps write
  // load on the DB predictable rather than doubling concurrent transactions.
  const all = await upsertUniverse(moversByUniverse.all, sessionDate, TOP_N_PER_DIRECTION_LIVE, "ALL");
  const popular = await upsertUniverse(moversByUniverse.popular, sessionDate, TOP_N_PER_DIRECTION_LIVE, "POPULAR");

  await notifyWebRevalidate(["/pulse", "/"]);
  return NextResponse.json({ ok: true, source: "live", all, popular });
}

/** Batch size for StockEodQuote createMany calls — keeps each INSERT's param count modest even though a single ~2,000-row call is well within Postgres's per-query param limit. */
const QUOTE_UPSERT_BATCH_SIZE = 500;

/**
 * Idempotent full-quote-universe write into StockEodQuote, keyed on
 * (sessionDate, symbol). Uses createMany/skipDuplicates rather than
 * MarketMoverSnapshot's delete-then-create session-replace pattern: unlike
 * the movers pass (which can legitimately re-rank across repeated runs before
 * the file is final), a published bhavcopy session's quotes are immutable —
 * once a (sessionDate, symbol) row exists it never needs to change, so
 * skipping duplicates on rerun is both correct and cheaper than a
 * delete+reinsert.
 */
async function upsertQuotes(
  quotes: FetchedEodQuote[],
  sessionDate: Date
): Promise<{ upserted: number; failed: number }> {
  const rows = quotes.map((q) => ({
    sessionDate,
    symbol: q.symbol,
    companyName: q.companyName,
    prevClose: q.prevClose,
    close: q.close,
    changePercent: q.changePercent,
    volume: Math.round(q.volume),
    deliveryPct: q.deliveryPct,
  }));

  let upserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += QUOTE_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + QUOTE_UPSERT_BATCH_SIZE);
    try {
      const result = await prisma.stockEodQuote.createMany({ data: batch, skipDuplicates: true });
      upserted += result.count;
    } catch (err) {
      failed += batch.length;
      console.error(`[cron/market-moves-movers] StockEodQuote batch upsert failed (offset ${i}):`, err);
    }
  }
  return { upserted, failed };
}

/** Runs the EOD full-market pass (NSE's uncapped bhavcopy) for BOTH universes. Returns null if the file isn't published yet. */
async function runEodPass(sessionDate: Date): Promise<ReturnType<typeof NextResponse.json> | null> {
  const session = await fetchBhavcopySession(sessionDate).catch((err: unknown) => {
    console.error("[cron/market-moves-movers] EOD bhavcopy fetch threw unexpectedly:", err);
    return null;
  });

  if (!session) return null; // not published yet / no session that day — let the caller decide the response
  const { allMovers, popularMovers, quotes } = session;

  // Write the full quote universe unconditionally — it doesn't depend on
  // there being any movers this session, and is the instrument-detail /
  // future-portfolio-valuation source of truth.
  const quotesResult = await upsertQuotes(quotes, sessionDate);
  const quotesJson = { fetched: quotes.length, ...quotesResult };

  const all = await upsertUniverse(allMovers, sessionDate, TOP_N_PER_DIRECTION_EOD, "ALL");
  const popular = await upsertUniverse(popularMovers, sessionDate, TOP_N_PER_DIRECTION_EOD, "POPULAR");

  await notifyWebRevalidate(["/pulse", "/", ["/instruments/[symbol]", "page"]]);
  return NextResponse.json({ ok: true, source: "eod", all, popular, quotes: quotesJson });
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");
  const sessionDate = getIstSessionDate();

  // Explicit EOD trigger: always attempts the bhavcopy pass regardless of
  // market hours (this is precisely how the file is meant to be pulled — the
  // evening after close). Reports the "not published yet" case explicitly
  // rather than falling through to the live pass, since the caller asked for
  // EOD specifically.
  if (sourceParam === "eod") {
    const eodResult = await runEodPass(sessionDate);
    return eodResult ?? NextResponse.json({ ok: true, source: "eod", skipped: "not_yet_published" });
  }

  // `?force=1` bypasses the market-hours gate for a manual LIVE backfill —
  // NSE's live endpoint still returns the last session's closing movers after
  // close, so a forced run outside hours populates today's gainers AND losers
  // on demand.
  const force = url.searchParams.get("force") === "1";
  if (!force && !isNseWeekdayMarketHours()) {
    // Outside market hours and not forced — this is where the LIVE pass would
    // previously just no-op. Before giving up, opportunistically try the EOD
    // bhavcopy: if NSE has already published today's file by the time this
    // cron tick lands, we get a full-market enrichment instead of nothing.
    const eodResult = await runEodPass(sessionDate);
    if (eodResult) return eodResult;
    return NextResponse.json({ ok: true, skipped: "outside_market_hours" });
  }

  return runLivePass(sessionDate);
}

export const GET = run;
export const POST = run;
