import { NextResponse } from "next/server";

import { fetchInstrumentDetail } from "@/lib/finance/instrument";
import type { PanelSummaryResponse } from "@/lib/paperTrading/panelSummaryTypes";

export const dynamic = "force-dynamic";

/**
 * GET /api/paper-trading/instruments/[symbol]/panel-summary
 *
 * Workbench Symbol Panel (Workstream D2, 2026-08-17) — thin, public, no-auth
 * JSON route feeding the maximized Charting Workbench's right-side
 * TradingView-style symbol detail panel (`symbol-detail-panel.tsx`). Same
 * posture as `../eod-series/route.ts` (`force-dynamic`, public, a small
 * client-fetchable payload for a Client Component that can't call Prisma
 * directly) — this is the SECOND application of that exact thin-route
 * pattern, not a new one.
 *
 * D1 — reuses `fetchInstrumentDetail(symbol)` WHOLESALE rather than
 * hand-rolling a slimmer server-side query: that function already gets the
 * index-vs-equity-vs-ETF-vs-BSE branching correct (~200 lines of
 * unexported logic in instrument.ts), including threading the right
 * `exchange` ("BSE" vs "NSE") into `getOrFetchInstrumentEnrichment`
 * INTERNALLY, from the symbol's own shape — a BSE-only `.BO` equity symbol
 * resolves its enrichment correctly with zero extra plumbing here (verified
 * by reading that call site: `instrument.ts` computes `isBseEquity` from
 * `rawSymbol` itself and passes `isBseEquity ? "BSE" : "NSE"` regardless of
 * caller). This route only trims the RESPONSE, dropping every field the
 * panel doesn't render — `news`, `filings`, `opinions` (the raw list; the
 * aggregate `sentiment` split IS kept), `spark`, `indexComposition`,
 * `etfsTrackingIndex`, and the live `quote` (the panel intentionally has no
 * price display of its own — a second, independently-polled price next to
 * the chart's own live quote would drift and mislead; see Decision D2 of
 * the brief).
 *
 * `Cache-Control: public, max-age=60` — fundamentals/index-metrics move
 * slowly (60s is plenty fresh) while still blunting repeat-symbol-switch DB
 * load. Deliberately shorter than `eod-series`'s 300s: `indexMetrics`/
 * `sentiment` are somewhat live-ish, unlike a closed daily EOD series.
 *
 * Response shape lives in `lib/paperTrading/panelSummaryTypes.ts`, shared
 * with `use-symbol-panel-summary.ts` (D3) via a type-only import — neither
 * side imports across the `app/` route-handler boundary.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const detail = await fetchInstrumentDetail(symbol);
  if (!detail) {
    return NextResponse.json({ error: "Symbol not found." }, { status: 404 });
  }

  const keyStats = detail.enrichment.keyStats;
  const payload: PanelSummaryResponse = {
    symbol: detail.symbol,
    companyName: detail.companyName,
    isIndex: detail.isIndex,
    viewOnlyIndex: detail.viewOnlyIndex,
    isEtf: detail.isEtf,
    // Minimal ETF summary — see Decision D4's ETF branch: this panel
    // deliberately does NOT ship the full `EtfDetailsPanelEntry` (isin,
    // faceValue, dateOfListing all stay full-page-only), just enough for an
    // honest "Tracks {index} →" line alongside the "View full research"
    // link every branch already gets.
    etf:
      detail.isEtf && detail.etfDetails
        ? { trackedIndexName: detail.etfDetails.trackedIndexName, trackedIndexSymbol: detail.etfDetails.trackedIndexSymbol }
        : null,
    indexMetrics: detail.indexMetrics,
    sentiment: detail.sentiment,
    keyStats: keyStats
      ? {
          marketCap: keyStats.marketCap,
          trailingPE: keyStats.trailingPE,
          dividendYield: keyStats.dividendYield,
          trailingEps: keyStats.trailingEps,
          beta1Y: keyStats.beta1Y,
          beta5Y: keyStats.beta5Y,
          beta: keyStats.beta,
          floatShares: keyStats.floatShares,
          nextEarningsDate: keyStats.nextEarningsDate,
          nextEarningsDateEnd: keyStats.nextEarningsDateEnd,
          businessSummary: keyStats.businessSummary
        }
      : null,
    fundamentalsFetchedAt: detail.enrichment.fundamentalsFetchedAt ? detail.enrichment.fundamentalsFetchedAt.toISOString() : null
  };

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
