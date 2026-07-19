import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";

type ResolutionStatus = OpinionResolutionStatus;
type Direction = OpinionDirection;

/**
 * Verdict badge for a call's resolution outcome.
 *
 * Deliberately neutral for MISS (default/gray, NOT the `danger`/red variant) — a miss is
 * shown factually, never as a shaming signal. Legal framing requirement: no "worst
 * analyst" surfaces, no editorializing on misses.
 */
export function VerdictBadge({ status }: { status: ResolutionStatus }) {
  switch (status) {
    case "RESOLVED_HIT":
      return <Badge variant="success">HIT</Badge>;
    case "RESOLVED_MISS":
      return <Badge variant="default">MISS</Badge>;
    case "PENDING":
      return <Badge variant="warning">PENDING</Badge>;
    case "NOT_GRADED":
    default:
      return <Badge variant="default">NOT GRADED</Badge>;
  }
}

const directionLabels: Record<Direction, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
};

const directionVariants: Record<Direction, "success" | "danger" | "default"> = {
  BULLISH: "success",
  BEARISH: "danger",
  NEUTRAL: "default",
};

export function DirectionChip({ direction }: { direction: Direction }) {
  return <Badge variant={directionVariants[direction]}>{directionLabels[direction]}</Badge>;
}
