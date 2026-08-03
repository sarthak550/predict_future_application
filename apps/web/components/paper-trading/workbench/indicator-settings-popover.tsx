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
 * **Founder feedback (2026-08-04), Part 1 — the STYLE section.** Reuses the
 * exact same 6-swatch/3-width `DrawingStyleToolbar` constants
 * (`SWATCH_COLORS`/`LINE_WIDTHS` from `overlays/figure-kit.ts`) and instant-
 * apply UX for visual consistency with the drawings style editor. Applied
 * UNIFORMLY to every line-type figure of the instance, not independently
 * per sub-line — a deliberate, documented scope decision, not an oversight:
 * `overrideIndicator({styles:{lines:[...]}})`'s real merge semantics
 * (verified against `dist/index.esm.js`'s `eachFigures`, ~line 3066) REPLACE
 * the whole `lines[]` array wholesale (`formatValue(styles, 'lines',
 * defaultStyles.lines)` — `styles?.lines ?? defaultStyles.lines`, no
 * per-index deep-merge with the built-in default), and each line-type
 * figure resolves its style via `lineStyles[lineCount % lineStyleCount]` —
 * a MODULO, not a direct index. Submitting a single-element `lines` array
 * therefore makes `lineCount % 1 === 0` for every line figure, so EVERY
 * line in the instance resolves to that SAME one style object — the exact
 * mechanic this section exploits for a correct, general "uniform recolor"
 * with zero per-indicator figure-count metadata needed (an independent
 * per-sub-line color picker would need a verified line-count for all 27
 * built-ins + 14 customs — a larger follow-up, not done this pass). One
 * real, flagged interaction: `SUPERTREND`'s own line figure has a `styles`
 * callback that UNCONDITIONALLY returns a trend-based `color` (green/red
 * flip) — per the SAME merge order, the figure's own returned style wins
 * per-key over this override, so a picked COLOR is a silent no-op for
 * SUPERTREND specifically (by design — the flip color IS the indicator's
 * signal) while WIDTH still applies (`ss` only ever returns `color`).
 */
import { useState } from "react";
import { RotateCcw, X } from "lucide-react";

import { clampParams, getIndicatorMeta, resolveParams, type IndicatorInstance } from "./indicator-registry";
import { SWATCH_COLORS, LINE_WIDTHS } from "./overlays/figure-kit";

export function IndicatorSettingsPopover({
  instance,
  left,
  top,
  onApply,
  onApplyStyle,
  onClose
}: {
  instance: IndicatorInstance;
  left: number;
  top: number;
  onApply: (params: number[]) => void;
  /** Founder feedback (2026-08-04) — the STYLE section's instant-apply callback; see module doc for the uniform-across-lines scope. */
  onApplyStyle?: (styles: { color?: string; size?: number }) => void;
  onClose: () => void;
}) {
  const meta = getIndicatorMeta(instance.name);
  const [draft, setDraft] = useState<number[]>(() => resolveParams(instance));
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [activeWidth, setActiveWidth] = useState<number | null>(null);

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

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div
        className="absolute z-30 w-56 rounded-xl border border-ink-200 bg-white p-3 shadow-lg"
        style={{ left: anchorRight ? undefined : left, right: anchorRight ? `calc(100vw - ${left}px)` : undefined, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <p className="text-xs font-semibold text-ink-800">{instance.name} settings</p>
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

        {onApplyStyle && (
          <div className="mt-3 border-t border-ink-100 pt-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Style</p>
            <div className="flex items-center gap-1">
              {SWATCH_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  aria-label={`Color ${color}`}
                  aria-pressed={activeColor === color}
                  onClick={() => {
                    setActiveColor(color);
                    // Sent as the FULL merged {color, size} pair (not just the just-clicked field) — `overrideIndicator`'s
                    // `styles.lines` REPLACES the whole array wholesale (see module doc), so a color-only patch here would
                    // silently drop a previously-applied width, and vice versa below.
                    onApplyStyle({ color, size: activeWidth ?? undefined });
                  }}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${activeColor === color ? "ring-2 ring-offset-1 ring-sky-500" : "hover:bg-ink-50"}`}
                >
                  <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              {LINE_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  title={`Width ${width}`}
                  aria-label={`Line width ${width}`}
                  aria-pressed={activeWidth === width}
                  onClick={() => {
                    setActiveWidth(width);
                    onApplyStyle({ color: activeColor ?? undefined, size: width });
                  }}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${activeWidth === width ? "ring-2 ring-offset-1 ring-sky-500" : "hover:bg-ink-50"}`}
                >
                  <span className="w-3.5 rounded-full bg-ink-700" style={{ height: Math.max(1.5, width) }} />
                </button>
              ))}
            </div>
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
