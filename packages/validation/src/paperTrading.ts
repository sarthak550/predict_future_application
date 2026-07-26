import { z } from "zod";

/**
 * Paper Trading Phase 1 — request body schemas for apps/web/app/api/paper-trading/*.
 * Mirrors the shape of packages/validation/src/portfolio.ts.
 */

export const PAPER_TRADING_MAX_QUANTITY = 10_000_000; // sanity ceiling, not a real market-depth constraint

export const placePaperOrderSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(32, "Symbol is too long.")
    .transform((value) => value.toUpperCase()),
  side: z.enum(["BUY", "SELL"]),
  productType: z.enum(["DELIVERY", "INTRADAY"]),
  quantity: z
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(PAPER_TRADING_MAX_QUANTITY, "Quantity is too large."),
  /**
   * Set when the order was placed via "Paper trade this call" — links the
   * resulting PaperOrder back to the ExpertOpinion it was traded from. The route
   * validates the referenced opinion actually exists before accepting it.
   */
  linkedOpinionId: z.string().trim().min(1).optional()
});

// ─── Paper Trading Phase 2 (Index Options) ────────────────────────────────────

/** Sanity ceiling on lots per order — not a real market-depth constraint, same judgment call as PAPER_TRADING_MAX_QUANTITY above. */
export const PAPER_TRADING_MAX_OPTION_LOTS = 10_000;

/**
 * Phase 3 widened underlyingSymbol from a closed z.enum(["NIFTY","BANKNIFTY"])
 * to a validated free-form string: the F&O stock universe (~210 names) changes
 * over time (quarterly eligibility reviews), so it can never be a compile-time
 * enum. Format/length is checked here (cheap, synchronous); ACTUAL membership
 * (NIFTY/BANKNIFTY or a live F&O stock symbol) is re-validated server-side
 * against the live universe in lib/paperTrading/optionOrders.ts's
 * placeOptionOrder, which is the only place that can afford the async check.
 */
export const placePaperOptionOrderSchema = z.object({
  underlyingSymbol: z
    .string()
    .trim()
    .min(1, "underlyingSymbol is required.")
    .max(32, "underlyingSymbol is too long.")
    .transform((value) => value.toUpperCase()),
  optionType: z.enum(["CE", "PE"]),
  strikePrice: z.number().positive("Strike price must be positive."),
  /** NSE's own "DD-MMM-YYYY" expiry string, exactly as returned by GET /api/paper-trading/options/expiries — re-validated server-side against the live chain, never trusted as-is for pricing. */
  expiryDate: z.string().trim().min(1, "Expiry date is required."),
  side: z.enum(["BUY", "SELL"]),
  lots: z
    .number()
    .int("Lots must be a whole number.")
    .min(1, "Lots must be at least 1.")
    .max(PAPER_TRADING_MAX_OPTION_LOTS, "Too many lots."),
  /**
   * Set when the order was placed via "Paper trade this call" — same linkage
   * semantics as placePaperOrderSchema above. Unused by Phase 2 (index options
   * had no index-opinion pairing to exploit); wired for real by Phase 3's
   * "Trade options on this call" secondary CTA (BULLISH -> CE, BEARISH -> PE
   * on the linked call's F&O-eligible stock).
   */
  linkedOpinionId: z.string().trim().min(1).optional()
});

// ─── Paper Trading Phase 4 (Index Futures) ────────────────────────────────────

/** Sanity ceiling on lots per order — same judgment-call posture as PAPER_TRADING_MAX_OPTION_LOTS. */
export const PAPER_TRADING_MAX_FUTURES_LOTS = 10_000;

/**
 * Index-only this phase (stock futures cut — see the Phase 4 brief's verdict
 * section) — unlike options' underlyingSymbol (a free-form string re-validated
 * async against the live F&O stock universe), futures underlyings are a fixed,
 * synchronous 5-value closed set, so a real z.enum is correct here rather than
 * a placeholder free-form string.
 */
export const placePaperFuturesOrderSchema = z.object({
  underlyingSymbol: z.enum(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]),
  /** NSE's own "DD-MMM-YYYY" expiry string, exactly as returned by GET /api/paper-trading/futures/quote's allContracts — re-validated server-side against a live quote, never trusted as-is for pricing. */
  expiryDate: z.string().trim().min(1, "Expiry date is required."),
  side: z.enum(["BUY", "SELL"]),
  lots: z
    .number()
    .int("Lots must be a whole number.")
    .min(1, "Lots must be at least 1.")
    .max(PAPER_TRADING_MAX_FUTURES_LOTS, "Too many lots.")
});
