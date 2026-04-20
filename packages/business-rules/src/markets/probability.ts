import { PositionSide } from "@prisma/client";

export function calculateProbabilities(yesPool: number, noPool: number) {
  const total = yesPool + noPool;
  if (total === 0) {
    return { yesProbability: 0.5, noProbability: 0.5 };
  }

  return {
    yesProbability: yesPool / total,
    noProbability: noPool / total
  };
}

export function calculateEstimatedReturn(
  side: PositionSide,
  amount: number,
  yesPool: number,
  noPool: number
) {
  const projectedYesPool = side === PositionSide.YES ? yesPool + amount : yesPool;
  const projectedNoPool = side === PositionSide.NO ? noPool + amount : noPool;

  if (side === PositionSide.YES) {
    if (projectedYesPool === 0) {
      return amount;
    }
    return Math.floor(amount + (amount / projectedYesPool) * projectedNoPool);
  }

  if (projectedNoPool === 0) {
    return amount;
  }

  return Math.floor(amount + (amount / projectedNoPool) * projectedYesPool);
}
