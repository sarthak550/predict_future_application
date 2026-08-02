/**
 * TA Suite Sprint S1, T2 — the 4 pitchfork variants. Shared anchor math in
 * `pitchfork-math.ts` (read that file's doc first — it documents exactly
 * which anchor each variant's median is pinned to). All 4 are 3-point,
 * totalStep 4: lines + a translucent polygon between the two tines +
 * dashed handle markers at the raw click points.
 */
import { registerOverlay, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import { computePitchforkGeometry, medianDirection, type PitchforkVariant } from "./pitchfork-math";
import { solidLine, dashedLine, fillPolygon, extendToRightEdge, resolveLineColor, resolvePolygonColor, labelFigure, SKY, SKY_FILL } from "./figure-kit";

function buildPitchfork(variant: PitchforkVariant, label: string) {
  return ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
    if (coordinates.length < 2) return [];
    if (coordinates.length === 2) return [dashedLine(coordinates)];

    const [p0, p1, p2] = coordinates;
    const color = resolveLineColor(overlay.styles, SKY);
    const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
    const geo = computePitchforkGeometry(p0, p1, p2, variant);
    const rightX = bounding.width;
    const dir = medianDirection(geo);

    const medianExtended = extendToRightEdge(geo.medianStart, geo.medianEnd, rightX);
    const tineAExtended = extendToRightEdge(geo.tineAAnchor, { x: geo.tineAAnchor.x + dir.x, y: geo.tineAAnchor.y + dir.y }, rightX);
    const tineBExtended = extendToRightEdge(geo.tineBAnchor, { x: geo.tineBAnchor.x + dir.x, y: geo.tineBAnchor.y + dir.y }, rightX);

    return [
      fillPolygon([geo.tineAAnchor, tineAExtended, tineBExtended, geo.tineBAnchor], fill, color, 1),
      solidLine([geo.medianStart, medianExtended], color, 1.6),
      solidLine([geo.tineAAnchor, tineAExtended], color, 1.1),
      solidLine([geo.tineBAnchor, tineBExtended], color, 1.1),
      labelFigure(p0, `${label} P0`),
      labelFigure(p1, `${label} P1`),
      labelFigure(p2, `${label} P2`),
    ];
  };
}

export function registerPitchforkOverlays(): void {
  registerOverlay({ name: "andrewsPitchfork", totalStep: 4, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true, createPointFigures: buildPitchfork("andrews", "Andrews") });
  registerOverlay({ name: "schiffPitchfork", totalStep: 4, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true, createPointFigures: buildPitchfork("schiff", "Schiff") });
  registerOverlay({ name: "modifiedSchiffPitchfork", totalStep: 4, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true, createPointFigures: buildPitchfork("modifiedSchiff", "Mod. Schiff") });
  registerOverlay({ name: "insidePitchfork", totalStep: 4, needDefaultPointFigure: true, needDefaultXAxisFigure: true, needDefaultYAxisFigure: true, createPointFigures: buildPitchfork("inside", "Inside") });
}
