/**
 * TA Suite Sprint S1, T5 — the 6 annotation tools + emoji sticker. All of
 * them read their user-entered content from `overlay.styles.pfContent`
 * (plan decision D1: `{text?, emoji?}`, a sibling of the `line`/`polygon`/
 * `text` style buckets — see `figure-kit.ts`'s `resolvePfContent`), NOT
 * from `extendData` — `extendData` is reserved for the persistedId
 * side-channel (`kline-chart.tsx`'s `overlayIdToPersistedIdRef`) and, for
 * the ONE built-in exception (`simpleAnnotation`), a klinecharts-native
 * closure — see that file's module doc for the full simpleAnnotation fix.
 * These 6 custom overlays never touch `extendData` at all inside their own
 * `createPointFigures`, unlike `simpleAnnotation` (a klinecharts built-in
 * we don't register here — it already exists in `custom-overlays.ts`'s old
 * `BUILT_IN_DRAWING_OVERLAYS` list, now `catalog.ts`).
 *
 * A placeholder ("Add text…" / a neutral note icon / a plain star) renders
 * for every text-family tool BEFORE the D10 popover's first confirm — an
 * annotation is never invisible immediately after being drawn, only after
 * an EXPLICIT empty-text dismissal (which deletes it entirely — handled in
 * `kline-chart.tsx`/`chart-workbench.tsx`, not here).
 */
import { registerOverlay, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import { labelFigure, pathFigure, solidLine, formatRupeesLabel, resolvePfContent, resolveTextColor, resolveTextBackground, INK_600, AMBER, EMERALD, ROSE } from "./figure-kit";

export function registerAnnotationOverlays(): void {
  // ── calloutText — 2pt: P0 the chart anchor (pointer), P1 the padded ────
  // text box position.
  registerOverlay({
    name: "calloutText",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor, boxPos] = coordinates;
      const box = boxPos ?? { x: anchor.x + 60, y: anchor.y - 40 };
      const { text } = resolvePfContent(overlay.styles);
      const color = resolveTextBackground(overlay.styles, INK_600);
      const textColor = resolveTextColor(overlay.styles, "#ffffff");
      const figures: OverlayFigure[] = [];
      if (boxPos) figures.push(solidLine([anchor, box], color, 1));
      figures.push(labelFigure(box, text && text.length > 0 ? text : "Add text…", { background: color, color: textColor, align: "left" }));
      return figures;
    },
  });

  // ── noteAnchored — 1pt bubble. The Note toolbar button's forward-going ──
  // default (simpleAnnotation stays enum-supported only for pre-existing
  // rows — see the module doc + kline-chart.tsx's fix).
  registerOverlay({
    name: "noteAnchored",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const { text } = resolvePfContent(overlay.styles);
      const color = resolveTextBackground(overlay.styles, AMBER);
      const textColor = resolveTextColor(overlay.styles, "#ffffff");
      return [labelFigure({ x: anchor.x, y: anchor.y }, text && text.length > 0 ? text : "Note", { background: color, color: textColor, dy: 18, align: "left" })];
    },
  });

  // ── priceLabel — 1pt, formatted point value. Deterministic content — ───
  // deliberately NOT wired to the D10 text popover (its text is always the
  // anchor's own price, nothing for a user to type), a documented scope
  // trim flagged in the sprint's final report.
  registerOverlay({
    name: "priceLabel",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const value = overlay.points[0]?.value ?? 0;
      const color = resolveTextBackground(overlay.styles, INK_600);
      return [labelFigure(anchor, formatRupeesLabel(value), { background: color, align: "left" })];
    },
  });

  // ── flagMark — 1pt path glyph (pole + flag). ────────────────────────────
  registerOverlay({
    name: "flagMark",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const color = resolveTextBackground(overlay.styles, AMBER);
      return [
        pathFigure(anchor.x, anchor.y, "M 0 0 L 0 -18", color, { lineWidth: 1.8 }),
        pathFigure(anchor.x, anchor.y, "M 0 -18 L 12 -13 L 0 -8 Z", color, { fill: true }),
      ];
    },
  });

  // ── arrowMarkUp / arrowMarkDown — 1pt polygon-glyph markers. ───────────
  registerOverlay({
    name: "arrowMarkUp",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const color = resolveTextBackground(overlay.styles, EMERALD);
      return [pathFigure(anchor.x, anchor.y, "M -7 0 L 7 0 L 0 -15 Z", color, { fill: true })];
    },
  });
  registerOverlay({
    name: "arrowMarkDown",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const color = resolveTextBackground(overlay.styles, ROSE);
      return [pathFigure(anchor.x, anchor.y, "M -7 0 L 7 0 L 0 15 Z", color, { fill: true })];
    },
  });

  // ── emojiSticker — 1pt, 24px text glyph from styles.pfContent.emoji. ───
  // The toolbar's 12-emoji flyout picks the emoji BEFORE drawing
  // (`pendingToolStyles`, threaded through `kline-chart.tsx`'s draw-start
  // effect) — this overlay just renders whatever's in `pfContent.emoji` at
  // draw time, falling back to a neutral star if somehow unset.
  registerOverlay({
    name: "emojiSticker",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const { emoji } = resolvePfContent(overlay.styles);
      return [
        {
          type: "text",
          attrs: { x: anchor.x, y: anchor.y, text: emoji && emoji.length > 0 ? emoji : "⭐", align: "center", baseline: "middle" },
          styles: { size: 24, color: "#000000", backgroundColor: "transparent", paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, borderRadius: 0 },
        },
      ];
    },
  });
}
