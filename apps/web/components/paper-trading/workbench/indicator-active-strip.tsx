"use client";

/**
 * TA Suite Sprint S2, T1/T4 — one row per active indicator INSTANCE (not
 * per name — see `indicator-registry.ts`'s multi-instance model doc), e.g.
 * two independent `MA (9) ⚙ ✕` / `MA (21) ⚙ ✕` rows. Gear opens the T4
 * settings popover (anchored to that row via `onOpenSettings`, which passes
 * the row's own bounding rect up so the popover can position itself
 * without this component needing to know anything about popover geometry);
 * ✕ removes that specific instance.
 *
 * **Founder-feedback pass (2026-08-03) PART A** — "we just get the
 * indicator plots without any other information": each row now ALSO shows
 * `lib/ta/indicator-signals.ts`'s latest computed value (always) and a
 * plain-language, state-colored chip (only when that indicator has a real
 * reading convention — the honesty law, see that module's own doc). This
 * component stays purely presentational — `signals` is a pre-computed
 * `instanceId → IndicatorSignal` map built by `chart-workbench.tsx` (the
 * owner of both the candle array and the instance list), same "compute in
 * the parent, render in the child" split this program already uses for
 * `drawingsHook`/`strategyRunResult`.
 */
import { Plus, Settings2, X } from "lucide-react";

import { formatInstanceLabel, type IndicatorInstance , indicatorDisplayName } from "./indicator-registry";
import type { IndicatorSignal, SignalState } from "@/lib/ta/indicator-signals";
import { SignalReasonTrigger } from "./signal-reason-trigger";

/** State-colored subtle chips, per the brief's exact palette (`emerald bullish/up, rose bearish/down, amber OB/OS, ink neutral`) — `strong`/`weak` (ADX's own trend-strength read, not covered by that 4-color list) get a sensible ink-family extension: `strong` inverted/bold for emphasis, `weak` muted. */
const STATE_CHIP_CLASS: Record<Exclude<SignalState, null>, string> = {
  bullish: "bg-emerald-50 text-emerald-700",
  bearish: "bg-rose-50 text-rose-700",
  overbought: "bg-amber-50 text-amber-700",
  oversold: "bg-amber-50 text-amber-700",
  neutral: "bg-ink-100 text-ink-500",
  strong: "bg-ink-700 text-white",
  weak: "bg-ink-100 text-ink-400"
};

export function IndicatorActiveStrip({
  instances,
  signals,
  onOpenSettings,
  onRemove,
  onOpenDialog
}: {
  instances: IndicatorInstance[];
  /** `instanceId -> IndicatorSignal`, pre-computed by the parent over the currently-loaded candles — see module doc. */
  signals: ReadonlyMap<string, IndicatorSignal>;
  onOpenSettings: (instance: IndicatorInstance, anchor: { left: number; top: number }) => void;
  onRemove: (instanceId: string) => void;
  onOpenDialog: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {instances.map((instance) => {
        const signal = signals.get(instance.instanceId);
        return (
          <div key={instance.instanceId} className="flex items-center gap-1 rounded-lg bg-ink-100 py-1 pl-2.5 pr-1 text-xs font-medium text-ink-700">
            <div className="flex flex-col leading-tight">
              <div className="flex items-center gap-1.5">
                <span>{formatInstanceLabel(instance)}</span>
                {signal?.state &&
                  (signal.reason ? (
                    <SignalReasonTrigger reason={signal.reason}>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${STATE_CHIP_CLASS[signal.state]}`}>
                        {signal.stateText ?? signal.state}
                      </span>
                    </SignalReasonTrigger>
                  ) : (
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${STATE_CHIP_CLASS[signal.state]}`}>
                      {signal.stateText ?? signal.state}
                    </span>
                  ))}
              </div>
              {signal && signal.valueText !== "—" && <span className="tabular-nums text-[10px] font-normal text-ink-500">{signal.valueText}</span>}
            </div>
            <button
              type="button"
              title="Settings"
              aria-label={`${indicatorDisplayName(instance.name)} settings`}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onOpenSettings(instance, { left: rect.left, top: rect.bottom + 4 });
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-200 hover:text-ink-700"
            >
              <Settings2 className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Remove"
              aria-label={`Remove ${indicatorDisplayName(instance.name)}`}
              onClick={() => onRemove(instance.instanceId)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-rose-100 hover:text-rose-600"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onOpenDialog}
        title="Add indicator"
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Indicators
      </button>
    </div>
  );
}
