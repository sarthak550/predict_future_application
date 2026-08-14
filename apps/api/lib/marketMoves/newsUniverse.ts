/**
 * Market Pulse (Phase 1c) — builds the capped ticker universe the news cron
 * fetches Google News for on each run. Google News is queried per-stock (no
 * single feed covers "all Indian stocks"), so the universe must stay small
 * and high-signal per run — never everything at once (see Decision 1 in the
 * CTO assignment brief).
 *
 * HOT lane (unchanged since Phase 1c), union of:
 *   - Top Movers: today's MarketMoverSnapshot, rank <= 10 per direction
 *     (20 tickers) — deeper than the mobile strip's visible 5+5 since movers
 *     rotate through the session and this is a fetch-side cap, not a display cap.
 *   - Material-filing tickers: distinct tickerSymbol from MarketMoveEvent in
 *     the last 24h with eventType != OTHER_MATERIAL (reusing the existing
 *     classifier as a free relevance filter), capped at 40, most-recent-first.
 *   Deduped, capped at 60, movers first (the smaller, higher-attention set).
 *
 * ROTATION lane (2026-08-15, founder: "ensure that we fetch stock news for
 * all" companies) — a deterministic slice of the FULL company universe (NSE
 * latest-session symbols + BSE-only equities above the platform turnover
 * floor) appended after the hot lane. Stateless: slot index derives from the
 * wall clock (30-min buckets, matching the cron cadence) modulo the number
 * of slices, so every company is covered without any cursor row to persist,
 * and a missed/failed run just means that slot's slice is picked up next
 * cycle. Coverage math at current scale: ~2,000 NSE names with real company
 * names + ~2,000 above-floor BSE names ≈ 4,100 / 120-per-run ≈ 35 slots;
 * the rotation advances on EVERY 30-min crontab tick around the clock
 * (rotation-only mode outside the 08:00-21:00 IST window — see
 * buildNewsUniverse), so 48 runs/day cycles the whole universe every ~17h.
 * Between rotations, a company's news stays fresh via the hot lane (if it
 * moves or files) and apps/web's per-page-view on-demand refresh (6h TTL,
 * exchange-agnostic — enrichment.ts).
 *
 * NSE rows whose companyName is just the ticker duplicated are SKIPPED in
 * the rotation lane — those are ETFs (the bhavcopy carries no fund names),
 * and a Google News query for `"NIFTYBEES" (share OR shares OR stock)` is
 * noise, not coverage. BSE tickers rotate under their `.BO` page symbol so
 * the stored rows join to their instrument page exactly like the on-demand
 * path's.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getIstSessionDate } from "./marketHours";

const TOP_MOVERS_PER_DIRECTION = 10;
const MATERIAL_FILING_LOOKBACK_HOURS = 24;
const MATERIAL_FILING_TICKER_CAP = 40;
const UNIVERSE_HARD_CAP = 60;
/** Rotation-lane slice per run — env-tunable (NEWS_ROTATION_SLICE). 120 (founder 2026-08-15: "2.6 days is long") puts a full hot+rotation run around ~4 min at the cron's 400ms inter-request spacing — just inside run-cron.sh's 290s curl cap, and the route keeps running server-side even if the curl client gives up first. 0 disables the lane. */
const ROTATION_SLICE_SIZE = Math.max(0, Number(process.env.NEWS_ROTATION_SLICE ?? 120) || 0);
/** Wall-clock bucket the rotation slot derives from — matches the cron's 30-min cadence so consecutive runs advance one slice. */
const ROTATION_SLOT_MS = 30 * 60 * 1000;
/** Mirrors apps/web/lib/finance/bseEquity.ts's MIN_BSE_EQUITY_TURNOVER_RS + 30-session window (no cross-app import path — keep in sync). */
const MIN_BSE_TURNOVER_RS = 100_000;
const BSE_WINDOW_SESSIONS = 30;

export type NewsUniverseTicker = {
  tickerSymbol: string;
  companyName: string;
};

/**
 * Builds this run's capped ticker universe. Never throws — a failure on any
 * lane degrades to an empty contribution from that lane rather than failing
 * the whole build, so a partial universe is still fetched.
 *
 * `rotationOnly` (2026-08-15): outside the 08:00-21:00 IST news window the
 * hot lane is pointless (movers/filings don't change overnight or on
 * weekends) but the rotation lane isn't — the cron already fires every 30
 * min around the clock, and those off-window ticks now advance the rotation
 * instead of no-oping. That's what compresses full-universe coverage from
 * ~2.6 days (27 window runs/day at 60/slice) to ~17h (48 runs/day at
 * 120/slice).
 */
export async function buildNewsUniverse(
  now: Date = new Date(),
  options: { rotationOnly?: boolean } = {}
): Promise<NewsUniverseTicker[]> {
  if (options.rotationOnly) {
    return fetchRotationSlice(now, new Set()).catch((err: unknown) => {
      console.error("[marketMoves/newsUniverse] rotation slice failed:", err);
      return [] as NewsUniverseTicker[];
    });
  }

  const [moverTickers, filingTickers] = await Promise.all([
    fetchTopMoverTickers(now).catch((err: unknown) => {
      console.error("[marketMoves/newsUniverse] mover lookup failed:", err);
      return [] as NewsUniverseTicker[];
    }),
    fetchMaterialFilingTickers(now).catch((err: unknown) => {
      console.error("[marketMoves/newsUniverse] filing lookup failed:", err);
      return [] as NewsUniverseTicker[];
    }),
  ]);

  // BSE-filing tickers arrive in the `BSE:{scripCode}` announcement
  // namespace — news stored under that key is invisible to every instrument
  // page (pages read bare-NSE / `.BO` symbols). A code that resolves in
  // BseEodQuote is a BSE-EXCLUSIVE company → rewrite to its `.BO` page
  // symbol so its fetched news lands where the page actually looks. An
  // unresolvable code (dual-listed company whose name-based NSE resolution
  // failed upstream, or a non-equity scrip) keeps the raw key — status quo,
  // still visible on /pulse's global feed.
  const resolvedFilingTickers = await mapBseFilingTickers(filingTickers).catch((err: unknown) => {
    console.error("[marketMoves/newsUniverse] BSE filing-ticker mapping failed:", err);
    return filingTickers;
  });

  const seen = new Set<string>();
  const universe: NewsUniverseTicker[] = [];

  // Movers first — the smaller, higher-attention set (Decision 1 priority order).
  for (const ticker of [...moverTickers, ...resolvedFilingTickers]) {
    const key = ticker.tickerSymbol.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    universe.push(ticker);
    if (universe.length >= UNIVERSE_HARD_CAP) break;
  }

  // Rotation lane appended AFTER the hot lane (hot names fetch first so a
  // long run degrades gracefully if it's ever cut short). Failure degrades
  // to hot-lane-only, same contract as the two halves above.
  const rotation = await fetchRotationSlice(now, seen).catch((err: unknown) => {
    console.error("[marketMoves/newsUniverse] rotation slice failed:", err);
    return [] as NewsUniverseTicker[];
  });
  universe.push(...rotation);

  return universe;
}

/** Rewrites `BSE:{scripCode}` filing tickers to their `.BO` page symbol where the code resolves to a BSE-exclusive equity — see the call site's comment. Raw DISTINCT ON (Prisma's findMany distinct is client-side emulation). */
async function mapBseFilingTickers(tickers: NewsUniverseTicker[]): Promise<NewsUniverseTicker[]> {
  const codes = tickers
    .filter((t) => t.tickerSymbol.startsWith("BSE:"))
    .map((t) => t.tickerSymbol.slice(4))
    .filter(Boolean);
  if (codes.length === 0) return tickers;

  const rows = await prisma.$queryRaw<Array<{ scripCode: string; tickerSymbol: string }>>`
    SELECT DISTINCT ON ("scripCode") "scripCode", "tickerSymbol"
    FROM "BseEodQuote"
    WHERE "scripCode" IN (${Prisma.join(codes)})
    ORDER BY "scripCode" ASC, "sessionDate" DESC
  `;
  const byCode = new Map(rows.map((r) => [r.scripCode, r.tickerSymbol]));

  return tickers.map((t) => {
    if (!t.tickerSymbol.startsWith("BSE:")) return t;
    const mapped = byCode.get(t.tickerSymbol.slice(4));
    return mapped ? { ...t, tickerSymbol: `${mapped.toUpperCase()}.BO` } : t;
  });
}

/**
 * The rotation lane's slice for this run — see module doc. `excludeKeys` is
 * the hot lane's already-selected tickers (uppercased) so a slot never
 * double-fetches a name the hot lane is covering this same run.
 */
async function fetchRotationSlice(now: Date, excludeKeys: ReadonlySet<string>): Promise<NewsUniverseTicker[]> {
  if (ROTATION_SLICE_SIZE === 0) return [];

  const latestNse = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  const [nseRows, bseRows] = await Promise.all([
    latestNse
      ? prisma.stockEodQuote.findMany({
          where: { sessionDate: latestNse.sessionDate },
          select: { symbol: true, companyName: true },
        })
      : Promise.resolve([]),
    // Above-floor BSE-only names with their latest companyName — raw SQL
    // (GROUP BY + DISTINCT ON): Prisma's findMany distinct is client-side
    // emulation (see apps/web/lib/finance/latestQuotes.ts's module doc).
    prisma.$queryRaw<Array<{ tickerSymbol: string; companyName: string }>>`
      WITH window_dates AS (
        SELECT DISTINCT "sessionDate" FROM "BseEodQuote"
        ORDER BY "sessionDate" DESC LIMIT ${BSE_WINDOW_SESSIONS}
      ),
      above_floor AS (
        SELECT "tickerSymbol" FROM "BseEodQuote"
        WHERE "sessionDate" IN (SELECT "sessionDate" FROM window_dates)
        GROUP BY "tickerSymbol"
        HAVING MAX("close" * "volume") > ${MIN_BSE_TURNOVER_RS}
      )
      SELECT DISTINCT ON (q."tickerSymbol") q."tickerSymbol", q."companyName"
      FROM "BseEodQuote" q
      WHERE q."sessionDate" IN (SELECT "sessionDate" FROM window_dates)
        AND q."tickerSymbol" IN (SELECT "tickerSymbol" FROM above_floor)
      ORDER BY q."tickerSymbol" ASC, q."sessionDate" DESC
    `,
  ]);

  const full: NewsUniverseTicker[] = [
    // companyName === symbol rows are ETFs (no real name in the bhavcopy) —
    // skipped, see module doc.
    ...nseRows
      .filter((r) => r.companyName && r.companyName.trim().toUpperCase() !== r.symbol.trim().toUpperCase())
      .map((r) => ({ tickerSymbol: r.symbol, companyName: r.companyName })),
    // Fund-unit rows are skipped: BSE's equity series carries listed fund
    // units whose companyName is just the AMC (live sample: 08GPG/11GPG →
    // "Nippon India Mutual Fund") — a Google News query for the AMC's name
    // would attach house-level news to a single scheme's page. Heuristic
    // name filter (no AMFI registry on this side of the app boundary).
    ...bseRows
      .filter((r) => !/MUTUAL FUND|\bETF\b|\bFUND\b/i.test(r.companyName))
      .map((r) => ({
        tickerSymbol: `${r.tickerSymbol.toUpperCase()}.BO`,
        companyName: r.companyName,
      })),
  ]
    .filter((t) => !excludeKeys.has(t.tickerSymbol.trim().toUpperCase()))
    .sort((a, b) => a.tickerSymbol.localeCompare(b.tickerSymbol));

  if (full.length === 0) return [];
  const numSlots = Math.ceil(full.length / ROTATION_SLICE_SIZE);
  const slot = Math.floor(now.getTime() / ROTATION_SLOT_MS) % numSlots;
  return full.slice(slot * ROTATION_SLICE_SIZE, (slot + 1) * ROTATION_SLICE_SIZE);
}

async function fetchTopMoverTickers(now: Date): Promise<NewsUniverseTicker[]> {
  const sessionDate = getIstSessionDate(now);
  // MarketMoverSnapshot now carries TWO parallel universes per session (see the
  // Top Movers universe toggle) — pin to "ALL" so this stays the original ~20
  // tickers (rank <= 10 per direction) the doc comment above promises, instead
  // of silently doubling to ~40 by pulling both universes' top-10s.
  const rows = await prisma.marketMoverSnapshot.findMany({
    where: { sessionDate, universe: "ALL", rank: { lte: TOP_MOVERS_PER_DIRECTION } },
    select: { tickerSymbol: true, companyName: true, direction: true, rank: true },
    orderBy: [{ direction: "asc" }, { rank: "asc" }],
  });

  return rows.map((r) => ({ tickerSymbol: r.tickerSymbol, companyName: r.companyName }));
}

async function fetchMaterialFilingTickers(now: Date): Promise<NewsUniverseTicker[]> {
  const since = new Date(now.getTime() - MATERIAL_FILING_LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await prisma.marketMoveEvent.findMany({
    where: {
      announcedAt: { gte: since },
      eventType: { not: "OTHER_MATERIAL" },
    },
    select: { tickerSymbol: true, companyName: true },
    // orderBy before distinct → Postgres DISTINCT ON (tickerSymbol) ORDER BY
    // announcedAt DESC, so we keep the most-recent filing's company name per ticker.
    orderBy: { announcedAt: "desc" },
    distinct: ["tickerSymbol"],
    take: MATERIAL_FILING_TICKER_CAP,
  });

  return rows.map((r) => ({ tickerSymbol: r.tickerSymbol, companyName: r.companyName }));
}
