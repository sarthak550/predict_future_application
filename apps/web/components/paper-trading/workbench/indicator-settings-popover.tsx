"use client";

/**
 * TA Suite Sprint S2, T4 — per-instance settings popover: one number input
 * per `indicator-registry.ts` `params` spec (labeled), reset-to-default,
 * apply. Out-of-range input CLAMPS to the param's declared `[min, max]`
 * rather than being sent to `overrideIndicator` raw (product-gap addition:
 * a 0-period MA is either a crash or silent garbage) — clamping happens
 * both on blur (so the visible input reflects what will actually be
 * applied) and again defensively inside `clampParams` at the call site in
 * `kline-chart.tsx`, so a malformed value can never reach klinecharts even
 * if this component's own clamp were ever bypassed.
 *
 * **Founder bug fix (2026-08-04, per-line style pass) — the Style section
 * rewrite.** The founder-feedback pass's original Style section applied ONE
 * color/width to the WHOLE instance via a single-element `overrideIndicator
 * ({styles:{lines:[...]}})` array — a deliberate, documented scope decision
 * at the time, but it manifested as a real bug report: "choosing a color in
 * an indicator makes ALL the lines the same colour" (e.g. `MA(5,10,30,60)`'s
 * four distinct lines collapsing to one). This section now renders ONE
 * color-swatch row PER LINE FIGURE of the instance, discovered at RUNTIME
 * via the `figures` prop (`chart-workbench.tsx`'s `indicatorFigures` map,
 * itself sourced from `chart.getIndicators({id}).figures` in
 * `kline-chart.tsx` — never a hand-built catalogue, so a figure's label
 * here is always whatever klinecharts itself calls that line: MA1..MA4,
 * UP/MID/DN, DIF/DEA, K/D/J, etc.). Width stays a SINGLE shared control
 * across all lines of the instance — a deliberate scope call, not an
 * oversight (see `chart-workbench.tsx`'s `handleApplyIndicatorWidth` doc for
 * the reasoning): per-line width would double this section's row count for
 * multi-line indicators (`CR` has 5 lines, `MA`/`BBI` have 4) for little
 * real value, since traders overwhelmingly distinguish stacked lines by
 * color, not thickness.
 *
 * Each swatch/width click calls straight through to `chart-workbench.tsx`,
 * which persists the override into `indicators` (React state + localStorage,
 * `indicator-registry.ts`'s `IndicatorInstance.styles`) AND instantly applies
 * it via the existing nonce command channel — so `instance.styles.lines[]` is
 * the single source of truth for which swatch shows "active" here (no local
 * component state), and a reopened popover (or a reload) reflects exactly
 * what's on the chart.
 *
 * **SUPERTREND's one line figure is a real, flagged exception**: its
 * `styles` callback (`custom-indicators/pack-a.ts`) unconditionally returns
 * a trend-based `color` (green/red flip) — verified against klinecharts'
 * own figure-style resolution order (`{...defaultFigureStyles, ...ss}`,
 * `dist/index.esm.js`'s `eachFigures`), the figure's own returned `color`
 * always wins over anything submitted through `styles.lines[]`. A picked
 * COLOR is therefore a silent no-op for SUPERTREND specifically — by
 * design, the flip color IS the indicator's signal — so its line row shows
 * a note instead of live-but-inert swatches. WIDTH still applies (the
 * callback only ever returns `color`).
 */
import { useState } from "react";
import { RotateCcw, X } from "lucide-react";

import {
  clampParams,
  getIndicatorMeta,
  resolveParams,
  indicatorDisplayName,
  type IndicatorInstance,
  type IndicatorLineFigure
} from "./indicator-registry";
import { LINE_WIDTHS } from "./overlays/figure-kit";
import { ColorPalette } from "./color-palette";

/** Indicators whose line-figure `styles` callback ignores a submitted color (see module doc) — a color row for one of these names renders a note instead of swatches. Currently just SUPERTREND; re-verify against the relevant `custom-indicators/pack-*.ts` template before adding another name here. */
const COLOR_OVERRIDE_IGNORED_NAMES = new Set(["SUPERTREND"]);

export function IndicatorSettingsPopover({
  instance,
  figures,
  left,
  top,
  onApply,
  onApplyLineColor,
  onApplyWidth,
  onClose
}: {
  instance: IndicatorInstance;
  /** Runtime-discovered LINE-type figures for this exact instance (`chart-workbench.tsx`'s `indicatorFigures` map) — one Style row per entry. Empty when the instance has no line figures at all (e.g. `SAR`, circles-only) or figures haven't synced yet. */
  figures: IndicatorLineFigure[];
  left: number;
  top: number;
  onApply: (params: number[]) => void;
  /** Founder bug fix (2026-08-04) — applies a color to exactly ONE line, by its `IndicatorLineFigure.index`. */
  onApplyLineColor?: (lineIndex: number, color: string) => void;
  /** Founder bug fix (2026-08-04) — applies a width to EVERY line of the instance at once (shared control, see module doc). */
  onApplyWidth?: (size: number) => void;
  onClose: () => void;
}) {
  const meta = getIndicatorMeta(instance.name);
  const [draft, setDraft] = useState<number[]>(() => resolveParams(instance));

  if (!meta) return null;

  function setValue(index: number, raw: string) {
    const parsed = Number(raw);
    setDraft((prev) => prev.map((v, i) => (i === index ? (Number.isFinite(parsed) ? parsed : v) : v)));
  }

  function commitAndClose(next: number[]) {
    onApply(clampParams(instance.name, next));
    onClose();
  }

  const anchorRight = left > 320;
  const colorIgnored = COLOR_OVERRIDE_IGNORED_NAMES.has(instance.name);
  // Representative shared width — index 0's stored override if set, else "no explicit width yet" (all lines share whichever default klinecharts renders with, size 1).
  const sharedWidth = figures.length > 0 ? (instance.styles?.lines?.[figures[0].index]?.size ?? null) : null;

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div
        className="absolute z-30 w-64 rounded-xl border border-ink-200 bg-white p-3 shadow-lg"
        style={{ left: anchorRight ? undefined : left, right: anchorRight ? `calc(100vw - ${left}px)` : undefined, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <p className="text-xs font-semibold text-ink-800">{indicatorDisplayName(instance.name)} settings</p>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Close" aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {meta.params.length === 0 ? (
          <p className="py-2 text-xs text-ink-400">No adjustable parameters.</p>
        ) : (
          <div className="space-y-2">
            {meta.params.map((spec, i) => (
              <label key={spec.label} className="flex items-center justify-between gap-2 text-xs text-ink-600">
                <span>{spec.label}</span>
                <input
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step ?? 1}
                  value={draft[i] ?? ""}
                  onChange={(e) => setValue(i, e.target.value)}
                  onBlur={() => setDraft((prev) => prev.map((v, idx) => (idx === i ? Math.min(spec.max, Math.max(spec.min, v)) : v)))}
                  className="w-20 rounded-lg border border-ink-200 px-2 py-1 text-right text-xs text-ink-800 outline-none focus:border-sky-400"
                />
              </label>
            ))}
          </div>
        )}

        {(onApplyLineColor || onApplyWidth) && (
          <div className="mt-3 border-t border-ink-100 pt-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Style</p>

            {figures.length === 0 ? (
              <p className="py-1 text-xs text-ink-400">No adjustable line style for this indicator.</p>
            ) : (
              <div className="space-y-2">
                {figures.map((figure) => {
                  const activeColor = instance.styles?.lines?.[figure.index]?.color;
                  return (
                    <div key={figure.key} className="space-y-1">
                      <p className="text-[11px] font-medium text-ink-500">{figure.label}</p>
                      {colorIgnored ? (
                        <p className="text-[11px] italic text-ink-400">Color follows trend direction — not adjustable.</p>
                      ) : (
                        <ColorPalette
                          activeColor={activeColor}
                          onPick={(color) => onApplyLineColor?.(figure.index, color)}
                          size="sm"
                          align={anchorRight ? "right" : "left"}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {figures.length > 0 && onApplyWidth && (
              <div className="mt-2.5 space-y-1 border-t border-ink-100 pt-2.5">
                <p className="text-[11px] font-medium text-ink-500">Line width (all lines)</p>
                <div className="flex items-center gap-1">
                  {LINE_WIDTHS.map((width) => (
                    <button
                      key={width}
                      type="button"
                      title={`Width ${width}`}
                      aria-label={`Line width ${width}`}
                      aria-pressed={sharedWidth === width}
                      onClick={() => onApplyWidth(width)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        sharedWidth === width ? "ring-2 ring-offset-1 ring-sky-500" : "hover:bg-ink-50"
                      }`}
                    >
                      <span className="w-3.5 rounded-full bg-ink-700" style={{ height: Math.max(1.5, width) }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(meta.defaultParams)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
          <button
            type="button"
            onClick={() => commitAndClose(draft)}
            className="ml-auto rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
