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
