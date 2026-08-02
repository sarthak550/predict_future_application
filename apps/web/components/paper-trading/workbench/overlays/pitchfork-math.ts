/**
 * TA Suite Sprint S1, T2 — shared median-line math for the 4 pitchfork
 * variants (`andrewsPitchfork`/`schiffPitchfork`/`modifiedSchiffPitchfork`/
 * `insidePitchfork`). All 4 take the SAME 3 anchor points (P0, P1, P2 in
 * click order) but differ in which point the median line is anchored to —
 * hand-checkable against a 3-point example per the ticket's acceptance
 * criteria:
 *
 * - **andrews** (the classic/original pitchfork): median runs P0 →
 *   midpoint(P1,P2). Tines through P1 and P2, parallel to the median.
 * - **schiff**: median START shifts to midpoint(P0,P1) but keeps the SAME
 *   target, midpoint(P1,P2) — a real, distinct, verifiable slope change
 *   from andrews (moving the start point changes the line's slope since
 *   the target is unchanged). Tines unchanged (P1, P2).
 * - **modifiedSchiff**: median START is also midpoint(P0,P1), but the
 *   target changes to P2 itself (not midpoint(P1,P2)) — distinct again
 *   from both andrews and schiff. Tines unchanged (P1, P2).
 * - **inside** ("inside out" / reverse pitchfork): swaps which point plays
 *   the "handle" role — median runs P2 → midpoint(P0,P1), i.e. the LAST
 *   click is the handle instead of the first. Tines through P0 and P1.
 *
 * All 4 tine pairs are parallel to their own median (same direction
 * vector), extended to the chart's right bounding edge by the caller
 * (`figure-kit.ts`'s `extendToRightEdge`) — this file only computes the
 * anchor points, never pixel extension (that's geometry the family file
 * owns, since it needs `bounding.width` which this module doesn't receive).
 */
import type { Coordinate } from "klinecharts";
import { midpoint } from "./figure-kit";

export type PitchforkVariant = "andrews" | "schiff" | "modifiedSchiff" | "inside";

export interface PitchforkGeometry {
  /** Median line's start point. */
  medianStart: Coordinate;
  /** Median line's target/direction point (pre-extension). */
  medianEnd: Coordinate;
  /** First tine's anchor — a line parallel to the median passes through this point. */
  tineAAnchor: Coordinate;
  /** Second tine's anchor. */
  tineBAnchor: Coordinate;
}

export function computePitchforkGeometry(p0: Coordinate, p1: Coordinate, p2: Coordinate, variant: PitchforkVariant): PitchforkGeometry {
  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  switch (variant) {
    case "andrews":
      return { medianStart: p0, medianEnd: m12, tineAAnchor: p1, tineBAnchor: p2 };
    case "schiff":
      return { medianStart: m01, medianEnd: m12, tineAAnchor: p1, tineBAnchor: p2 };
    case "modifiedSchiff":
      return { medianStart: m01, medianEnd: p2, tineAAnchor: p1, tineBAnchor: p2 };
    case "inside":
      return { medianStart: p2, medianEnd: m01, tineAAnchor: p0, tineBAnchor: p1 };
    default:
      return { medianStart: p0, medianEnd: m12, tineAAnchor: p1, tineBAnchor: p2 };
  }
}

/** The direction vector (unnormalized) of a computed median — tines are drawn parallel by translating this same vector from their own anchor. */
export function medianDirection(geo: PitchforkGeometry): Coordinate {
  return { x: geo.medianEnd.x - geo.medianStart.x, y: geo.medianEnd.y - geo.medianStart.y };
}
