/**
 * BSE Expansion Phase 3A (2026-08-12) — BSE-EXCLUSIVE equities. Founder,
 * verbatim (2026-08-11): "if any stock which BSE has but missing in NSE."
 * This module fetches BSE's own UDiFF equity bhavcopy, filters it down to
 * BSE-only companies (a real, verified dual-listing dedup — see below), and
 * shapes the result into `BseEodQuote` rows. Mirrors
 * apps/api/lib/marketMoves/bhavcopy.ts's structure/discipline for the NSE
 * side, one exchange over.
 *
 * ── SOURCE (re-verified live 2026-08-12, first found+verified by BSE
 * Expansion Phase 1 to de-risk this exact phase) ──────────────────────────
 *
 *   GET https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV
 *
 * ACCEPT-HEADER GOTCHA (critical, do not "simplify" this away): a normal
 * browser `Accept: text/html`-style header gets HTTP 200 with BSE's Angular
 * SPA's shell HTML (~13.8KB, BYTE-IDENTICAL for every date and even for
 * genuinely non-existent dates — a false positive, NOT a 404). Only
 * `Accept: application/json, text/plain, <anything>` returns the real CSV
 * (content-type `application/octet-stream`). Re-verified 2026-08-12 against
 * 2026-08-11's file: 853,991 bytes, 4,987 CM-segment rows — byte-for-byte
 * matches Phase 1's own recorded evidence. `fetchBseBhavcopyText` treats a
 * response shorter than `SPA_SHELL_MAX_BYTES` as "not published" for exactly
 * this reason (a defensive belt-and-suspenders check in addition to the
 * correct Accept header, in case BSE ever changes the shell's exact size).
 *
 * ARCHIVE DEPTH (verified live 2026-08-12): real data at 2025-01-01,
 * 2024-11-01; the SPA shell (not real data) at 2024-12-01 and earlier —
 * BSE's UDiFF migration boundary sits between Nov and Dec 2024. Comfortably
 * exceeds the brief's ~1-year backfill target.
 *
 * ── COLUMNS (UDiFF unified format, SEBI-mandated) ─────────────────────────
 *
 * `TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,
 * XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,
 * LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,
 * ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,
 * Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4` — `Sgmt` discriminates CM (equity cash
 * market — the only segment this module reads) from other segments the same
 * unified file family can in principle carry.
 *
 * ── EQUITY-SERIES FILTER (SctySrs) ─────────────────────────────────────────
 *
 * Live-sampled 2026-08-12 across all 16 SctySrs values BSE's CM segment
 * carries. Included (common-equity groups, BSE's own market-cap/surveillance
 * tiers — A/B are the large/broad boards, M/MS/MT are SME boards, T is
 * trade-to-trade settlement, X/XT is the default/thinly-traded group, Z/ZP
 * is the non-compliant/shell-company watchlist — still real, tradeable
 * common equity, just under a compliance flag):
 *   A, B, M, MS, MT, T, X, XT, Z, ZP
 * EXCLUDED, each independently verified by sample content, not guessed:
 *   - E, F: funds/ETFs (e.g. "INVESCO India Gold Exchange Tr", "DSP NIFTY 1D
 *     Rate Liquid ETF") — Phase 3B's scope (BSE funds/ETFs), not this
 *     module's.
 *   - G: government securities ("920GOI2030", "1018GOI2026") — bonds, out of
 *     this brief's scope entirely (no founder ask to extend BondEodQuote to
 *     BSE).
 *   - IF: InvIT/REIT trusts ("IRB InvIT Fund", "IndiGrid Infrastructure
 *     Trust") — a distinct instrument type, no founder ask covers these.
 *   - P, R: preference shares / rights entitlements — not common equity,
 *     negligible volume (9 and 2 rows respectively on the verification day),
 *     would confuse the equity universe if mixed in.
 *
 * ── DUAL-LISTING DEDUP (the founder's own framing: "missing in NSE") ──────
 *
 * The assigning brief specified reusing `resolveNseSymbolByCompanyName`
 * (name-normalized match) plus a ticker-symbol-coincidence check. Both are
 * used here, but ISIN-exact-match is added as the PRIMARY signal, ahead of
 * both — found live during this phase's verification, not anticipated by
 * the brief:
 *
 *   1. ISIN exact match against the UNION of NSE's own equity master
 *      (EQUITY_L.csv) AND NSE's own ETF master (eq_etfseclist.csv) ISIN
 *      columns. This is the single most reliable signal available: an ISIN
 *      is a globally unique per-security identifier, immune to name-spelling
 *      variance. Verified live 2026-08-12: of 4,455 BSE CM equity-series
 *      rows, 2,420 matched an ISIN in the equity+ETF union outright — vs.
 *      only 1 additional row caught by the name matcher below. The ETF
 *      master is included specifically because BSE's bhavcopy carries
 *      dual-listed NSE ETFs under BSE's OWN equity-series SctySrs (not just
 *      the E/F fund series already excluded above) — GOLDBEES/SILVERBEES/
 *      LIQUIDBEES all appeared in the equity-series rows with BSE ISINs
 *      EXACTLY matching their NSE eq_etfseclist.csv ISINs
 *      (INF204KB17I5/INF204KC1402/INF732E01037) — without the ETF master in
 *      the union, all three would have been wrongly ingested as "BSE-only
 *      stocks," creating a duplicate, confusing page for an instrument that
 *      already has a canonical NSE `/instruments/GOLDBEES`-style page. This
 *      is exactly the "never touch how a dual-listed name resolves" law the
 *      brief itself states, just caught one level deeper than the brief
 *      anticipated (ETFs live in a separate NSE master file from plain
 *      equities, so an equity-only ISIN check misses them).
 *   2. `resolveNseSymbolByCompanyName` (apps/api/lib/marketMoves/
 *      nseSymbolResolver.ts) — REUSED, not reimplemented, per the brief's
 *      explicit instruction. Catches the residual ISIN-miss cases (name
 *      matches but the ISIN differs — e.g. a distinct share class/series of
 *      an otherwise-dual-listed company). Verified live: exactly 1 of 4,455
 *      rows ("ATLPP" / Allcargo Terminals Limited) caught only here.
 *
 * DELIBERATE DEVIATION FROM THE BRIEF: the brief also asked for a raw
 * ticker-symbol-coincidence check ("also match by ticker symbol where
 * BSE/NSE tickers coincide"). Live-tested and REJECTED as a standalone
 * signal — it produces a real false positive: BSE ticker "KALYANI" (scrip
 * 544023, ISIN INE0N6U01018) is "Kalyani Cast-Tech Limited," a genuinely
 * BSE-only company; NSE's OWN "KALYANI" ticker (ISIN INE610E01010) is the
 * UNRELATED "Kalyani Commercials Limited." Two different companies, same
 * mnemonic on each exchange. A blind ticker-coincidence rule would have
 * wrongly suppressed Kalyani Cast-Tech's real BSE-only page. Per this
 * codebase's own standing precision-over-recall law (nseSymbolResolver.ts's
 * own doc comment: "a wrong link is strictly worse than an unlinked one"),
 * ticker coincidence is NOT used as an independent dedup trigger — ISIN and
 * name-match (both corroborated identity signals) are the only two paths to
 * "dual-listed, skip." Flagging this back per the brief's own "flag back if
 * you disagree" allowance.
 *
 * Verified final count, live 2026-08-12: 2,034 BSE-only equities (of 4,455
 * equity-series CM rows; 2,420 dual via ISIN, 1 more via name match). Zero
 * duplicate `TckrSymb`/`FinInstrmId` values within that BSE-only set.
 *
 * ── VOLUME FLOOR (set empirically, NOT NSE's MIN_LIQUIDITY_QTY=10,000 —
 * BSE-exclusive names trade far thinner, per the brief's own instruction) ──
 *
 * NOT enforced at ingestion — every post-dedup row is stored regardless of
 * liquidity ("informational parity, never silently drop data," same law as
 * StockEodQuote/BondEodQuote). The floor gates PRESENTATION only (apps/web:
 * page noindex, browse/search inclusion, sitemap) — see
 * apps/web/lib/finance/bseEquity.ts's `MIN_BSE_EQUITY_LIQUIDITY_QTY`.
 * Chosen from the live volume distribution of the 2,034 BSE-only rows:
 *   p10=15  p25=~180  p50=~2,300  p75=~15,800  p90=~78,000
 * `MIN_BSE_EQUITY_LIQUIDITY_QTY = 500` clears 1,608/2,034 (79.1%) — filters
 * the thinnest, essentially-untraded tail (rows trading only tens to a few
 * hundred shares/day, often stale/thin-book prices) while keeping the large
 * majority of the universe indexable. 20x lower than NSE's 10,000 floor,
 * reflecting how much thinner this universe genuinely trades.
 *
 * ── BSE FUNDS/ETFs (Phase 3B, 2026-08-14) — NOT a separate SctySrs, verified
 * live, corrects this module's own EQUITY-SERIES FILTER note above ─────────
 *
 * This module's own comment above (Phase 3A) guessed E/F = "funds/ETFs,
 * Phase 3B's scope" from two sampled names. Live-verified 2026-08-14 against
 * the FULL current bhavcopy and it's WRONG as a classification rule: `E`
 * carries physical-commodity ETFs (Gold/Silver) that are ALL dual-listed on
 * NSE (excluded by the existing ISIN dedup with zero survivors), and `F`
 * is overwhelmingly corporate NCDs/bonds/InvIT units (361 of 368 rows on the
 * verification day) plus a handful of mutual-fund "segregated portfolio"
 * wind-down units (side-pocketed units created after a bond default — not a
 * purchasable fund) — zero genuine, investable BSE-only ETFs found under E
 * or F. Meanwhile the bulk of real BSE-listed ETFs (NIFTYBEES-equivalents,
 * ICICI Prudential *IETF, DSP *ADD, Nippon India *BEES, SBI/Kotak/Bandhan
 * Sensex ETFs, ...) trade under `SctySrs` `B` — the SAME series already
 * included in `EQUITY_SERIES` above, indistinguishable from a plain stock by
 * series alone. There is therefore NO usable SctySrs-based fund/ETF marker
 * in this file (unlike NSE's separate eq_etfseclist.csv master) — per this
 * brief's own fallback instruction, fund identification is done entirely in
 * apps/web as a PRESENTATION-layer classification over the SAME
 * EQUITY_SERIES-ingested `BseEodQuote` rows this module already writes: a
 * row whose `isin` matches AMFI's registered scheme master (NAVAll.txt) is a
 * fund (apps/web/lib/finance/bseFundRegistry.ts). No ingestion or schema
 * change — `EQUITY_SERIES` stays exactly as Phase 3A defined it, since it
 * already carries every genuine BSE-only fund found live (7 confirmed
 * SENSEX/BSE-100/BSE-Sensex-Next-50-tracking ETFs, series B, on the
 * verification day — see bseFundRegistry.ts's own module doc for the full
 * list and the segregated-portfolio exclusion rule).
 */

import { resolveNseSymbolByCompanyName } from "./nseSymbolResolver";

const BHAVCOPY_ORIGIN = "https://www.bseindia.com";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.3";

/** The Accept-header gotcha (see module doc) — application/json, NOT a browser Accept, is what unlocks the real CSV instead of BSE's Angular SPA shell. */
const BHAVCOPY_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const FETCH_TIMEOUT_MS = 30_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** BSE's Angular SPA shell (the wrong-Accept-header false positive) is ~13.8KB and identical for every date — anything at or below this is treated as "not the real file," belt-and-suspenders alongside the correct Accept header. */
const SPA_SHELL_MAX_BYTES = 20_000;

const EQUITY_SERIES = new Set(["A", "B", "M", "MS", "MT", "T", "X", "XT", "Z", "ZP"]);

function istDateParts(sessionDate: Date): { dd: string; mm: string; yyyy: number } {
  const ist = new Date(sessionDate.getTime() + IST_OFFSET_MS);
  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: ist.getUTCFullYear(),
  };
}

function bhavcopyUrl(sessionDate: Date): string {
  const { dd, mm, yyyy } = istDateParts(sessionDate);
  return `${BHAVCOPY_ORIGIN}/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${yyyy}${mm}${dd}_F_0000.CSV`;
}

// ─── NSE ISIN masters (equity + ETF) — dedup ground truth ──────────────────

const NSE_EQUITY_MASTER_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const NSE_ETF_LIST_URL = "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv";
const ARCHIVE_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/csv,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};
const ISIN_SET_TTL_MS = 12 * 60 * 60 * 1000;
let isinSetCache: { at: number; isins: Set<string> } | null = null;

/** Parses "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE" -> the ISIN column (index 6). */
function parseIsinColumn(csv: string, isinColumnIndex: number): Set<string> {
  const isins = new Set<string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(",").map((c) => c.trim());
    const isin = cells[isinColumnIndex];
    if (isin) isins.add(isin);
  }
  return isins;
}

async function fetchIsinSet(url: string, isinColumnIndex: number, label: string): Promise<Set<string>> {
  try {
    const res = await fetch(url, { headers: ARCHIVE_HEADERS });
    if (!res.ok) {
      console.warn(`[marketMoves/bseBhavcopy] ${label} returned ${res.status}`);
      return new Set();
    }
    // Both NSE master CSVs are occasionally not strict UTF-8 (see
    // etfRegistry.ts's own identical caveat for eq_etfseclist.csv) — decode
    // defensively rather than letting a single bad byte throw.
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("windows-1252").decode(buf);
    return parseIsinColumn(text, isinColumnIndex);
  } catch (err) {
    console.warn(`[marketMoves/bseBhavcopy] ${label} fetch error: ${err instanceof Error ? err.message : err}`);
    return new Set();
  }
}

/**
 * Union of NSE's equity-master ISINs (EQUITY_L.csv, column 6) and NSE's own
 * ETF-master ISINs (eq_etfseclist.csv, column 5) — see module doc's "found
 * live" note on why the ETF master must be included too. Cached 12h,
 * independently of nse.ts's own `fetchEquityNames` cache (small, deliberate
 * duplication of the equity-master fetch — this module is the ONLY consumer
 * of the ISIN column, not worth threading a shared cache through a function
 * 4+ other files already depend on for a different shape).
 */
async function fetchNseIsinUniverse(): Promise<Set<string>> {
  const now = Date.now();
  if (isinSetCache && now - isinSetCache.at < ISIN_SET_TTL_MS) return isinSetCache.isins;

  const [equityIsins, etfIsins] = await Promise.all([
    fetchIsinSet(NSE_EQUITY_MASTER_URL, 6, "equity master (EQUITY_L.csv)"),
    fetchIsinSet(NSE_ETF_LIST_URL, 5, "ETF master (eq_etfseclist.csv)"),
  ]);
  const union = new Set([...equityIsins, ...etfIsins]);
  if (union.size > 0) isinSetCache = { at: now, isins: union };
  return isinSetCache?.isins ?? union;
}

// ─── Bhavcopy parse ──────────────────────────────────────────────────────

type BseBhavcopyRow = {
  scripCode: string;
  isin: string | null;
  tickerSymbol: string;
  securityGroup: string;
  companyName: string;
  prevClose: number;
  close: number;
  volume: number;
};

function parseBseBhavcopyCsv(csv: string): BseBhavcopyRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((c) => c.trim());
  const idx = (name: string) => header.indexOf(name);
  const sgmtIdx = idx("Sgmt");
  const scripIdx = idx("FinInstrmId");
  const isinIdx = idx("ISIN");
  const tickerIdx = idx("TckrSymb");
  const seriesIdx = idx("SctySrs");
  const nameIdx = idx("FinInstrmNm");
  const closeIdx = idx("ClsPric");
  const prevCloseIdx = idx("PrvsClsgPric");
  const volIdx = idx("TtlTradgVol");

  if ([sgmtIdx, scripIdx, tickerIdx, seriesIdx, nameIdx, closeIdx, prevCloseIdx, volIdx].some((i) => i < 0)) {
    console.warn("[marketMoves/bseBhavcopy] unexpected CSV header shape, missing required column(s)");
    return [];
  }

  const rows: BseBhavcopyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // UDiFF is a plain comma split (no embedded commas observed in any
    // field this module reads — company names with a literal comma would be
    // the one risk, not observed live across the full 4,987-row sample).
    const cells = line.split(",").map((c) => c.trim());
    if (cells[sgmtIdx] !== "CM") continue;
    const series = cells[seriesIdx];
    if (!EQUITY_SERIES.has(series)) continue;

    const scripCode = cells[scripIdx];
    const tickerSymbol = cells[tickerIdx];
    const companyName = cells[nameIdx];
    const close = Number(cells[closeIdx]);
    const prevClose = Number(cells[prevCloseIdx]);
    const volume = Number(cells[volIdx]);
    if (!scripCode || !tickerSymbol || !companyName) continue;
    if (![close, prevClose, volume].every(Number.isFinite)) continue;

    rows.push({
      scripCode,
      isin: cells[isinIdx] || null,
      tickerSymbol,
      securityGroup: series,
      companyName,
      prevClose,
      close,
      volume,
    });
  }
  return rows;
}

/**
 * Shared fetch step: GETs the UDiFF CSV for the given IST session date.
 * Returns `null` (never throws) for every "not available yet" case — a
 * non-200, or a response at/under the SPA-shell size (see module doc) — so
 * the cron/backfill can treat it uniformly as "nothing to ingest this run."
 */
async function fetchBseBhavcopyText(sessionDate: Date): Promise<string | null> {
  const url = bhavcopyUrl(sessionDate);

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, { cache: "no-store", headers: BHAVCOPY_HEADERS, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`[marketMoves/bseBhavcopy] fetch error for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!res.ok) {
    console.log(`[marketMoves/bseBhavcopy] ${url} -> ${res.status}`);
    return null;
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength <= SPA_SHELL_MAX_BYTES) {
    console.log(`[marketMoves/bseBhavcopy] ${url} -> ${buf.byteLength} bytes (SPA shell / not published yet)`);
    return null;
  }
  return new TextDecoder("utf-8").decode(buf);
}

// ─── Dedup + shape ──────────────────────────────────────────────────────

export type FetchedBseEodQuote = {
  scripCode: string;
  tickerSymbol: string;
  isin: string | null;
  companyName: string;
  securityGroup: string;
  prevClose: number;
  close: number;
  changePercent: number;
  volume: number;
};

/**
 * Filters parsed BSE bhavcopy rows down to BSE-EXCLUSIVE companies — see
 * module doc for the full ISIN-first, name-match-fallback dedup law. Never
 * throws; a resolver failure (e.g. NSE's own archives host briefly down)
 * degrades to an empty ISIN set, which — importantly — means EVERY row would
 * then look "BSE-only" (fail-open on liquidity/coverage, not fail-closed on
 * correctness would be wrong here). To avoid that failure mode silently
 * mass-ingesting dual-listed names as BSE-only on a transient NSE-archives
 * outage, this function returns `null` (not an empty/full ingest) whenever
 * the ISIN universe itself failed to resolve to a non-trivial size.
 */
export async function dedupBseOnlyRows(rows: BseBhavcopyRow[]): Promise<FetchedBseEodQuote[] | null> {
  const isinUniverse = await fetchNseIsinUniverse();
  if (isinUniverse.size < 1000) {
    // A healthy NSE equity+ETF ISIN union is ~2,700+ — anything drastically
    // smaller means the archives fetch degraded, and trusting it would risk
    // mass-duplicating dual-listed names. Bail out honestly instead.
    console.warn(
      `[marketMoves/bseBhavcopy] NSE ISIN universe suspiciously small (${isinUniverse.size}) — skipping this run rather than risking a bad dedup pass`
    );
    return null;
  }

  const out: FetchedBseEodQuote[] = [];
  for (const row of rows) {
    if (row.isin && isinUniverse.has(row.isin)) continue; // dual-listed via ISIN — NSE canonical, skip
    const nseSymbol = await resolveNseSymbolByCompanyName(row.companyName);
    if (nseSymbol) continue; // dual-listed via name match — NSE canonical, skip

    const changePercent = row.prevClose > 0 ? ((row.close - row.prevClose) / row.prevClose) * 100 : 0;
    out.push({
      scripCode: row.scripCode,
      tickerSymbol: row.tickerSymbol,
      isin: row.isin,
      companyName: row.companyName,
      securityGroup: row.securityGroup,
      prevClose: row.prevClose,
      close: row.close,
      changePercent,
      volume: row.volume,
    });
  }
  return out;
}

/**
 * Fetches BSE's UDiFF equity bhavcopy for the given IST session date and
 * returns every BSE-EXCLUSIVE equity-series row (dual-listed names already
 * filtered out — see module doc). Returns `null` (never throws) when the
 * file isn't available yet (not yet published this evening, weekend/holiday
 * with no session) or the dedup pass itself couldn't run safely.
 */
export async function fetchBseEquityEodQuotes(sessionDate: Date): Promise<FetchedBseEodQuote[] | null> {
  const csv = await fetchBseBhavcopyText(sessionDate);
  if (!csv) return null;
  const rows = parseBseBhavcopyCsv(csv);
  if (rows.length === 0) return null;
  return dedupBseOnlyRows(rows);
}

// Exported for the collision-check script and for a one-off sanity re-run —
// not otherwise consumed outside this module.
export { parseBseBhavcopyCsv, fetchNseIsinUniverse };
export type { BseBhavcopyRow };
