import { prisma } from "@/lib/prisma";
import type { FetchedMarketMover } from "./types";

/**
 * BSE Movers (2026-08-15, founder: "Market Pulse top gainers/losers fetch
 * data for both exchanges") — that session's BSE-EXCLUSIVE equities shaped
 * as movers, merged into the "ALL" universe by the movers cron's EOD pass.
 *
 * DB-read, not a second exchange fetch: `BseEodQuote` is already ingested
 * daily by the market-moves-bse-eod cron (14:20 + 15:50 UTC) with
 * close/prevClose/changePercent — this just reads the session back. The
 * movers cron's every-5-minute opportunistic EOD reruns are session-replace
 * idempotent, so the first tick AFTER the BSE ingest lands folds BSE in
 * automatically — no crontab ordering dependency.
 *
 * Ticker namespace: `${tickerSymbol}.BO` — the same page-symbol convention
 * search/sitemap/instrument pages use, so a mover row's
 * `/instruments/[symbol]` link works as-is and the exchange is visible at a
 * glance (a BSE row never masquerades as an NSE one; the dedup law already
 * guarantees BseEodQuote holds only BSE-EXCLUSIVE names, so no company can
 * appear twice across the merged list).
 *
 * Floor: same ₹1L turnover threshold as the platform-wide presentation
 * floor (apps/web/lib/finance/bseEquity.ts's MIN_BSE_EQUITY_TURNOVER_RS —
 * duplicated by value, no cross-app import path exists; keep in sync), but
 * evaluated on TODAY's turnover only, deliberately not the 30-session-MAX
 * window search/sitemap use: a mover is a claim about today's action, and a
 * name whose only real trading was weeks ago has no business on today's
 * gainers board even though its page stays searchable. NSE's own "ALL"
 * universe applies a volume>1,000 liquidity filter for the same reason
 * (bhavcopy.ts) — share-count floors bury high-price BSE names (the YSL
 * lesson), hence turnover here.
 */
const MIN_BSE_MOVER_TURNOVER_RS = 100_000;

/** That session's BSE-only movers (above today's turnover floor, non-zero move). Never throws — an empty/failed read degrades to an NSE-only movers list. */
export async function fetchBseOnlyMovers(sessionDate: Date): Promise<FetchedMarketMover[]> {
  const rows = await prisma.bseEodQuote.findMany({
    where: { sessionDate },
    select: {
      tickerSymbol: true,
      companyName: true,
      close: true,
      prevClose: true,
      changePercent: true,
      volume: true,
    },
  });

  return rows
    .filter((r) => r.close * r.volume >= MIN_BSE_MOVER_TURNOVER_RS && r.changePercent !== 0)
    .map((r) => ({
      tickerSymbol: `${r.tickerSymbol.toUpperCase()}.BO`,
      companyName: r.companyName,
      changePercent: r.changePercent,
      changeAbs: r.close - r.prevClose,
      volume: Math.round(r.volume),
      lastPrice: r.close,
      direction: (r.changePercent > 0 ? "GAINER" : "LOSER") as FetchedMarketMover["direction"],
    }));
}
