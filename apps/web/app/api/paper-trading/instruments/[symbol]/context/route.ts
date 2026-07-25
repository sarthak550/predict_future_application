import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * GET /api/paper-trading/instruments/[symbol]/context
 *
 * Lightweight "what does the Analyst Scorecard know about this stock?"
 * summary for the trading terminals: analyst-opinion count (same 90-day
 * window and instrumentTicker `startsWith("SYMBOL.")` matching as
 * lib/finance/instrument.ts, so the count always agrees with what the
 * /instruments/[symbol] page shows on click-through) + recent news count
 * (30 days). Counts only — the instrument page itself is the detail view;
 * this exists to advertise it from inside Paper Trading.
 *
 * Public (counts of public content), cacheable for 5 minutes.
 */

const OPINION_LOOKBACK_DAYS = 90; // keep in lockstep with lib/finance/instrument.ts
const NEWS_LOOKBACK_DAYS = 30;

/** Index opinions store Yahoo index tickers (verified in prod: "^NSEI"/"^NSEBANK"), not "SYMBOL.NS" — exact match, no suffix. */
const INDEX_OPINION_TICKERS: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
};

export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }

  const now = Date.now();
  const opinionSince = new Date(now - OPINION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const newsSince = new Date(now - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const indexTicker = INDEX_OPINION_TICKERS[symbol];
  const [opinionsCount, newsCount] = await Promise.all([
    prisma.expertOpinion.count({
      where: {
        suppressedAt: null,
        instrumentTicker: indexTicker ? { equals: indexTicker } : { startsWith: `${symbol}.`, mode: "insensitive" },
        publishedAt: { gte: opinionSince },
      },
    }),
    prisma.marketMoveNews.count({
      where: { tickerSymbol: symbol, publishedAt: { gte: newsSince } },
    }),
  ]);

  const response = NextResponse.json({ symbol, opinionsCount, newsCount });
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
