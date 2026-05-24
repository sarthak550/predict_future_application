/**
 * Re-exports everything from the shared business-rules numeric module.
 * Overrides parseNumericPayoutDistribution to add Zod schema validation:
 * on bad shape, logs a warning and returns [] rather than silently computing
 * wrong payouts.
 */
export {
  validateNumericGuess,
  calculateNumericWinnerPayouts,
} from "@predict-future/business-rules/markets/numeric";

import { Prisma } from "@prisma/client";
import { payoutDistributionSchema } from "@/lib/json-schemas";

export function parseNumericPayoutDistribution(
  value: Prisma.JsonValue | number[] | null | undefined
): number[] {
  if (!value) {
    return [];
  }

  const result = payoutDistributionSchema.safeParse(value);
  if (!result.success) {
    console.warn(
      "[parseNumericPayoutDistribution] Invalid payoutDistributionJson shape — returning []. Issues:",
      result.error.issues
    );
    return [];
  }

  return result.data.filter((item) => Number.isFinite(item));
}
