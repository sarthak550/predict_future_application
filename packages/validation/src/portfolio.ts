import { z } from "zod";

/**
 * P3.1 Portfolios — request body schemas for apps/web/app/api/portfolios/*.
 * Mirrors the shape of packages/validation/src/group.ts.
 */

export const PORTFOLIO_MAX_PER_USER = 5;

export const createPortfolioSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters.").max(60, "Name is too long."),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  description: z.string().max(280, "Description is too long.").optional().or(z.literal(""))
});

/**
 * PATCH /api/portfolios/:id — only name/description/visibility are patchable.
 * All fields optional (partial update); at least one must be present, enforced by
 * the route handler rather than here (zod's `.refine` error messaging is worse for
 * this case than a plain route-level check).
 */
export const updatePortfolioSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters.").max(60, "Name is too long.").optional(),
  description: z.string().max(280, "Description is too long.").nullable().optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional()
});

export const placeTransactionSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(32, "Symbol is too long.")
    .transform((value) => value.toUpperCase()),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int("Quantity must be a whole number.").min(1, "Quantity must be at least 1.")
});
