/**
 * BSE Expansion Phase 1 (2026-08-12) — BSE's bulk daily ALL-INDICES close
 * endpoint. Founder: "include BSE as well, all the indices BSE has." This is
 * the BSE-side equivalent of indexEod.ts's NSE ind_close_all CSV — the single
 * biggest open risk this phase's assigning brief flagged (whether BSE
 * publishes a bulk file at all, vs. ~100+ per-index requests/day). It does.
 *
 * ✅ VERIFIED LIVE 2026-08-12 from this dev sandbox:
 *
 *   GET https://api.bseindia.com/BseIndiaAPI/api/IndexArchDailyAll/w
 *     ?fmdt=DD%2FMM%2FYYYY&todt=DD%2FMM%2FYYYY&index=All&period=D
 *
 * Same host/header discipline as bse.ts's announcements fetcher (which this
 * module directly reuses the header set from) — plain UA + Accept + Origin +
 * Referer, NO session/cookie priming needed, unlike NSE's www.nseindia.com
 * (Akamai WAF). Discovered via the unofficial BennyThadikaran/BseIndiaApi
 * Python library's source (`fetchAllIndicesDataByDate`), then independently
 * live-verified against real trading days, weekends, and a 2-year-back date:
 *
 *   - 11-Aug-2026 (real trading day): HTTP 200, 133 index rows.
 *   - 08-Aug-2026 (Saturday): HTTP 200, `{"Table":[]}` — empty array, NOT a
 *     404 (a cleaner "not published" signal than NSE's stale-weekend-file
 *     200, which required a separate date-column validation guard; BSE's
 *     endpoint needs no such guard).
 *   - 12-Aug-2026 (today, requested before market close): HTTP 200, empty
 *     Table — same "not yet published" contract, indistinguishable from a
 *     non-trading day at the API level (both handled identically below).
 *   - 11-Aug-2025 / 12-Aug-2024 / 01-Jun-2022: 94 / 68 / 64 rows respectively
 *     — archive depth comfortably exceeds the brief's ~1-year backfill
 *     target (row count grows over time as BSE has added indices — expected,
 *     same shape as NSE's own index-list growth).
 *   - fmdt != todt (multi-day range) returns an EMPTY Table — this endpoint
 *     is single-day-only despite accepting a from/to param pair; backfill
 *     must walk one day per request, same as indexEod.ts.
 *
 * Response shape: `{"Table": [{ I_name, date, I_open, I_high, I_low,
 * I_close, Chg, ChgPer, Volume, Turnover, I_pe, I_pb, I_yl, Prev_Close,
 * Flag }, ...]}`. `date` is an ISO local timestamp with no offset
 * ("2026-08-11T00:00:00") — IST wall-clock, same treat-as-IST-calendar-date
 * convention as every other BSE/NSE timestamp in this codebase. `Flag`'s
 * meaning is undocumented (observed values 1/2 across the live universe) and
 * is not persisted.
 *
 * Optional-field convention DIFFERS from NSE's ind_close_all: BSE renders
 * "not applicable" as JSON `null` or `""` (empty string), never NSE's `"-"`
 * string — verified live on non-equity-weighted indices ("BSE 8-13 Year
 * G-Sec Index", "BSE India 10 Year Sovereign Bond") which publish blank
 * Volume/Turnover and null I_pe/I_pb/I_yl while still carrying a real Close.
 * "BSE India 10 Year Sovereign Bond" additionally publishes blank
 * Open/High/Low with a real Close — same shape as NSE's 26-of-164 rows,
 * handled identically (Close/Chg/ChgPer required, everything else optional,
 * never coerced to 0).
 *
 * UNIT CAVEAT (flagged, not resolved): NSE's ind_close_all explicitly labels
 * its turnover column "Turnover (Rs. Cr.)". BSE's JSON field is bare
 * "Turnover" with no unit annotation anywhere in the response or BSE's own
 * UI copy checked during verification — stored as-is in
 * BseIndexEodQuote.turnover, NOT assumed to be Rs Cr. Do not rescale without
 * live-verifying against a second source first.
 */

const BSE_API_BASE = "https://api.bseindia.com/BseIndiaAPI/api";
const BSE_ORIGIN = "https://www.bseindia.com/";

const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.3",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Origin: BSE_ORIGIN,
  Referer: BSE_ORIGIN,
};

const FETCH_TIMEOUT_MS = 20_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date {dd,mm,yyyy} of an IST-midnight-as-UTC session instant. Same convention as indexEod.ts's istDateParts. */
function istDateParts(sessionDate: Date): { dd: string; mm: string; yyyy: number } {
  const ist = new Date(sessionDate.getTime() + IST_OFFSET_MS);
  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: ist.getUTCFullYear(),
  };
}

function bseIndexArchiveUrl(sessionDate: Date): string {
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  const dmy = `${dd}/${mm}/${yyyy}`;
  const params = new URLSearchParams({ fmdt: dmy, todt: dmy, index: "All", period: "D" });
  return `${BSE_API_BASE}/IndexArchDailyAll/w?${params.toString()}`;
}

type BseIndexArchiveRow = {
  I_name?: string | null;
  date?: string | null;
  I_open?: string | null;
  I_high?: string | null;
  I_low?: string | null;
  I_close?: string | null;
  Chg?: string | null;
  ChgPer?: string | null;
  Volume?: string | null;
  Turnover?: string | null;
  I_pe?: string | null;
  I_pb?: string | null;
  I_yl?: string | null;
  Prev_Close?: string | null;
  Flag?: number | null;
};

type BseIndexArchiveResponse = {
  Table?: BseIndexArchiveRow[];
};

/** One parsed+trimmed BSE index-close row. */
export type FetchedBseIndexEodQuote = {
  indexName: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changeAbs: number;
  changePercent: number;
  previousClose: number | null;
  volume: number | null;
  turnover: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
};

/** Parses a BSE numeric cell (a JSON string like "78154.25", `null`, or `""`) into a number, treating null/blank/unparseable as "not applicable" rather than zero — same discipline as indexEod.ts's parseOptionalNumber, adapted for BSE's null/empty-string convention (vs. NSE's literal "-"). */
function parseOptionalNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Parses the IndexArchDailyAll `Table` array into typed rows. Skips any row missing a name or a valid Close/Chg/ChgPer rather than throwing — mirrors indexEod.ts's parseIndexEodCsv row-level tolerance. */
function parseBseIndexRows(rows: BseIndexArchiveRow[]): { rows: FetchedBseIndexEodQuote[]; dateColumn: string[] } {
  const out: FetchedBseIndexEodQuote[] = [];
  const dateColumn: string[] = [];

  for (const row of rows) {
    const indexName = row.I_name?.trim();
    if (!indexName) continue;

    const close = Number(row.I_close);
    const changeAbs = Number(row.Chg);
    const changePercent = Number(row.ChgPer);
    if (![close, changeAbs, changePercent].every(Number.isFinite)) continue;

    dateColumn.push(row.date ?? "");
    out.push({
      indexName,
      open: parseOptionalNumber(row.I_open),
      high: parseOptionalNumber(row.I_high),
      low: parseOptionalNumber(row.I_low),
      close,
      changeAbs,
      changePercent,
      previousClose: parseOptionalNumber(row.Prev_Close),
      volume: parseOptionalNumber(row.Volume),
      turnover: parseOptionalNumber(row.Turnover),
      peRatio: parseOptionalNumber(row.I_pe),
      pbRatio: parseOptionalNumber(row.I_pb),
      dividendYield: parseOptionalNumber(row.I_yl),
    });
  }

  return { rows: out, dateColumn };
}

/**
 * Fetches BSE's daily all-indices close data for the given IST session date.
 * Returns `null` (never throws) when the day has no data yet — today not yet
 * published, or a weekend/holiday with no session (BSE's endpoint returns an
 * empty `Table` with HTTP 200 for both cases, so this function treats "zero
 * rows" identically to a network/parse failure: "not available yet"). Same
 * never-throw contract as indexEod.ts's fetchIndexEodQuotes.
 *
 * Defensive date check: verifies the first returned row's own `date` matches
 * the requested IST session date before trusting the batch, in case BSE ever
 * serves a stale/wrong-day payload the way NSE's archives host occasionally
 * does for ind_close_all — not observed live during verification, but cheap
 * insurance given the precedent.
 */
export async function fetchBseIndexEodQuotes(sessionDate: Date): Promise<FetchedBseIndexEodQuote[] | null> {
  const url = bseIndexArchiveUrl(sessionDate);

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, { cache: "no-store", headers: BSE_HEADERS, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`[marketMoves/bseIndexEod] fetch error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!res.ok) {
    console.warn(`[marketMoves/bseIndexEod] ${url} → ${res.status}`);
    return null;
  }

  let json: BseIndexArchiveResponse;
  try {
    json = (await res.json()) as BseIndexArchiveResponse;
  } catch (err) {
    console.warn(`[marketMoves/bseIndexEod] JSON parse error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const rawRows = json.Table ?? [];
  if (rawRows.length === 0) {
    console.log(`[marketMoves/bseIndexEod] ${url} → empty Table (not yet published / no session)`);
    return null;
  }

  const { rows, dateColumn } = parseBseIndexRows(rawRows);
  if (rows.length === 0) return null;

  const { dd, mm, yyyy } = istDateParts(sessionDate);
  const expectedDatePrefix = `${yyyy}-${mm}-${dd}`;
  const firstDate = (dateColumn[0] ?? "").slice(0, 10);
  if (firstDate !== expectedDatePrefix) {
    console.log(
      `[marketMoves/bseIndexEod] ${url} contains date=${firstDate}, expected ${expectedDatePrefix} — treating as not published`
    );
    return null;
  }

  return rows;
}
