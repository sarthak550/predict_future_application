import type { InstrumentIndexMetrics, InstrumentSentiment } from "@/lib/finance/instrument";

/**
 * Workbench Symbol Panel (Workstream D2/D3, 2026-08-17) — the JSON shape
 * `GET /api/paper-trading/instruments/[symbol]/panel-summary` returns.
 * Shared between the route (server) and `use-symbol-panel-summary.ts`
 * (client) via a plain type-only import from this file, rather than either
 * side importing across the `app/` route-handler boundary — no existing
 * precedent in this codebase for importing types out of a `route.ts`, and a
 * shared `lib/` type keeps both sides honest without one depending on the
 * other's file location.
 */
export interface PanelSummaryResponse {
  symbol: string;
  companyName: string;
  isIndex: boolean;
  viewOnlyIndex: boolean;
  isEtf: boolean;
  /** Minimal ETF summary — see the route's own doc for why this deliberately excludes isin/faceValue/dateOfListing (full-page-only). */
  etf: { trackedIndexName: string | null; trackedIndexSymbol: string | null } | null;
  /** Null for a plain equity/ETF. */
  indexMetrics: InstrumentIndexMetrics | null;
  sentiment: InstrumentSentiment;
  /** Null when Yahoo enrichment hasn't landed for this symbol yet (cold cache) OR this is an index (never fetched) — the panel renders an honest "warming up" state, never a blank card. */
  keyStats: {
    marketCap?: number;
    trailingPE?: number;
    dividendYield?: number;
    trailingEps?: number;
    beta1Y?: number;
    beta5Y?: number;
    beta?: number;
    floatShares?: number;
    nextEarningsDate?: string;
    nextEarningsDateEnd?: string;
    businessSummary?: string;
  } | null;
  /** ISO timestamp, null = never successfully fetched — drives the panel's "Fundamentals as of" caption. */
  fundamentalsFetchedAt: string | null;
}
