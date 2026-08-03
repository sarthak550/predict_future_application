"use client";

/**
 * Founder-feedback pass (2026-08-04) — "color choices are very less": the
 * S1/S2 style editors both shipped with a hardcoded 6-swatch row
 * (`figure-kit.ts`'s `SWATCH_COLORS`). This is the shared replacement, wired
 * into BOTH `drawing-style-toolbar.tsx` (per-drawing style) and
 * `indicator-settings-popover.tsx` (per-line indicator style) — one
 * component, one palette, so the two surfaces can never visually drift.
 *
 * **The grid — TradingView-style, 6 hues × 4 shades = 24 swatches.** Hues
 * are columns, shades are rows (light at the top, dark at the bottom),
 * matching TradingView's own picker layout. Colors are the real Tailwind
 * default palette's `300/500/700/900` steps for `slate/blue/sky/emerald/
 * amber/rose` — deliberately NOT this app's `ink`/`signal` custom tokens
 * (`tailwind.config.ts`), because `ink` only has ONE usable hue (slate-ish
 * grays) and `signal` only has 4 total colors; six full hue families are
 * needed to hit the brief's "TradingView-style grid" bar. Two of the six
 * (`sky-500` = `#0ea5e9`, `amber-500` = `#f59e0b`) are exact matches for
 * this app's own `signal.sky`/`signal.amber` tokens and `blue` anchors the
 * app's "Indigo Futures" accent family (`project_design_direction_indigo_
 * futures` — accent tuned to `#2563EB`, i.e. `blue-700`-ish) — the grid was
 * chosen to feel native to this app's existing brand, not generic.
 *
 * **Custom color** — a native `<input type="color">`, labeled, styled to
 * match the swatch grid's touch-target size (cross-browser via the
 * `::-webkit-color-swatch*` pseudo-elements; Firefox's unstyled native
 * swatch already renders as a plain color square, close enough). Picking a
 * custom color applies INSTANTLY on `onChange` — same "every pick applies
 * immediately, no separate confirm" contract every palette swatch button
 * already uses.
 *
 * **Trigger + flyout, siblings not nested** — same bug this program already
 * hit once (`project_ta_suite_founder_feedback_2026_08_03`: "flyout-nested-
 * button-bubbling… button+flyout must be SIBLINGS, not parent/child").
 * `open`/outside-dismiss is self-contained here (a `mousedown`-capture
 * document listener + Escape), so this component drops into either caller
 * (a horizontal toolbar bar, a narrow `w-64` settings popover) without that
 * caller needing to own any dismiss wiring of its own.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/** One hue family's 4 shades, light → dark (`300/500/700/900`). */
interface PaletteHue {
  label: string;
  shades: readonly [string, string, string, string];
}

/** The real Tailwind CSS default palette's own hex values — verified against Tailwind's published default color scale, not approximated. */
export const PALETTE_HUES: readonly PaletteHue[] = [
  { label: "Slate", shades: ["#cbd5e1", "#64748b", "#334155", "#0f172a"] },
  { label: "Blue", shades: ["#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"] },
  { label: "Sky", shades: ["#7dd3fc", "#0ea5e9", "#0369a1", "#0c4a6e"] },
  { label: "Emerald", shades: ["#6ee7b7", "#10b981", "#047857", "#064e3b"] },
  { label: "Amber", shades: ["#fcd34d", "#f59e0b", "#b45309", "#78350f"] },
  { label: "Rose", shades: ["#fda4af", "#f43f5e", "#be123c", "#881337"] }
];

/** Flat 24-entry list — kept for anything that just wants "a palette color", not the grid shape. */
export const PALETTE_COLORS: readonly string[] = PALETTE_HUES.flatMap((hue) => hue.shades);

const SHADE_LABELS = ["300", "500", "700", "900"] as const;

export function ColorPalette({
  activeColor,
  onPick,
  size = "md",
  align = "left"
}: {
  activeColor?: string | null;
  onPick: (color: string) => void;
  /** `"md"` = 32px swatches (the S1 toolbar's original a11y floor) for the docked drawing-style bar; `"sm"` = 24px for the narrow `w-64` indicator settings popover — still clears the brief's "≥24px touch target" floor. */
  size?: "md" | "sm";
  /** Which side the flyout grows from — callers near the right edge of their container pass `"right"` so the grid never runs off-screen. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const triggerDim = size === "md" ? "h-8 w-8" : "h-6 w-6";
  const triggerDot = size === "md" ? "h-4 w-4" : "h-3 w-3";
  const swatchDim = size === "md" ? "h-8 w-8" : "h-6 w-6";
  const swatchDot = size === "md" ? "h-4 w-4" : "h-3 w-3";

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Color"
        aria-label={`Color, currently ${activeColor ?? "unset"}`}
        className={`flex ${triggerDim} items-center justify-center gap-0.5 rounded-lg border border-ink-200 px-0.5 hover:bg-ink-50`}
      >
        <span className={`${triggerDot} shrink-0 rounded-full`} style={{ backgroundColor: activeColor ?? "#94a3b8" }} />
        <ChevronDown className="h-2.5 w-2.5 shrink-0 text-ink-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 w-max rounded-xl border border-ink-200 bg-white p-2 shadow-lg"
          style={{ [align === "right" ? "right" : "left"]: 0, top: "100%" }}
        >
          <div className="grid grid-flow-col grid-rows-4 gap-1">
            {PALETTE_HUES.map((hue) =>
              hue.shades.map((color, shadeIndex) => (
                <button
                  key={color}
                  type="button"
                  title={`${hue.label} ${SHADE_LABELS[shadeIndex]} · ${color}`}
                  aria-label={`Color ${hue.label} ${SHADE_LABELS[shadeIndex]}`}
                  aria-pressed={activeColor === color}
                  onClick={() => {
                    onPick(color);
                    setOpen(false);
                  }}
                  className={`flex ${swatchDim} items-center justify-center rounded-lg ${
                    activeColor === color ? "ring-2 ring-offset-1 ring-sky-500" : "hover:bg-ink-50"
                  }`}
                >
                  <span className={`${swatchDot} rounded-full`} style={{ backgroundColor: color }} />
                </button>
              ))
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 border-t border-ink-100 pt-1.5">
            <label className="flex items-center gap-1.5">
              <input
                type="color"
                aria-label="Custom color"
                value={/^#[0-9a-fA-F]{6}$/.test(activeColor ?? "") ? (activeColor as string) : "#334155"}
                onChange={(e) => onPick(e.target.value)}
                className={`${swatchDim} shrink-0 cursor-pointer rounded-lg border border-ink-200 p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0`}
              />
              <span className="text-[11px] font-medium text-ink-500">Custom</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
