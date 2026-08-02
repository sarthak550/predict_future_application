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
import {
  labelFigure,
  pathFigure,
  solidLine,
  outlinedRect,
  fillPolygon,
  circleFigure,
  formatRupeesLabel,
  resolvePfContent,
  resolveTextColor,
  resolveTextBackground,
  INK_600,
  AMBER,
  EMERALD,
  ROSE,
  SKY,
  VIOLET,
} from "./figure-kit";

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

  // ── textLabel — 1pt: BORDERLESS plain text (no background box), unlike ──
  // `calloutText`/`noteAnchored`'s boxed labels. Wired to the same D10 text
  // popover (`chart-workbench.tsx`'s `TEXT_FAMILY_OVERLAYS`/`kline-chart
  // .tsx`'s `TEXT_INPUT_OVERLAYS`, both widened this pass).
  registerOverlay({
    name: "textLabel",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const { text } = resolvePfContent(overlay.styles);
      const color = resolveTextColor(overlay.styles, INK_600);
      return [
        {
          type: "text",
          attrs: { x: anchor.x, y: anchor.y - 14, text: text && text.length > 0 ? text : "Add text…", align: "center", baseline: "bottom" },
          styles: { color, backgroundColor: "transparent", size: 12, weight: 600, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, borderRadius: 0 },
        },
      ];
    },
  });

  // ── priceNote — 2pt: note bubble at P1 + pointer line back to P0 + P0's ──
  // own price folded into the label (`calloutText`'s anchor+box+connector
  // shape, widened with a deterministic price suffix).
  registerOverlay({
    name: "priceNote",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor, boxPos] = coordinates;
      const box = boxPos ?? { x: anchor.x + 60, y: anchor.y - 40 };
      const { text } = resolvePfContent(overlay.styles);
      const color = resolveTextBackground(overlay.styles, SKY);
      const textColor = resolveTextColor(overlay.styles, "#ffffff");
      const price = overlay.points[0]?.value ?? 0;
      const content = text && text.length > 0 ? `${text} · ${formatRupeesLabel(price)}` : formatRupeesLabel(price);
      const figures: OverlayFigure[] = [];
      if (boxPos) figures.push(solidLine([anchor, box], color, 1));
      figures.push(labelFigure(box, content, { background: color, color: textColor, align: "left" }));
      return figures;
    },
  });

  // ── pin — 1pt map-pin glyph. No text (matches `flagMark`/`arrowMark*`'s ──
  // glyph-only precedent, not the text-family tools). Teardrop via cubic
  // beziers (`C` — verified supported by the mini path parser against
  // `dist/index.esm.js`'s `drawPath`, same file every other path-figure
  // claim in this program has been checked against), tip anchored at the
  // point, plus a small circular "hole" figure for the classic pin look.
  registerOverlay({
    name: "pin",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const color = resolveTextBackground(overlay.styles, ROSE);
      return [
        pathFigure(anchor.x, anchor.y, "M 0 0 C -10 -14 -11 -24 0 -24 C 11 -24 10 -14 0 0 Z", color, { fill: true, width: 22, height: 24 }),
        circleFigure(anchor.x, anchor.y - 16, 3.5, color, { fill: "#ffffff", size: 1.2 }),
      ];
    },
  });

  // ── commentBubble — 1pt: speech-bubble body (rect + pointer tail) + ─────
  // user text centered inside.
  registerOverlay({
    name: "commentBubble",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const { text } = resolvePfContent(overlay.styles);
      const color = resolveTextBackground(overlay.styles, VIOLET);
      const textColor = resolveTextColor(overlay.styles, "#ffffff");
      const width = 140;
      const height = 34;
      const bubbleX = anchor.x - width / 2;
      const bubbleY = anchor.y - height - 14;
      const tail: OverlayFigure = fillPolygon(
        [
          { x: anchor.x - 6, y: bubbleY + height },
          { x: anchor.x + 6, y: bubbleY + height },
          { x: anchor.x, y: anchor.y },
        ],
        color,
        color,
        1,
      );
      return [
        outlinedRect(bubbleX, bubbleY, width, height, color, color, 1),
        tail,
        {
          type: "text",
          attrs: { x: anchor.x, y: bubbleY + height / 2, text: text && text.length > 0 ? text : "Add comment…", align: "center", baseline: "middle" },
          styles: { color: textColor, backgroundColor: "transparent", size: 11, weight: 600, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, borderRadius: 0 },
        },
      ];
    },
  });

  // ── signpost — 1pt: post glyph + user text ABOVE the post. ──────────────
  registerOverlay({
    name: "signpost",
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
      return [
        pathFigure(anchor.x, anchor.y, "M 0 0 L 0 -26", color, { lineWidth: 2.2 }),
        outlinedRect(anchor.x - 2, anchor.y - 32, 22, 9, color, color, 1),
        labelFigure({ x: anchor.x, y: anchor.y - 32 }, text && text.length > 0 ? text : "Signpost", { background: color, color: textColor, dy: 6 }),
      ];
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
