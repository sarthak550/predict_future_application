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

export const placePaperOptionOrderSchema = z.object({
  underlyingSymbol: z.enum(["NIFTY", "BANKNIFTY"], {
    errorMap: () => ({ message: "underlyingSymbol must be NIFTY or BANKNIFTY." })
  }),
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
   * Set when the order was placed via "Paper trade this call" — same
   * linkage semantics as placePaperOrderSchema above. Options legs are not
   * currently wired to any CTA (Phase 2 scope), but the field is accepted for
   * forward-compatibility with the shared PaperOrder.linkedOpinionId column.
   */
  linkedOpinionId: z.string().trim().min(1).optional()
});
