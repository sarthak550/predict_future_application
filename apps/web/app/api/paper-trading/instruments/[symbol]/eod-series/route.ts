import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Same session count as /instruments/[symbol]'s own spark window — enough for PriceChart's MAX/1Y timeframes. */
const SPARK_SESSIONS = 260;

/**
 * GET /api/paper-trading/instruments/[symbol]/eod-series
 *
 * Trading Terminal UI Overhaul (Sprint A, T6) — daily-close EOD series for the
 * options terminal's stock-underlying chart. NOT part of the brief's literal
 * Data Layer spec (which only covers the 1D index-intraday path) — added
 * because the options terminal's chart pane needs a real `series` prop for a
 * STOCK underlying's non-1D timeframes (1W/1M/3M/…), and the underlying is
 * chosen dynamically client-side (Index/Stock toggle + combobox), so the
 * existing server-component fetch on /instruments/[symbol] can't supply it.
 *
 * Queries StockEodQuote directly — apps/web already has hoisted Prisma access
 * to this table (see lib/finance/instrument.ts's fetchInstrumentDetail,
 * lib/paperTrading/queries.ts) — same convention as every other read-side
 * query in this domain, just exposed as a small client-fetchable JSON route
 * instead of an SSR-only function, because the caller here is a Client
 * Component (option-chain-browser's mode toggle changes the underlying at
 * runtime, not at page-load).
 *
 * Public endpoint — no auth required (same posture as
 * /api/instruments/[symbol]/intraday). Empty array (never a 404) when the
 * symbol has no EOD rows yet — PriceChart already renders an honest
 * "not enough price history" state for an empty series.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const rows = await prisma.stockEodQuote.findMany({
    where: { symbol },
    orderBy: { sessionDate: "desc" },
    take: SPARK_SESSIONS,
    select: { sessionDate: true, close: true }
  });

  const series = rows
    .slice()
    .reverse()
    .map((r) => ({ date: r.sessionDate.toISOString().slice(0, 10), close: r.close }));

  const response = NextResponse.json({ symbol, series });
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
