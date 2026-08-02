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
 */
import { useState } from "react";
import { RotateCcw, X } from "lucide-react";

import { clampParams, getIndicatorMeta, resolveParams, type IndicatorInstance } from "./indicator-registry";

export function IndicatorSettingsPopover({
  instance,
  left,
  top,
  onApply,
  onClose
}: {
  instance: IndicatorInstance;
  left: number;
  top: number;
  onApply: (params: number[]) => void;
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
