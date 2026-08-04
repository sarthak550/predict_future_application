/**
 * Paper Trading Phase 4 — NSE F&O ("derivatives") end-of-day bhavcopy
 * settlement-price fetcher. Close sibling of marketMoves/bhavcopy.ts (the
 * cash-equity EOD bhavcopy fetcher) — copies its proven DATE1-style
 * stale-file validation and IST session-date math verbatim, adapted for the
 * F&O segment's different file format and date convention.
 *
 * ─── FORMAT — EC2-VERIFIED 2026-07-25 against a real 24-Jul-2026 file
 * (200 OK, 38,800 rows parsed) ──────────────────────────────────────────────
 *
 * NSE's OLD per-segment bhavcopy CSVs (the `fo*.csv.zip`-style files
 * marketMoves/bhavcopy.ts's own doc comment references for the cash-market
 * "old bhavcopy format") were discontinued 8-Jul-2024 per NSE Circular
 * 62424. The F&O segment's current file is the "UDiFF" (Unified Distilled
 * File Format) combined bhavcopy, a ZIP archive (unlike the cash-equity
 * `sec_bhavdata_full_*.csv`, which is still a plain unzipped CSV — the two
 * segments migrated on different tracks, confirmed by marketMoves/
 * bhavcopy.ts's own file still working unzipped as of 2026-07-19):
 *
 *   GET https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip
 *
 * Same keyless, cookie-free archives host as the cash-equity bhavcopy — no
 * Akamai handshake needed. The zip contains exactly one CSV entry (parsed by
 * taking the first `.csv` entry name found, not by assuming an exact inner
 * filename — defensive against NSE renaming the inner file while keeping the
 * outer zip name stable, which they have done before per the cash-equity
 * migration history above). URL and zip handling confirmed working exactly
 * as built — no code changes needed for either.
 *
 * UDiFF FO column set (confirmed against the real file): `TradDt, BizDt,
 * Sgmt, Src, FinInstrmTp, FinInstrmId, ISIN, TckrSymb, SctySrs, XpryDt,
 * FininstrmActlXpryDt, StrkPric, OptnTp, FinInstrmNm, OpnPric, HghPric,
 * LwPric, ClsPric, LastPric, PrvsClsgPric, UndrlygPric, SttlmPric,
 * OpnIntrst, ChngInOpnIntrst, TtlTradgVol, TtlTrfVal, TtlNbOfTxsExctd,
 * SsnId, NewBrdLotQty, Rmks, Rsvd01..Rsvd04`. `TradDt`/`XpryDt` use ISO
 * `YYYY-MM-DD` (confirmed — a genuine format DIFFERENCE from the
 * cash-equity bhavcopy's `DD-MMM-YYYY` DATE1 column, so the stale-file
 * validation below compares against a differently-formatted expected
 * string, not a shared helper).
 *
 * **`FinInstrmTp` — CORRECTED, this was a real bug in the first pass.** The
 * file uses NSE's newer ISO UDiFF instrument-type codes, NOT the legacy
 * `FUTIDX`/`FUTSTK`/`OPTIDX`/`OPTSTK` names this module originally assumed
 * (those legacy names appear in NSE's own UDiFF *documentation* prose, but
 * NOT as the actual codes written into the file — a documentation-vs-file
 * mismatch this sandbox's lack of NSE egress made impossible to catch before
 * EC2 verification). Real distinct values in the 24-Jul-2026 file: `STO`
 * (stock options, 33,020 rows), `STF` (stock futures, 625 rows), `IDO`
 * (index options, 5,140 rows), `IDF` (index futures, 15 rows = 5 indices ×
 * 3 expiries — exactly as expected). This phase filters on
 * `INDEX_FUTURES_INSTRUMENT_TYPE = "IDF"`, exported as a named constant (not
 * an inline string literal) specifically so it can be pinned by an
 * assertion in the verify script — the ORIGINAL `FinInstrmTp === "FUTIDX"`
 * filter matched ZERO rows, which would have made the daily-MTM cron
 * silently find no settlement price for every position, every day, with no
 * error surfaced anywhere (the fail-closed `null`-on-empty-result design
 * masked the bug rather than exposing it — worth remembering next time a
 * "verified via documentation, not a live payload" gap gets closed: a
 * plausible-looking, internally-consistent wrong value is exactly the
 * failure mode fail-closed code can't catch on its own). `TckrSymb` is the
 * underlying symbol (e.g. "NIFTY"), `SttlmPric` is the exchange-computed
 * daily settlement price this phase's MTM cron needs (real sample row:
 * `{FinInstrmTp:"IDF", TckrSymb:"NIFTY", XpryDt:"2026-08-25",
 * SttlmPric:"23874.60", TradDt:"2026-07-24", OptnTp:""}` — note `SttlmPric`
 * arrives as a numeric STRING in the raw CSV, same as every other numeric
 * column this file already `Number()`-parses). The parser stays general
 * (`STF`/stock-futures rows are parsed but unused this phase — Phase 4.1
 * inherits a working parser for free, per the brief's "cheaper to filter at
 * read time" allowance).
 */

import AdmZip from "adm-zip";

const NSE_ARCHIVES_ORIGIN = "https://nsearchives.nseindia.com";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Same header shape as marketMoves/bhavcopy.ts's ARCHIVE_HEADERS — the
// archives host has never required the Akamai cookie handshake the main
// site's /api/* routes need.
const ARCHIVE_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "application/zip,application/octet-stream,*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

const FETCH_TIMEOUT_MS = 20_000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date {yyyy,mm,dd} of an IST-midnight-as-UTC session instant — same shift-first math as marketMoves/bhavcopy.ts's istDateParts, duplicated here (not imported) to keep this file's date math self-contained, matching that file's own "three lines, not worth a shared import" posture. */
function istDateParts(sessionDate: Date): { dd: string; mm: string; yyyy: number } {
  const ist = new Date(sessionDate.getTime() + IST_OFFSET_MS);
  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: ist.getUTCFullYear()
  };
}

function foBhavcopyUrl(sessionDate: Date): string {
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  return `${NSE_ARCHIVES_ORIGIN}/content/fo/BhavCopy_NSE_FO_0_0_0_${yyyy}${mm}${dd}_F_0000.csv.zip`;
}

/**
 * NSE's ISO UDiFF instrument-type code for index futures — EC2-verified
 * 2026-07-25 against the real 24-Jul-2026 file's distinct `FinInstrmTp`
 * values (`{"STO":33020,"STF":625,"IDO":5140,"IDF":15}`). Exported as a
 * named constant (not an inline string literal in the filter below)
 * specifically so the verify script can pin it with an assertion — this is
 * the exact value a first pass got wrong (see the module doc's "CORRECTED"
 * note), so treat any future edit to this constant as requiring the same
 * bar of real-file verification, not documentation-prose inference.
 */
export const INDEX_FUTURES_INSTRUMENT_TYPE = "IDF";

/**
 * NSE's ISO UDiFF instrument-type codes for index and stock OPTIONS —
 * confirmed against the same real 24-Jul-2026 file as INDEX_FUTURES_INSTRUMENT_TYPE
 * (`{"STO":33020,"STF":625,"IDO":5140,"IDF":15}`). Used by the Expiry
 * Settlement Backfill (2026-08-04) options-underlying-price lookup below —
 * exported as named constants for the same reason INDEX_FUTURES_INSTRUMENT_TYPE
 * is: so a verify-script assertion can pin them against silent drift.
 */
export const INDEX_OPTIONS_INSTRUMENT_TYPE = "IDO";
export const STOCK_OPTIONS_INSTRUMENT_TYPE = "STO";

/** One parsed F&O bhavcopy row — every UDiFF FO column we actually use, general enough to cover both index futures (IDF) and stock futures (STF) (Phase 4.1 inherits this parser unchanged). */
export interface FoBhavcopyRow {
  tradeDate: string; // "YYYY-MM-DD", UDiFF's own TradDt value — used for the stale-file check
  instrumentType: string; // "IDF" | "STF" | "IDO" | "STO" — NSE's ISO UDiFF codes, confirmed against the real file (NOT the legacy FUTIDX/FUTSTK/OPTIDX/OPTSTK names NSE's own documentation prose uses)
  underlyingSymbol: string; // TckrSymb
  /** "YYYY-MM-DD" — UDiFF's own XpryDt value. */
  expiryDate: string;
  settlementPrice: number; // SttlmPric
  closePrice: number; // ClsPric — fallback display value only, never used as the settlement price
  /**
   * Expiry Settlement Backfill (2026-08-04) — UndrlygPric, the underlying
   * instrument's own recorded price for this row's trade date. Present on
   * every FinInstrmTp row uniformly (options AND futures), but this module
   * only reads it for IDO/STO (options) rows — futures already have their
   * own authoritative settlementPrice (SttlmPric) and don't need it.
   * Documented by NSE as the reference underlying price options/futures
   * daily MTM and final settlement are computed against — i.e. exactly the
   * "underlying's closing/settlement price on this trading day" a historical
   * intrinsic-value settlement needs. NaN if the column is missing/unparseable
   * (defensive — every real row has it, but a future UDiFF revision dropping
   * or renaming it should degrade to "unavailable," never a silent 0).
   */
  underlyingPrice: number; // UndrlygPric
}

/** Parses a UDiFF FO CSV's header row into a column-name -> index map, tolerant of column reordering (UDiFF's own guidance doc does not guarantee column order is stable release-to-release, unlike the older fixed-width-adjacent CSVs). */
function parseFoBhavcopyCsv(csv: string): FoBhavcopyRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((c) => c.trim());
  const idx = (name: string) => header.indexOf(name);
  const tradDtIdx = idx("TradDt");
  const finInstrmTpIdx = idx("FinInstrmTp");
  const tckrSymbIdx = idx("TckrSymb");
  const xpryDtIdx = idx("XpryDt");
  const sttlmPricIdx = idx("SttlmPric");
  const clsPricIdx = idx("ClsPric");
  const undrlygPricIdx = idx("UndrlygPric");

  if (tradDtIdx < 0 || finInstrmTpIdx < 0 || tckrSymbIdx < 0 || xpryDtIdx < 0 || sttlmPricIdx < 0) {
    console.warn("[marketMoves/foBhavcopy] unexpected CSV header shape, missing required column(s)");
    return [];
  }

  const rows: FoBhavcopyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(",").map((c) => c.trim());

    const tradeDate = cells[tradDtIdx];
    const instrumentType = cells[finInstrmTpIdx];
    const underlyingSymbol = cells[tckrSymbIdx];
    const expiryDate = cells[xpryDtIdx];
    const settlementPrice = Number(cells[sttlmPricIdx]);
    const closePrice = clsPricIdx >= 0 ? Number(cells[clsPricIdx]) : NaN;
    const underlyingPrice = undrlygPricIdx >= 0 ? Number(cells[undrlygPricIdx]) : NaN;

    if (!tradeDate || !instrumentType || !underlyingSymbol || !expiryDate) continue;
    if (!Number.isFinite(settlementPrice) || settlementPrice <= 0) continue;

    rows.push({
      tradeDate,
      instrumentType,
      underlyingSymbol,
      expiryDate,
      settlementPrice,
      closePrice: Number.isFinite(closePrice) ? closePrice : settlementPrice,
      underlyingPrice
    });
  }
  return rows;
}

/**
 * Fetches + unzips the F&O bhavcopy for the given IST session date,
 * validates its in-file TradDt against the requested session (same
 * stale-weekend-file defense marketMoves/bhavcopy.ts's DATE1 check provides
 * for the cash-equity file — NSE's archives host can serve a non-trading
 * date's URL with HTTP 200 but the PREVIOUS session's file inside), and
 * returns every parsed row (IDF + STF + IDO/STO options rows the file
 * contains — filtering to what a specific caller needs happens in the
 * exported wrapper below, not here). Returns `null` (never throws) for
 * "not available yet" in every sense — a 404, a network/parse/unzip error,
 * an empty zip, or a TradDt mismatch.
 */
async function fetchFoBhavcopyRows(sessionDate: Date): Promise<FoBhavcopyRow[] | null> {
  const url = foBhavcopyUrl(sessionDate);

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
    console.warn(`[marketMoves/foBhavcopy] fetch error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!res.ok) {
    if (res.status === 404) {
      console.log(`[marketMoves/foBhavcopy] ${url} → 404 (not yet published / no session)`);
    } else {
      console.warn(`[marketMoves/foBhavcopy] ${url} → ${res.status}`);
    }
    return null;
  }

  let csv: string;
  try {
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buffer);
    const csvEntry = zip.getEntries().find((entry) => entry.entryName.toLowerCase().endsWith(".csv"));
    if (!csvEntry) {
      console.warn(`[marketMoves/foBhavcopy] ${url} zip contained no .csv entry`);
      return null;
    }
    csv = csvEntry.getData().toString("utf-8");
  } catch (err) {
    console.warn(`[marketMoves/foBhavcopy] unzip/parse error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // VALIDATE the file's own trade date before trusting it — same defense as
  // marketMoves/bhavcopy.ts's DATE1 check, adapted to UDiFF's YYYY-MM-DD
  // TradDt convention (NOT DATE1's "DD-MMM-YYYY" — a real format difference,
  // not a copy-paste of the same string shape).
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  const expectedTradDt = `${yyyy}-${mm}-${dd}`;
  const firstDataLine = csv.split(/\r?\n/).find((l, i) => i > 0 && l.trim().length > 0);
  const header = csv.split(/\r?\n/)[0]?.split(",").map((c) => c.trim()) ?? [];
  const tradDtIdx = header.indexOf("TradDt");
  const fileTradDt = tradDtIdx >= 0 ? firstDataLine?.split(",")[tradDtIdx]?.trim() ?? "" : "";
  if (fileTradDt !== expectedTradDt) {
    console.log(
      `[marketMoves/foBhavcopy] ${url} contains TradDt=${fileTradDt || "(unknown)"}, expected ${expectedTradDt} — treating as not published`
    );
    return null;
  }

  const rows = parseFoBhavcopyCsv(csv);
  return rows.length > 0 ? rows : null;
}

/**
 * Every INDEX FUTURES (`FinInstrmTp === INDEX_FUTURES_INSTRUMENT_TYPE`,
 * i.e. `"IDF"`) settlement-price row for the given IST session date — the
 * exact shape the Phase 4 daily-MTM/expiry-settlement crons need. Keyed
 * lookup helper `settlementPriceFor` included so callers don't need to
 * re-derive the (underlying, expiry) matching logic themselves. Returns
 * `null` (never throws) under the same "not available yet" conditions as
 * `fetchFoBhavcopyRows`.
 */
export interface IndexFuturesSettlement {
  underlyingSymbol: string;
  /** "YYYY-MM-DD" (UDiFF's own XpryDt string), not converted to a Date here — callers that need a Date should parse via their own convention (this module intentionally stays date-library-free, matching every sibling fetcher's minimal-dependency posture). */
  expiryDate: string;
  settlementPrice: number;
}

export interface IndexFuturesSettlementSession {
  sessionDate: Date;
  rows: IndexFuturesSettlement[];
  /** O(1) lookup for "this underlying, this expiry" — the exact key shape the daily-MTM cron's per-position scan needs. */
  settlementPriceFor(underlyingSymbol: string, expiryDateIso: string): number | null;
}

export async function fetchIndexFuturesSettlementPrices(sessionDate: Date): Promise<IndexFuturesSettlementSession | null> {
  const rows = await fetchFoBhavcopyRows(sessionDate);
  if (!rows) return null;

  const indexFutures: IndexFuturesSettlement[] = rows
    .filter((r) => r.instrumentType === INDEX_FUTURES_INSTRUMENT_TYPE)
    .map((r) => ({ underlyingSymbol: r.underlyingSymbol, expiryDate: r.expiryDate, settlementPrice: r.settlementPrice }));

  if (indexFutures.length === 0) return null;

  const byKey = new Map(indexFutures.map((r) => [`${r.underlyingSymbol}::${r.expiryDate}`, r.settlementPrice]));

  return {
    sessionDate,
    rows: indexFutures,
    settlementPriceFor: (underlyingSymbol: string, expiryDateIso: string) => byKey.get(`${underlyingSymbol}::${expiryDateIso}`) ?? null
  };
}

/**
 * Expiry Settlement Backfill (2026-08-04) — every OPTIONS (`IDO` index OR
 * `STO` stock) row's `underlyingPrice` (UndrlygPric) for the given IST
 * session date, deduplicated to one entry per (underlyingSymbol, expiryDate)
 * pair (UndrlygPric is the underlying's own price, identical across every
 * strike/optionType of the same underlying+expiry+date — the per-strike
 * option rows are only a vehicle for the file to carry it once per date).
 *
 * This is the historical analogue of `fetchIndexFuturesSettlementPrices`
 * above, purpose-built for a PAST date: unlike optionChain.ts's live
 * `fetchOptionChain` (which only reflects an in-force, currently-listed
 * contract — an already-expired strike silently drops out of that feed),
 * this reads the SAME frozen, date-addressed NSE archive file
 * `fetchIndexFuturesSettlementPrices` already proved works for arbitrary past
 * dates, so a contract that expired weeks ago is just as retrievable as
 * today's. Used by lib/paperTrading/optionsExpiry.ts's backfill sweep to
 * settle an overdue-expired option position at real historical intrinsic
 * value instead of a same-day live/fallback quote. Returns `null` (never
 * throws) under the same "not available" conditions as
 * `fetchIndexFuturesSettlementPrices` (a 404, parse failure, stale-file
 * mismatch, or zero matching rows).
 */
export interface OptionUnderlyingSettlement {
  underlyingSymbol: string;
  /** "YYYY-MM-DD" (UDiFF's own XpryDt string) — same date-library-free convention as IndexFuturesSettlement.expiryDate. */
  expiryDate: string;
  underlyingPrice: number;
}

export interface OptionUnderlyingSettlementSession {
  sessionDate: Date;
  rows: OptionUnderlyingSettlement[];
  /** O(1) lookup for "this underlying, this expiry" — same key shape as IndexFuturesSettlementSession.settlementPriceFor. */
  underlyingPriceFor(underlyingSymbol: string, expiryDateIso: string): number | null;
}

export async function fetchOptionUnderlyingSettlementPrices(sessionDate: Date): Promise<OptionUnderlyingSettlementSession | null> {
  const rows = await fetchFoBhavcopyRows(sessionDate);
  if (!rows) return null;

  const byKey = new Map<string, number>();
  for (const r of rows) {
    if (r.instrumentType !== INDEX_OPTIONS_INSTRUMENT_TYPE && r.instrumentType !== STOCK_OPTIONS_INSTRUMENT_TYPE) continue;
    if (!Number.isFinite(r.underlyingPrice) || r.underlyingPrice <= 0) continue;
    const key = `${r.underlyingSymbol}::${r.expiryDate}`;
    if (!byKey.has(key)) byKey.set(key, r.underlyingPrice); // first occurrence wins — every strike/optionType row for this (underlying, expiry, date) carries the identical value
  }

  if (byKey.size === 0) return null;

  const optionUnderlyings: OptionUnderlyingSettlement[] = Array.from(byKey.entries()).map(([key, underlyingPrice]) => {
    const [underlyingSymbol, expiryDate] = key.split("::");
    return { underlyingSymbol, expiryDate, underlyingPrice };
  });

  return {
    sessionDate,
    rows: optionUnderlyings,
    underlyingPriceFor: (underlyingSymbol: string, expiryDateIso: string) => byKey.get(`${underlyingSymbol}::${expiryDateIso}`) ?? null
  };
}
