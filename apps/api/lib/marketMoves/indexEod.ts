/**
 * Index History Stage 2 (2026-08-11) — NSE's daily ALL-INDICES close CSV.
 *
 * Founder: "I want you to fetch all the indices that exist and have them
 * with us" + "if not tradable then at least their history." Stage 1
 * (business-rules' INDEX_UNIVERSE, commit 453dcd3) gave the 35 Yahoo-verified
 * indices real daily history via Yahoo. This is a DIFFERENT, self-owned
 * source that covers every index NSE itself publishes daily history for —
 * 164 rows verified live 2026-08-11 (vs. ~139 rows on the live
 * `/api/allIndices` snapshot — allIndices.ts — which carries NO historical
 * series at all, only today's live level; this file is the only durable
 * historical store for the long tail of indices).
 *
 * Verified live 2026-08-11 against 11-Aug-2026 and 07-Aug-2026 (both real
 * trading sessions, HTTP 200) and 08-Aug-2026 (a Saturday, HTTP 404 — no
 * session, same "not published" contract as bhavcopy.ts's file):
 *
 *   GET https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
 *
 * Plain CSV (NOT RFC4180-quoted — verified zero embedded commas in any Index
 * Name across all 164 rows, so a naive split(",") is safe), no leading-space
 * quirk (unlike bhavcopy.ts's sec_bhavdata_full — trimmed defensively anyway).
 * Header row:
 *   Index Name, Index Date, Open Index Value, High Index Value,
 *   Low Index Value, Closing Index Value, Points Change, Change(%), Volume,
 *   Turnover (Rs. Cr.), P/E, P/B, Div Yield
 *
 * Non-equity-weighted rows (G-Sec / fixed-income indices — "Nifty 8-13 yr
 * G-Sec", "Nifty Composite G-sec Index", etc.) publish "-" for
 * Volume/Turnover/P-E/P-B/Div-Yield — parsed to null, NOT zero (a real zero
 * reading is indistinguishable from "not applicable" otherwise, same
 * discipline as allIndices.ts's parsePositiveNumber). Separately, 26 of 164
 * rows verified live 2026-08-11 ("Nifty NBFC", "Nifty Insurance", the
 * corporate-group indices, etc.) publish "-" for Open/High/Low specifically
 * while still carrying a real Close/Points-Change/Change(%) — these are
 * NOT dropped from ingestion (Close is the only field a caller can rely on
 * unconditionally; Open/High/Low are simply null for that row/index).
 *
 * `Index Date` is DD-MM-YYYY (e.g. "11-08-2026"), a different format from
 * bhavcopy's DATE1 ("11-Aug-2026") — validated against the requested IST
 * session the same way (stale-weekend-file guard: NSE serves a non-trading
 * date's URL with HTTP 200 but the previous session's data inside).
 */

const NSE_ARCHIVES_ORIGIN = "https://nsearchives.nseindia.com";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Same header shape as bhavcopy.ts's ARCHIVE_HEADERS — this archives host
// has never required the Akamai cookie handshake the main site's /api/*
// routes need.
const ARCHIVE_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/csv,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

const FETCH_TIMEOUT_MS = 20_000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date {dd,mm,yyyy} of an IST-midnight-as-UTC session instant. Same convention as bhavcopy.ts's istDateParts. */
function istDateParts(sessionDate: Date): { dd: string; mm: string; yyyy: number } {
  const ist = new Date(sessionDate.getTime() + IST_OFFSET_MS);
  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: ist.getUTCFullYear(),
  };
}

function indexEodUrl(sessionDate: Date): string {
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  return `${NSE_ARCHIVES_ORIGIN}/content/indices/ind_close_all_${dd}${mm}${yyyy}.csv`;
}

/** One parsed+trimmed index-close row. */
export type FetchedIndexEodQuote = {
  indexName: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changeAbs: number;
  changePercent: number;
  volume: number | null;
  turnoverCr: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
};

/** Parses an NSE numeric cell ("24402.81", "-", "", "1.27") into a number, treating '-'/blank/unparseable as "not applicable" rather than zero. */
function parseOptionalNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Parses the ind_close_all CSV text into typed rows. Skips any malformed line rather than throwing. */
function parseIndexEodCsv(csv: string): { rows: FetchedIndexEodQuote[]; dateColumn: string[] } {
  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return { rows: [], dateColumn: [] };

  const header = lines[0].split(",").map((c) => c.trim().toUpperCase());
  const idx = (name: string) => header.indexOf(name);
  const nameIdx = idx("INDEX NAME");
  const dateIdx = idx("INDEX DATE");
  const openIdx = idx("OPEN INDEX VALUE");
  const highIdx = idx("HIGH INDEX VALUE");
  const lowIdx = idx("LOW INDEX VALUE");
  const closeIdx = idx("CLOSING INDEX VALUE");
  const changeAbsIdx = idx("POINTS CHANGE");
  const changePercentIdx = idx("CHANGE(%)");
  const volumeIdx = idx("VOLUME");
  const turnoverIdx = idx("TURNOVER (RS. CR.)");
  const peIdx = idx("P/E");
  const pbIdx = idx("P/B");
  const dyIdx = idx("DIV YIELD");

  if (
    nameIdx < 0 ||
    dateIdx < 0 ||
    openIdx < 0 ||
    highIdx < 0 ||
    lowIdx < 0 ||
    closeIdx < 0 ||
    changeAbsIdx < 0 ||
    changePercentIdx < 0
  ) {
    console.warn("[marketMoves/indexEod] unexpected CSV header shape, missing required column(s)");
    return { rows: [], dateColumn: [] };
  }

  const rows: FetchedIndexEodQuote[] = [];
  const dateColumn: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(",").map((c) => c.trim());
    const indexName = cells[nameIdx];
    // Close/Points-Change/Change(%) are required — every real row carries
    // them. Open/High/Low are optional (see module doc: 26/164 rows publish
    // '-' for these three while still having a real close).
    const close = Number(cells[closeIdx]);
    const changeAbs = Number(cells[changeAbsIdx]);
    const changePercent = Number(cells[changePercentIdx]);
    if (!indexName) continue;
    if (![close, changeAbs, changePercent].every(Number.isFinite)) continue;

    dateColumn.push(cells[dateIdx] ?? "");
    rows.push({
      indexName,
      open: parseOptionalNumber(cells[openIdx]),
      high: parseOptionalNumber(cells[highIdx]),
      low: parseOptionalNumber(cells[lowIdx]),
      close,
      changeAbs,
      changePercent,
      volume: parseOptionalNumber(cells[volumeIdx]),
      turnoverCr: parseOptionalNumber(cells[turnoverIdx]),
      peRatio: parseOptionalNumber(cells[peIdx]),
      pbRatio: parseOptionalNumber(cells[pbIdx]),
      dividendYield: parseOptionalNumber(cells[dyIdx]),
    });
  }
  return { rows, dateColumn };
}

/**
 * Fetches NSE's daily all-indices close CSV for the given IST session date.
 * Returns `null` (never throws) when the file isn't available yet (today not
 * yet published, or a weekend/holiday with no session) or on any
 * network/parse/date-mismatch failure — same "not available yet" contract as
 * bhavcopy.ts's fetchBhavcopyRows, including the stale-weekend-file DATE
 * validation (NSE serves a non-trading date's URL with HTTP 200 but the
 * previous session's data inside).
 */
export async function fetchIndexEodQuotes(sessionDate: Date): Promise<FetchedIndexEodQuote[] | null> {
  const url = indexEodUrl(sessionDate);

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
    console.warn(`[marketMoves/indexEod] fetch error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!res.ok) {
    if (res.status === 404) {
      console.log(`[marketMoves/indexEod] ${url} → 404 (not yet published / no session)`);
    } else {
      console.warn(`[marketMoves/indexEod] ${url} → ${res.status}`);
    }
    return null;
  }

  const csv = await res.text();
  const { rows, dateColumn } = parseIndexEodCsv(csv);
  if (rows.length === 0) return null;

  // VALIDATE the file's own trading date before trusting it — same
  // stale-weekend-file guard as bhavcopy.ts, adapted to this file's DD-MM-YYYY
  // Index Date format (vs. bhavcopy's "DD-Mon-YYYY" DATE1).
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  const expectedDate = `${dd}-${mm}-${yyyy}`;
  const fileDate = dateColumn[0] ?? "";
  if (fileDate !== expectedDate) {
    console.log(
      `[marketMoves/indexEod] ${url} contains Index Date=${fileDate}, expected ${expectedDate} — treating as not published`
    );
    return null;
  }

  return rows;
}
