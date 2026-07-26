/**
 * Market Pulse — NSE End-of-Day "bhavcopy" (full-market) movers fetcher.
 *
 * The intraday movers cron (nse.ts `fetchNseMovers`) is capped at the top-20
 * gainers/losers PER DIRECTION by NSE's own `live-analysis-variations`
 * endpoint — there is no way to ask that endpoint for more. NSE separately
 * publishes a full end-of-day bhavcopy (every listed security, every series)
 * as a keyless, cookie-free CSV on the same archives host already used for
 * the equity-master CSV in nse.ts:
 *
 *   GET https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
 *
 * Verified 2026-07-19 (against 17 Jul 2026's file): plain CSV, NOT
 * RFC4180-quoted, but every cell has a leading space after its comma
 * (`SYMBOL, SERIES, DATE1, ...` — note the space before `SERIES`), so every
 * cell must be trimmed. Header row:
 *   SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE,
 *   LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS,
 *   NO_OF_TRADES, DELIV_QTY, DELIV_PER
 *
 * We restrict to SERIES === 'EQ' (excludes BE/BZ/other series — ~2,380 of
 * the file's rows are EQ) and to TTL_TRD_QNTY > 10,000 (drops ~387
 * zero/near-zero-liquidity rows, leaving ~1,993 tradeable names). Verified
 * the resulting top/bottom movers match the live `allSec` movers endpoint
 * exactly for the same session (RELAXO +19.99% / GRINDWELL -12.41% on
 * 17 Jul 2026).
 *
 * Bonds informational layer: the same file also carries GS (Government
 * Securities) and GB (Sovereign Gold Bond) series rows, which `shapeMovers`/
 * `shapeQuotes` skip (EQ-only) but `shapeBonds` below captures into a
 * separate `BondEodQuote` table — see bondName.ts for the symbol→display-name
 * parser and the Bonds informational-layer brief for why bonds are
 * deliberately NOT mixed into `StockEodQuote`.
 *
 * The file is published by NSE some time after the close (evening IST) —
 * requesting the current IST session's date before it's published, or on a
 * weekend/holiday with no session at all, returns 404. `fetchBhavcopyMovers`
 * treats a 404 or any network/parse error as "not available yet", returning
 * `null` rather than throwing, so the cron can fall back to a no-op rather
 * than crash. This mirrors `fetchEquityNames`'s never-throws contract in
 * nse.ts, but returns `null` (not `[]`) specifically so the cron route can
 * distinguish "not published yet" from "published but genuinely empty".
 *
 * Top Movers universe toggle: `fetchBhavcopyMovers`/`fetchBhavcopySession` also
 * derive a "Popular" (NIFTY 100) universe by filtering the same parsed rows to
 * NIFTY 100 constituents (see `fetchNifty100Symbols`, a second keyless archives
 * CSV) before the top-100/direction cut — mirroring the live pass's NIFTY +
 * NIFTYNEXT50 merge in nse.ts.
 */

import { parseBondDisplayName } from "./bondName";
import { fetchEquityNames } from "./nse";
import type { FetchedMarketMover } from "./types";

const NSE_ARCHIVES_ORIGIN = "https://nsearchives.nseindia.com";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Same header shape as nse.ts's HTML_HEADERS — the archives host has never
// required the Akamai cookie handshake the main site's /api/* routes need.
const ARCHIVE_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/csv,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

const FETCH_TIMEOUT_MS = 20_000;

/** Minimum today's traded quantity for a row to count as a liquid, tradeable name. */
const MIN_LIQUIDITY_QTY = 10_000;

/**
 * NIFTY 100 constituent list — keyless CSV, same archives host (no Akamai cookie
 * handshake needed) as the equity-master CSV in nse.ts. Used to filter the EOD
 * bhavcopy down to the "Popular" movers universe (NIFTY 100 = the recognizable
 * large-cap names), mirroring the live pass's NIFTY + NIFTYNEXT50 merge.
 * Header row: "Company Name,Industry,Symbol,Series,ISIN Code" (no quoted fields);
 * Symbol is the 3rd-from-last column. Cached in-module for 12h, same TTL/pattern
 * as fetchEquityNames — index membership only changes on periodic NSE rebalances.
 */
const NSE_NIFTY100_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv";
const NIFTY100_TTL_MS = 12 * 60 * 60 * 1000;
let nifty100Cache: { at: number; symbols: Set<string> } | null = null;

/** Parses ind_nifty100list.csv ("Company Name,Industry,Symbol,Series,ISIN Code") → symbol set. */
function parseNifty100Csv(csv: string): Set<string> {
  const symbols = new Set<string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(",").map((c) => c.trim());
    // No quoted fields / no embedded commas — Symbol is always 3rd-from-last
    // (…,Symbol,Series,ISIN Code), robust to "Company Name" itself containing commas.
    if (cells.length < 3) continue;
    const symbol = cells[cells.length - 3];
    if (symbol) symbols.add(symbol);
  }
  return symbols;
}

/**
 * Returns the current NIFTY 100 constituent symbol set. Cached 12h. On any
 * fetch/parse failure returns the last good cache (or an empty set) so a
 * membership check never blocks or breaks the movers pipeline — an empty set
 * simply yields an empty Popular universe for that pass rather than throwing.
 */
export async function fetchNifty100Symbols(): Promise<Set<string>> {
  const now = Date.now();
  if (nifty100Cache && now - nifty100Cache.at < NIFTY100_TTL_MS) {
    return nifty100Cache.symbols;
  }
  try {
    const res = await fetch(NSE_NIFTY100_URL, { headers: ARCHIVE_HEADERS });
    if (!res.ok) {
      console.warn(`[marketMoves/bhavcopy] NIFTY 100 list CSV returned ${res.status}`);
      return nifty100Cache?.symbols ?? new Set();
    }
    const symbols = parseNifty100Csv(await res.text());
    if (symbols.size > 0) nifty100Cache = { at: now, symbols };
    return nifty100Cache?.symbols ?? symbols;
  } catch (err) {
    console.warn(`[marketMoves/bhavcopy] NIFTY 100 list CSV fetch error: ${err instanceof Error ? err.message : err}`);
    return nifty100Cache?.symbols ?? new Set();
  }
}

/** How many names per direction the cron stores (mirrors TOP_N_PER_DIRECTION headroom, x4). */
const TOP_N_PER_DIRECTION = 100;

/** Builds the DDMMYYYY-suffixed bhavcopy URL for a given IST session date. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date {dd,mm,yyyy} of an IST-midnight-as-UTC session instant. */
function istDateParts(sessionDate: Date): { dd: string; mm: string; yyyy: number } {
  // sessionDate is an IST-midnight instant expressed in UTC (e.g. the Monday
  // 20 Jul IST session is stored as 2026-07-19T18:30Z) — so its raw UTC date
  // components are the PREVIOUS day. Shift by the IST offset first. (Getting
  // this wrong once fetched Sunday's URL, which NSE happily serves with
  // FRIDAY's data inside — see the DATE1 validation below.)
  const ist = new Date(sessionDate.getTime() + IST_OFFSET_MS);
  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: ist.getUTCFullYear(),
  };
}

function bhavcopyUrl(sessionDate: Date): string {
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  return `${NSE_ARCHIVES_ORIGIN}/products/content/sec_bhavdata_full_${dd}${mm}${yyyy}.csv`;
}

/** One parsed+trimmed bhavcopy row, columns we actually use. */
type BhavcopyRow = {
  symbol: string;
  series: string;
  prevClose: number;
  closePrice: number;
  ttlTrdQnty: number;
  /** DELIV_PER — delivery percentage. Null when the source cell is '-' (not published for this series) or unparseable. */
  deliveryPct: number | null;
};

/** Parses the bhavcopy CSV text into typed rows. Skips any malformed line rather than throwing. */
function parseBhavcopyCsv(csv: string): BhavcopyRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((c) => c.trim().toUpperCase());
  const idx = (name: string) => header.indexOf(name);
  const symbolIdx = idx("SYMBOL");
  const seriesIdx = idx("SERIES");
  const prevCloseIdx = idx("PREV_CLOSE");
  const closePriceIdx = idx("CLOSE_PRICE");
  const ttlTrdQntyIdx = idx("TTL_TRD_QNTY");
  // DELIV_PER is optional in principle (absent on very old/odd archive files) —
  // unlike the other five columns this doesn't fail the whole parse when missing,
  // it just leaves every row's deliveryPct null.
  const deliveryPctIdx = idx("DELIV_PER");

  if (symbolIdx < 0 || seriesIdx < 0 || prevCloseIdx < 0 || closePriceIdx < 0 || ttlTrdQntyIdx < 0) {
    console.warn("[marketMoves/bhavcopy] unexpected CSV header shape, missing required column(s)");
    return [];
  }

  const rows: BhavcopyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // No quoted fields / no embedded commas in this feed — plain split + per-cell
    // trim handles the leading-space-after-comma formatting NSE ships.
    const cells = line.split(",").map((c) => c.trim());
    const symbol = cells[symbolIdx];
    const series = cells[seriesIdx];
    const prevClose = Number(cells[prevCloseIdx]);
    const closePrice = Number(cells[closePriceIdx]);
    const ttlTrdQnty = Number(cells[ttlTrdQntyIdx]);
    if (!symbol || !series) continue;
    if (!Number.isFinite(prevClose) || !Number.isFinite(closePrice) || !Number.isFinite(ttlTrdQnty)) continue;

    let deliveryPct: number | null = null;
    if (deliveryPctIdx >= 0) {
      const rawDeliveryPct = cells[deliveryPctIdx];
      const parsedDeliveryPct = Number(rawDeliveryPct);
      deliveryPct = rawDeliveryPct && rawDeliveryPct !== "-" && Number.isFinite(parsedDeliveryPct)
        ? parsedDeliveryPct
        : null;
    }

    rows.push({ symbol, series, prevClose, closePrice, ttlTrdQnty, deliveryPct });
  }
  return rows;
}

/**
 * Shared fetch + validate step used by both fetchBhavcopyMovers and
 * fetchBhavcopyQuotes: GETs the bhavcopy CSV for the given IST session date,
 * validates its in-file DATE1 against the requested session (see the module
 * doc comment on stale-weekend-file risk), and returns the parsed rows.
 * Returns `null` (never throws) for "not available yet" in every sense — a
 * 404, a network/parse error, or a DATE1 mismatch — so callers can treat
 * `null` uniformly as "nothing to enrich with this run" without duplicating
 * the fetch/validate logic themselves.
 */
async function fetchBhavcopyRows(sessionDate: Date): Promise<BhavcopyRow[] | null> {
  const url = bhavcopyUrl(sessionDate);

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, { cache: "no-store", headers: ARCHIVE_HEADERS, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`[marketMoves/bhavcopy] fetch error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!res.ok) {
    // 404 is the expected/common case: not yet published this evening, or no
    // session that date (weekend/holiday). Log at info level, not a warning.
    if (res.status === 404) {
      console.log(`[marketMoves/bhavcopy] ${url} → 404 (not yet published / no session)`);
    } else {
      console.warn(`[marketMoves/bhavcopy] ${url} → ${res.status}`);
    }
    return null;
  }

  const csv = await res.text();

  // VALIDATE the file's own trading date before trusting it. NSE's archives
  // host serves URLs for NON-trading dates (weekends/holidays) with HTTP 200
  // but the PREVIOUS session's file inside — fetching "Sunday" returns
  // Friday's data. Requiring the in-file DATE1 to match the requested IST
  // session date makes stale data impossible regardless of URL math or NSE
  // quirks: a mismatched file is treated exactly like "not published yet".
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const expectedDate1 = `${dd}-${MONTHS[Number(mm) - 1]}-${yyyy}`;
  const firstDataLine = csv.split(/\r?\n/).find((l, i) => i > 0 && l.trim().length > 0);
  const fileDate1 = firstDataLine?.split(",")[2]?.trim() ?? "";
  if (fileDate1.toLowerCase() !== expectedDate1.toLowerCase()) {
    console.log(
      `[marketMoves/bhavcopy] ${url} contains DATE1=${fileDate1}, expected ${expectedDate1} — treating as not published`
    );
    return null;
  }

  const rows = parseBhavcopyCsv(csv);
  return rows.length > 0 ? rows : null;
}

/**
 * Fetches NSE's full-market EOD bhavcopy for the given IST session date and
 * returns the top 100 gainers + top 100 losers (by % change) among EQ-series,
 * liquid (TTL_TRD_QNTY > 10,000) names, with company names resolved from the
 * same cached equity-master CSV `fetchNseMovers` uses (self-contained, same
 * contract as the intraday fetcher — callers don't need a separate join).
 * `universe: "POPULAR"` additionally restricts the ranked pool to NIFTY 100
 * constituents (via `fetchNifty100Symbols`) before the top-100/direction cut.
 *
 * Returns `null` (never throws) when the file isn't available yet (today not
 * yet published, or a weekend/holiday with no session) or on any network/parse
 * failure — the caller treats `null` as "nothing to enrich with this run".
 */
export async function fetchBhavcopyMovers(
  sessionDate: Date,
  universe: "ALL" | "POPULAR" = "ALL"
): Promise<FetchedMarketMover[] | null> {
  const rows = await fetchBhavcopyRows(sessionDate);
  if (!rows) return null;
  const nameBySymbol = await fetchEquityNames();
  const universeSymbols = universe === "POPULAR" ? await fetchNifty100Symbols() : null;
  return shapeMovers(rows, nameBySymbol, universeSymbols);
}

/**
 * Shapes validated bhavcopy rows into ranked movers. When `universeSymbols` is
 * given, rows outside that set are dropped before the liquidity/sign checks —
 * used to restrict the EOD pass to the NIFTY 100 ("Popular") universe. `null`
 * (the default) keeps the original all-market behavior.
 */
function shapeMovers(
  rows: BhavcopyRow[],
  nameBySymbol: Map<string, string>,
  universeSymbols?: Set<string> | null
): FetchedMarketMover[] {
  const movers: FetchedMarketMover[] = [];
  for (const row of rows) {
    if (row.series !== "EQ") continue;
    if (universeSymbols && !universeSymbols.has(row.symbol)) continue;
    if (row.ttlTrdQnty <= MIN_LIQUIDITY_QTY) continue;
    if (row.prevClose <= 0) continue; // guards divide-by-zero on newly-listed/bad rows

    const changeAbs = row.closePrice - row.prevClose;
    const changePercent = (changeAbs / row.prevClose) * 100;
    if (changePercent === 0) continue;

    movers.push({
      tickerSymbol: row.symbol,
      companyName: nameBySymbol.get(row.symbol) ?? row.symbol,
      changePercent,
      changeAbs,
      volume: row.ttlTrdQnty,
      lastPrice: row.closePrice,
      direction: changePercent > 0 ? "GAINER" : "LOSER",
    });
  }

  const gainers = movers
    .filter((m) => m.direction === "GAINER")
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, TOP_N_PER_DIRECTION);
  const losers = movers
    .filter((m) => m.direction === "LOSER")
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, TOP_N_PER_DIRECTION);

  return [...gainers, ...losers];
}

/** Minimum today's traded quantity for a row to be stored as a StockEodQuote (Phase 2 — deliberately looser than MIN_LIQUIDITY_QTY: the quote store also backs future portfolio valuation, so it should cover the broad liquid universe, not just movers-strip-worthy names). */
const MIN_QUOTE_LIQUIDITY_QTY = 1_000;

/** One full-market EOD quote row, keyed by (sessionDate, symbol) — see the StockEodQuote model. */
export type FetchedEodQuote = {
  symbol: string;
  companyName: string;
  prevClose: number;
  close: number;
  changePercent: number;
  volume: number;
  deliveryPct: number | null;
};

/**
 * Unlike `fetchBhavcopyMovers`'s shaping, a zero-change row (close ===
 * prevClose) is KEPT here — the quote store is a full-market ledger, not a
 * "what moved" feed. A `prevClose <= 0` row (newly listed/bad data) still
 * gets a row with `changePercent: 0` rather than being dropped, so
 * newly-listed names aren't silently absent from the instrument-detail /
 * portfolio-valuation store; their change simply reads as flat until a real
 * prevClose exists the next session.
 */
function shapeQuotes(rows: BhavcopyRow[], nameBySymbol: Map<string, string>): FetchedEodQuote[] {
  const quotes: FetchedEodQuote[] = [];
  for (const row of rows) {
    if (row.series !== "EQ") continue;
    if (row.ttlTrdQnty <= MIN_QUOTE_LIQUIDITY_QTY) continue;

    const changePercent = row.prevClose > 0 ? ((row.closePrice - row.prevClose) / row.prevClose) * 100 : 0;

    quotes.push({
      symbol: row.symbol,
      companyName: nameBySymbol.get(row.symbol) ?? row.symbol,
      prevClose: row.prevClose,
      close: row.closePrice,
      changePercent,
      volume: row.ttlTrdQnty,
      deliveryPct: row.deliveryPct,
    });
  }
  return quotes;
}

/**
 * Fetches NSE's full-market EOD bhavcopy for the given IST session date and
 * returns EVERY liquid (TTL_TRD_QNTY > 1,000) EQ-series name — not just the
 * top-100/direction movers `fetchBhavcopyMovers` keeps. Reuses the exact same
 * fetch + DATE1-validated parse as `fetchBhavcopyMovers` (`fetchBhavcopyRows`).
 * Standalone convenience wrapper — the cron route should prefer
 * `fetchBhavcopySession` when it needs BOTH shapes for the same session, so
 * it only fetches the (multi-MB) CSV once instead of twice.
 *
 * Returns `null` (never throws) under the same conditions as
 * `fetchBhavcopyMovers` — not yet published, no session that date, or any
 * network/parse failure.
 */
export async function fetchBhavcopyQuotes(sessionDate: Date): Promise<FetchedEodQuote[] | null> {
  const rows = await fetchBhavcopyRows(sessionDate);
  if (!rows) return null;
  const nameBySymbol = await fetchEquityNames();
  return shapeQuotes(rows, nameBySymbol);
}

/** One GS/GB bond EOD quote row, keyed by (sessionDate, symbol) — see the BondEodQuote model. */
export type FetchedBondQuote = {
  symbol: string;
  series: "GS" | "GB";
  displayName: string;
  prevClose: number;
  close: number;
  changePercent: number;
  volume: number;
};

/**
 * Shapes validated bhavcopy rows into the Bonds informational layer: every
 * GS (Government Security) and GB (Sovereign Gold Bond) row, unfiltered by
 * liquidity. No MIN_QUOTE_LIQUIDITY_QTY floor — GS/GB daily volumes are
 * naturally much lower than equities (45+44 rows total, most low-turnover);
 * a liquidity floor tuned for equities would silently drop most bond rows.
 * `changePercent` still guards `prevClose <= 0` the same way `shapeQuotes`
 * does. A GB symbol whose display name falls back to the raw symbol is
 * logged (not silently dropped) — see bondName.ts's doc comment on the
 * UNVERIFIED GB pattern.
 */
function shapeBonds(rows: BhavcopyRow[]): FetchedBondQuote[] {
  const bonds: FetchedBondQuote[] = [];
  for (const row of rows) {
    if (row.series !== "GS" && row.series !== "GB") continue;
    const series = row.series as "GS" | "GB";

    const changePercent = row.prevClose > 0 ? ((row.closePrice - row.prevClose) / row.prevClose) * 100 : 0;
    const displayName = parseBondDisplayName(row.symbol, series);
    if (series === "GB" && displayName === row.symbol) {
      console.log(`[marketMoves/bhavcopy] GB symbol "${row.symbol}" did not match the SGB tranche pattern — falling back to raw symbol`);
    }

    bonds.push({
      symbol: row.symbol,
      series,
      displayName,
      prevClose: row.prevClose,
      close: row.closePrice,
      changePercent,
      volume: row.ttlTrdQnty,
    });
  }
  return bonds;
}

/**
 * Fetches NSE's full-market EOD bhavcopy for the given IST session date and
 * returns every GS/GB row (see `shapeBonds`). Reuses the exact same fetch +
 * DATE1-validated parse as `fetchBhavcopyMovers`/`fetchBhavcopyQuotes`
 * (`fetchBhavcopyRows`) — zero new HTTP fetch. Standalone convenience
 * wrapper; the cron route should prefer `fetchBhavcopySession` when it needs
 * this alongside the movers/quotes shapes for the same session, so it only
 * fetches the (multi-MB) CSV once.
 *
 * Returns `null` (never throws) under the same conditions as
 * `fetchBhavcopyMovers` — not yet published, no session that date, or any
 * network/parse failure.
 */
export async function fetchBhavcopyBonds(sessionDate: Date): Promise<FetchedBondQuote[] | null> {
  const rows = await fetchBhavcopyRows(sessionDate);
  if (!rows) return null;
  return shapeBonds(rows);
}

/**
 * Fetches NSE's full-market EOD bhavcopy ONCE for the given IST session date
 * and derives the top-100/direction movers shape for BOTH universes (all-market
 * and NIFTY 100 "Popular") AND the full liquid quote-universe shape AND the
 * GS/GB bonds informational-layer shape, all from the same parsed rows — the
 * pairing the EOD cron pass needs (movers feed `MarketMoverSnapshot` x2
 * universes, quotes feed `StockEodQuote`, bonds feed `BondEodQuote`) without
 * doubling the network fetch of the multi-MB CSV. Returns `null` (never throws)
 * under the same "not available yet" conditions as
 * `fetchBhavcopyMovers`/`fetchBhavcopyQuotes`.
 */
export async function fetchBhavcopySession(sessionDate: Date): Promise<{
  allMovers: FetchedMarketMover[];
  popularMovers: FetchedMarketMover[];
  quotes: FetchedEodQuote[];
  bonds: FetchedBondQuote[];
} | null> {
  const rows = await fetchBhavcopyRows(sessionDate);
  if (!rows) return null;
  const [nameBySymbol, nifty100Symbols] = await Promise.all([fetchEquityNames(), fetchNifty100Symbols()]);
  return {
    allMovers: shapeMovers(rows, nameBySymbol, null),
    popularMovers: shapeMovers(rows, nameBySymbol, nifty100Symbols),
    quotes: shapeQuotes(rows, nameBySymbol),
    bonds: shapeBonds(rows),
  };
}
