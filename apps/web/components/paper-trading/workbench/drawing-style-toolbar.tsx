"use client";

/**
 * TA Suite Sprint S1, T7 — the style editor: a floating mini-toolbar that
 * appears on a drawing's `onSelected` (already wired — see
 * `kline-chart.tsx`'s `onDrawingSelected` prop, firing with a computed
 * pixel anchor). Per plan decision D9: Apply = instant `overrideOverlay`
 * (zero round-trip latency) + a separately-fired debounced PATCH — this
 * component is deliberately DUMB/presentational (6 color swatches, 3 line
 * widths, an optional "Edit text" for text-family tools, Delete); the
 * actual style-merge logic (reading the drawing's CURRENT `styles`,
 * shallow-merging in the picked color/width across the `line`/`polygon`/
 * `text` buckets a swatch could plausibly affect) lives in
 * `chart-workbench.tsx`, which owns `drawingsHook.drawings` and can look
 * the current row up by `persistedId`.
 *
 * Swatches and width buttons are `h-8 w-8` (32px, the sprint's explicit
 * a11y floor) with a visible ring (not color alone) marking the currently-
 * active choice, matching `tool-flyout.tsx`'s star-toggle posture.
 */
import { Trash2, Type } from "lucide-react";

import { SWATCH_COLORS, LINE_WIDTHS } from "./overlays/figure-kit";

export function DrawingStyleToolbar({
  left,
  top,
  activeColor,
  activeWidth,
  canEditText,
  onPickColor,
  onPickWidth,
  onEditText,
  onDelete
}: {
  left: number;
  top: number;
  activeColor?: string | null;
  activeWidth?: number | null;
  canEditText: boolean;
  onPickColor: (color: string) => void;
  onPickWidth: (width: number) => void;
  onEditText?: () => void;
  onDelete: () => void;
}) {
  const anchorRight = left > 320;

  return (
    <div
      className="absolute z-20 flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg"
      style={{ left: anchorRight ? undefined : left, right: anchorRight ? `calc(100% - ${left}px)` : undefined, top: Math.max(0, top - 48) }}
    >
      {SWATCH_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          aria-label={`Color ${color}`}
          aria-pressed={activeColor === color}
          onClick={() => onPickColor(color)}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${activeColor === color ? "ring-2 ring-offset-1 ring-sky-500" : "hover:bg-ink-50"}`}
        >
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
        </button>
      ))}

      <span className="mx-0.5 h-6 w-px bg-ink-100" aria-hidden="true" />

      {LINE_WIDTHS.map((width) => (
        <button
          key={width}
          type="button"
          title={`Width ${width}`}
          aria-label={`Line width ${width}`}
          aria-pressed={activeWidth === width}
          onClick={() => onPickWidth(width)}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${activeWidth === width ? "ring-2 ring-offset-1 ring-sky-500" : "hover:bg-ink-50"}`}
        >
          <span className="w-4 rounded-full bg-ink-700" style={{ height: Math.max(1.5, width) }} />
        </button>
      ))}

      {canEditText && onEditText && (
        <>
          <span className="mx-0.5 h-6 w-px bg-ink-100" aria-hidden="true" />
          <button type="button" title="Edit text" aria-label="Edit text" onClick={onEditText} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900">
            <Type className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}

      <span className="mx-0.5 h-6 w-px bg-ink-100" aria-hidden="true" />
      <button type="button" title="Delete" aria-label="Delete drawing" onClick={onDelete} className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
