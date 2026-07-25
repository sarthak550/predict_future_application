/**
 * Market Pulse — BSE unofficial JSON endpoint fetcher.
 *
 * ✅ VERIFIED LIVE 2026-07-10 from this dev sandbox: unlike NSE (blocked at
 * the Akamai WAF layer regardless of headers — see nse.ts), BSE's API host
 * (api.bseindia.com) returned real, current announcement data with nothing
 * more than a standard browser User-Agent + Origin/Referer set to
 * https://www.bseindia.com/ — no cookie priming/session handshake needed.
 * Confirmed field names, the `AnnSubCategoryGetData` endpoint path (NOT the
 * differently-named `AnnGetData` endpoint some older guides reference — that
 * one silently returns `"No Record Found!"` regardless of params), the
 * `strscrip`/`strSearch`/`strType` param casing, and the PDF attachment URL
 * pattern below by live request/response during implementation.
 *
 * Endpoint: GET https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w
 *   params: pageno, strCat ("-1" = all), subcategory ("-1" = all),
 *           strPrevDate (YYYYMMDD, from), strToDate (YYYYMMDD, to),
 *           strSearch ("P"), strscrip (optional BSE scrip code filter),
 *           strType ("C" = equity/company segment)
 *   NOTE: BSE enforces a max date-range window — requesting more than a few
 *   days back returns `{"Status":false,"Message":"Date range exceeded
 *   threshold."}`. We only ever request "today" (same day for both bounds),
 *   consistent with the 3-5 min polling cadence, so this never bites us.
 *
 * PDF attachment URL: https://www.bseindia.com/xml-data/corpfiling/AttachLive/{ATTACHMENTNAME}
 * (verified 200 application/pdf).
 */

import { resolveNseSymbolByCompanyName } from "./nseSymbolResolver";
import { classifyMarketMoveEventType } from "./classify";
import type { FetchedMarketMoveEvent } from "./types";

const BSE_API_BASE = "https://api.bseindia.com/BseIndiaAPI/api";
const BSE_ORIGIN = "https://www.bseindia.com/";
const BSE_ATTACHMENT_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachLive";

const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.3",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Origin: BSE_ORIGIN,
  Referer: BSE_ORIGIN,
};

type BseAnnouncementRow = {
  NEWSID?: string | null;
  SCRIP_CD?: number | string | null;
  SLONGNAME?: string | null;
  NEWSSUB?: string | null;
  MORE?: string | null;
  NEWS_DT?: string | null; // "YYYY-MM-DDTHH:mm:ss.ss", IST wall-clock, no offset
  ATTACHMENTNAME?: string | null;
  CATEGORYNAME?: string | null;
  SUBCATNAME?: string | null;
  NSURL?: string | null;
};

type BseAnnouncementResponse = {
  Table?: BseAnnouncementRow[];
  Table1?: { ROWCNT: number }[];
  Status?: boolean;
  Message?: string;
};

function fmtYyyymmdd(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Parses BSE's `NEWS_DT` ("YYYY-MM-DDTHH:mm:ss.ss", IST wall-clock) into a UTC Date. */
function parseBseIstTimestamp(newsDt: string | null | undefined): Date | null {
  if (!newsDt) return null;
  const d = new Date(`${newsDt}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchBsePage(
  pageNo: number,
  dateParam: string
): Promise<{ rows: BseAnnouncementRow[]; rowCount: number } | null> {
  const params = new URLSearchParams({
    pageno: String(pageNo),
    strCat: "-1",
    subcategory: "-1",
    strPrevDate: dateParam,
    strToDate: dateParam,
    strSearch: "P",
    strscrip: "",
    strType: "C",
  });

  try {
    const res = await fetch(`${BSE_API_BASE}/AnnSubCategoryGetData/w?${params.toString()}`, {
      headers: BSE_HEADERS,
    });
    if (!res.ok) {
      console.warn(`[marketMoves/bse] announcements page ${pageNo} returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as BseAnnouncementResponse | Record<string, never>;
    if ("Status" in json && json.Status === false) {
      console.warn(`[marketMoves/bse] announcements page ${pageNo}: ${json.Message ?? "unknown error"}`);
      return null;
    }
    const typed = json as BseAnnouncementResponse;
    return { rows: typed.Table ?? [], rowCount: typed.Table1?.[0]?.ROWCNT ?? typed.Table?.length ?? 0 };
  } catch (err) {
    console.warn(`[marketMoves/bse] announcements page ${pageNo} network/parse error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

const MAX_PAGES = 5; // safety cap — a normal 3-5 min poll window rarely exceeds one page

/**
 * Fetches today's BSE corporate announcements (equity segment). Every row
 * from this feed carries a SCRIP_CD, so nothing is dropped for lacking a
 * ticker — BSE-only listings are tagged `BSE:{scripCode}` per the CEO's
 * ticker-first rule (BSE codes are still a valid, specific ticker even
 * without an NSE symbol mapping). Never throws.
 */
export async function fetchBseAnnouncements(): Promise<FetchedMarketMoveEvent[]> {
  const dateParam = fmtYyyymmdd(new Date());
  const out: FetchedMarketMoveEvent[] = [];
  let seenSoFar = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await fetchBsePage(page, dateParam);
    if (!result || result.rows.length === 0) break;
    const { rows, rowCount } = result;

    for (const row of rows) {
      const scripCode = row.SCRIP_CD != null ? String(row.SCRIP_CD) : null;
      const companyName = row.SLONGNAME?.trim();
      const newsId = row.NEWSID?.trim();
      const headline = row.NEWSSUB?.trim();
      // Drop rule: no resolved scrip/company/id/headline → not ingestable.
      if (!scripCode || !companyName || !newsId || !headline) continue;

      const announcedAt = parseBseIstTimestamp(row.NEWS_DT) ?? new Date();
      const detailUrl = row.ATTACHMENTNAME?.trim()
        ? `${BSE_ATTACHMENT_BASE}/${row.ATTACHMENTNAME.trim()}`
        : row.NSURL?.trim() || null;

      // Dual-listed companies resolve to their NSE symbol by exact normalized
      // company-name match against the equity master — so the filing (and
      // every news article the news universe derives from it) links to a real
      // /instruments page instead of carrying a dead BSE:<code> badge. BSE-only
      // listings keep the code (still a valid, specific ticker).
      const nseSymbol = await resolveNseSymbolByCompanyName(companyName);

      out.push({
        source: "BSE",
        sourceId: newsId,
        tickerSymbol: nseSymbol ?? `BSE:${scripCode}`,
        tickerType: "STOCK", // this feed (strType=C, equity segment) never carries index-level rows
        companyName,
        eventType: classifyMarketMoveEventType(row.CATEGORYNAME, row.SUBCATNAME, headline),
        headline,
        detailUrl,
        rawText: row.MORE?.trim() || null,
        announcedAt,
      });
    }

    // Table1[0].ROWCNT is the total match count across all pages; stop once
    // we've paged past it (or the API stopped returning full pages).
    seenSoFar += rows.length;
    if (seenSoFar >= rowCount) break;
  }

  return out;
}
