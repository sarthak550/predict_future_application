"use client";

/**
 * TA Suite Sprint S2, T1/T4 — one row per active indicator INSTANCE (not
 * per name — see `indicator-registry.ts`'s multi-instance model doc), e.g.
 * two independent `MA (9) ⚙ ✕` / `MA (21) ⚙ ✕` rows. Gear opens the T4
 * settings popover (anchored to that row via `onOpenSettings`, which passes
 * the row's own bounding rect up so the popover can position itself
 * without this component needing to know anything about popover geometry);
 * ✕ removes that specific instance.
 */
import { Plus, Settings2, X } from "lucide-react";

import { formatInstanceLabel, type IndicatorInstance } from "./indicator-registry";

export function IndicatorActiveStrip({
  instances,
  onOpenSettings,
  onRemove,
  onOpenDialog
}: {
  instances: IndicatorInstance[];
  onOpenSettings: (instance: IndicatorInstance, anchor: { left: number; top: number }) => void;
  onRemove: (instanceId: string) => void;
  onOpenDialog: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {instances.map((instance) => (
        <div key={instance.instanceId} className="flex items-center gap-1 rounded-lg bg-ink-100 py-1 pl-2.5 pr-1 text-xs font-medium text-ink-700">
          <span>{formatInstanceLabel(instance)}</span>
          <button
            type="button"
            title="Settings"
            aria-label={`${instance.name} settings`}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenSettings(instance, { left: rect.left, top: rect.bottom + 4 });
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-ink-200 hover:text-ink-700"
          >
            <Settings2 className="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${instance.name}`}
            onClick={() => onRemove(instance.instanceId)}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-rose-100 hover:text-rose-600"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ))}
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
