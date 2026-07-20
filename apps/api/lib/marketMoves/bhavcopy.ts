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
 * The file is published by NSE some time after the close (evening IST) —
 * requesting the current IST session's date before it's published, or on a
 * weekend/holiday with no session at all, returns 404. `fetchBhavcopyMovers`
 * treats a 404 or any network/parse error as "not available yet", returning
 * `null` rather than throwing, so the cron can fall back to a no-op rather
 * than crash. This mirrors `fetchEquityNames`'s never-throws contract in
 * nse.ts, but returns `null` (not `[]`) specifically so the cron route can
 * distinguish "not published yet" from "published but genuinely empty".
 */

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
    rows.push({ symbol, series, prevClose, closePrice, ttlTrdQnty });
  }
  return rows;
}

/**
 * Fetches NSE's full-market EOD bhavcopy for the given IST session date and
 * returns the top 100 gainers + top 100 losers (by % change) among EQ-series,
 * liquid (TTL_TRD_QNTY > 10,000) names, with company names resolved from the
 * same cached equity-master CSV `fetchNseMovers` uses (self-contained, same
 * contract as the intraday fetcher — callers don't need a separate join).
 *
 * Returns `null` (never throws) when the file isn't available yet (today not
 * yet published, or a weekend/holiday with no session) or on any network/parse
 * failure — the caller treats `null` as "nothing to enrich with this run".
 */
export async function fetchBhavcopyMovers(sessionDate: Date): Promise<FetchedMarketMover[] | null> {
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
  if (rows.length === 0) return null;

  const nameBySymbol = await fetchEquityNames();

  const movers: FetchedMarketMover[] = [];
  for (const row of rows) {
    if (row.series !== "EQ") continue;
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
