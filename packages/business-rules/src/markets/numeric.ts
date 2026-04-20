import { NumericTieBreakerRule, Prisma } from "@prisma/client";

export function parseNumericPayoutDistribution(
  value: Prisma.JsonValue | number[] | null | undefined
) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }

  return [];
}

export function validateNumericGuess(input: {
  value: number;
  minValue?: number | null;
  maxValue?: number | null;
  precision?: number | null;
}) {
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new Error("Enter a valid non-negative guess.");
  }

  if (input.minValue !== null && input.minValue !== undefined && input.value < input.minValue) {
    throw new Error(`Guess must be at least ${input.minValue}.`);
  }

  if (input.maxValue !== null && input.maxValue !== undefined && input.value > input.maxValue) {
    throw new Error(`Guess must be at most ${input.maxValue}.`);
  }

  if (input.precision !== null && input.precision !== undefined) {
    const factor = 10 ** input.precision;
    const rounded = Math.round(input.value * factor) / factor;
    if (Math.abs(rounded - input.value) > 1e-9) {
      throw new Error(`Guess must use at most ${input.precision} decimal places.`);
    }
  }
}

type NumericPosition = {
  id: string;
  userId: string;
  amount: number;
  numericValue: number;
  createdAt: Date;
};

export function calculateNumericWinnerPayouts(input: {
  positions: NumericPosition[];
  actualValue: number;
  winnersCount: number;
  payoutDistribution: number[];
  tieBreakerRule: NumericTieBreakerRule;
  grossPool: number;
  hostCommission: number;
}) {
  const distributablePool = Math.max(0, input.grossPool - input.hostCommission);
  const ranked = input.positions
    .map((position) => ({
      ...position,
      absoluteError: Math.abs(position.numericValue - input.actualValue)
    }))
    .sort((left, right) => {
      if (left.absoluteError !== right.absoluteError) {
        return left.absoluteError - right.absoluteError;
      }

      return left.createdAt.getTime() - right.createdAt.getTime();
    });

  if (ranked.length === 0) {
    return [];
  }

  if (input.tieBreakerRule === NumericTieBreakerRule.EARLIEST) {
    return ranked.slice(0, input.winnersCount).map((position, index) => ({
      positionId: position.id,
      userId: position.userId,
      payout: Math.floor((distributablePool * input.payoutDistribution[index]) / 100),
      absoluteError: position.absoluteError,
      numericValue: position.numericValue
    }));
  }

  const winners: Array<{
    positionId: string;
    userId: string;
    payout: number;
    absoluteError: number;
    numericValue: number;
  }> = [];

  let slotIndex = 0;
  let cursor = 0;
  while (slotIndex < input.winnersCount && cursor < ranked.length) {
    const error = ranked[cursor].absoluteError;
    const tied = ranked.filter((position) => position.absoluteError === error);
    const remainingSlots = input.winnersCount - slotIndex;
    const slotPercentages = input.payoutDistribution.slice(slotIndex, slotIndex + remainingSlots);
    const tiedPercentages = slotPercentages.slice(0, Math.max(1, Math.min(tied.length, remainingSlots)));
    const combinedPercentage = tiedPercentages.reduce((sum, percentage) => sum + percentage, 0);
    const perWinnerPayout = Math.floor((distributablePool * combinedPercentage) / 100 / tied.length);

    for (const position of tied) {
      winners.push({
        positionId: position.id,
        userId: position.userId,
        payout: perWinnerPayout,
        absoluteError: position.absoluteError,
        numericValue: position.numericValue
      });
    }

    slotIndex += tiedPercentages.length;
    cursor += tied.length;
  }

  return winners;
}
