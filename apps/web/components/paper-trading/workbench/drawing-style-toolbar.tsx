"use client";

/**
 * TA Suite Sprint S1, T7 — the style editor. Per plan decision D9: Apply =
 * instant `overrideOverlay` (zero round-trip latency) + a separately-fired
 * debounced PATCH — this component is deliberately DUMB/presentational
 * (color palette, 3 line widths, an optional "Edit text" for text-family
 * tools, Delete); the actual style-merge logic (reading the drawing's
 * CURRENT `styles`, shallow-merging in the picked color/width across the
 * `line`/`polygon`/`text` buckets a swatch could plausibly affect) lives in
 * `chart-workbench.tsx`, which owns `drawingsHook.drawings` and can look the
 * current row up by `persistedId`.
 *
 * **Founder-feedback pass (2026-08-04) — docked, not floating.** Previously
 * a small toolbar `absolute`-anchored at the just-finished drawing's own
 * first point (`top: anchor - 48`) — the founder's own complaint: it "hides
 * the chart itself" right where the user just drew. Now rendered by the
 * caller as a fixed slim bar pinned to `absolute inset-x-0 top-0` of the
 * chart's own `relative` wrapper (just under the workbench's top bar,
 * `chart-workbench.tsx`'s `<div className="relative min-w-0 flex-1">`) —
 * it can never cover the drawn region, and no longer takes a `left`/`top`
 * anchor prop at all (paired with the OTHER half of this fix,
 * `kline-chart.tsx`'s `justFinishedDrawRef`, which stops this toolbar from
 * even OPENING on a draw-completion auto-select in the first place — it now
 * opens only on an explicit later click on an EXISTING drawing).
 *
 * Width buttons are `h-8 w-8` (32px, the sprint's explicit a11y floor) with
 * a visible ring (not color alone) marking the currently-active choice,
 * matching `tool-flyout.tsx`'s star-toggle posture. Color swatches are now
 * the shared `<ColorPalette>` (founder-feedback pass, "color choices are
 * very less" — see that component's own doc for the 24-swatch grid + custom
 * picker, replacing the old hardcoded 6-swatch `SWATCH_COLORS` row).
 */
import { Trash2, Type, X } from "lucide-react";

import { LINE_WIDTHS } from "./overlays/figure-kit";
import { ColorPalette } from "./color-palette";

export function DrawingStyleToolbar({
  activeColor,
  activeWidth,
  canEditText,
  onPickColor,
  onPickWidth,
  onEditText,
  onDelete,
  onClose
}: {
  activeColor?: string | null;
  activeWidth?: number | null;
  canEditText: boolean;
  onPickColor: (color: string) => void;
  onPickWidth: (width: number) => void;
  onEditText?: () => void;
  onDelete: () => void;
  /** Dismiss the bar without deleting the drawing (klinecharts keeps it selected internally — clicking elsewhere on the canvas / Escape already do this too; this is just a direct affordance now that the bar is a persistent docked strip rather than something that goes away on its own). */
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-1.5 border-b border-ink-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <span className="mr-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Style</span>

      <ColorPalette activeColor={activeColor} onPick={onPickColor} size="md" align="left" />

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

      <button type="button" title="Close" aria-label="Close style editor" onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
