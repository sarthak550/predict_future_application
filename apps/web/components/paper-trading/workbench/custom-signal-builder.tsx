"use client";

/**
 * Founder-feedback pass — the Signals table's THIRD "Custom" section
 * (`signals-table.tsx`): "custom strategy… a '+' button for user to build
 * and customise the parameters and allowing to name these strategies —
 * e.g. see what RSI(20) or Momentum(15) signals." This file owns BOTH the
 * builder popover (opened by the "+" button, or by a row's own "edit"
 * button, pre-filled) and the `pf.workbench.customSignals` localStorage
 * persistence — same "component owns its own storage" pattern
 * `strategy-panel.tsx` already established for `pf.workbench.strategy`
 * (as opposed to `indicator-registry.ts`'s pattern of a separate registry
 * file — either is used elsewhere in this program; co-locating here keeps
 * the builder's own item shape and its storage validation next to each
 * other, since the builder is the only place items are CREATED).
 *
 * Rule/param selection reads `lib/ta/technicals.ts`'s `CUSTOMIZABLE_RULES`
 * catalog directly — the SAME generic evaluators the standard Moving
 * Averages/Oscillators sections already use (see that module's own "Custom
 * section" doc), so nothing about a signal's actual math lives in this file;
 * this component only collects `{ruleId, params, name}` and hands it back
 * to the caller (`chart-workbench.tsx`, which owns the `CustomSignalItem[]`
 * state array and calls `evaluateCustomSignal` to render rows).
 *
 * Popover styling reuses `chart-order-intent-popover.tsx`'s established
 * card look (white, `rounded-2xl`, `border-ink-200`, `shadow-lg`) — but the
 * POSITIONING mechanism is `indicator-settings-popover.tsx`'s
 * `fixed inset-0` click-catcher + `absolute` anchored card (this component
 * can be opened from a "+"/edit button anywhere inside the workbench's
 * scrollable Strategy tab, not a chart-relative click point, so the
 * chart-wrapper-relative `position: absolute` the order-intent popover uses
 * doesn't apply here — `indicator-settings-popover.tsx`'s pattern, already
 * proven for this exact "anchored to a button inside this same scrollable
 * panel" scenario, is the correct precedent to reuse for POSITION). Because
 * this card can be meaningfully taller than the settings popover (a rule
 * select + up to 3 param inputs + a name field + Save/Cancel), it also
 * reuses `tool-flyout.tsx`'s viewport-fit `useLayoutEffect` shift (measure
 * own rendered height, shift up just enough to keep the bottom edge
 * on-screen, clamped at an 8px top margin) — a deliberate combination of
 * two already-vetted precedents, not a new mechanism.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  CUSTOMIZABLE_RULES,
  clampCustomRuleParams,
  defaultCustomRuleParams,
  getCustomizableRule,
  type CustomizableRuleDef
} from "@/lib/ta/technicals";

// ── localStorage — pf.workbench.customSignals {v:1, items:[{id,name,ruleId,params}]} ──

export const CUSTOM_SIGNALS_STORAGE_KEY = "pf.workbench.customSignals";

export interface CustomSignalItem {
  id: string;
  name: string;
  ruleId: string;
  params: number[];
}

const MAX_NAME_LENGTH = 30;

let idCounter = 0;
/** Same shape as `indicator-registry.ts`'s `createInstanceId` — a runtime-only id, fine to regenerate every session (never round-tripped as a stable key beyond this browser's own localStorage). */
export function createCustomSignalId(): string {
  idCounter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `custom__${rand}${idCounter}`;
}

/**
 * Validated restore: an unknown/removed `ruleId` drops the item (never
 * rendered broken, same "unknown name dropped" contract
 * `indicator-registry.ts`'s `migrateStoredSelection` uses); malformed/
 * out-of-range params clamp to the rule's own declared bounds; a blank or
 * corrupt name is dropped too (an unnamed custom signal has nothing useful
 * to show in the table).
 */
export function loadStoredCustomSignals(): CustomSignalItem[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_SIGNALS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || !Array.isArray(p.items)) return [];
    const out: CustomSignalItem[] = [];
    for (const raw of p.items as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.ruleId !== "string" || !Array.isArray(item.params)) continue;
      const def = getCustomizableRule(item.ruleId);
      if (!def) continue; // unknown/removed rule id — dropped, not rendered broken.
      const rawParams = item.params as unknown[];
      const params = rawParams.every((n) => typeof n === "number") ? clampCustomRuleParams(def, rawParams as number[]) : defaultCustomRuleParams(def);
      const name = item.name.trim().slice(0, MAX_NAME_LENGTH);
      if (name.length === 0) continue;
      out.push({ id: item.id, name, ruleId: item.ruleId, params });
    }
    return out;
  } catch {
    return []; // private mode / storage disabled / corrupt value.
  }
}

export function saveStoredCustomSignals(items: readonly CustomSignalItem[]): void {
  try {
    window.localStorage.setItem(CUSTOM_SIGNALS_STORAGE_KEY, JSON.stringify({ v: 1, items }));
  } catch {
    // Preference just won't survive the refresh.
  }
}

// ── The builder popover ──────────────────────────────────────────────────

export function CustomSignalBuilder({
  anchorRect,
  editingItem,
  onSave,
  onClose
}: {
  /** The trigger button's own `getBoundingClientRect()`, captured by the caller at click time — same contract as `indicator-active-strip.tsx`'s `onOpenSettings` anchor. */
  anchorRect: { left: number; top: number };
  /** `null` for "add new" (starts from the first catalog rule's own defaults); an existing item for "edit" (reopens pre-filled, same `id` on save — see `signals-table.tsx`'s edit button). */
  editingItem: CustomSignalItem | null;
  onSave: (item: CustomSignalItem) => void;
  onClose: () => void;
}) {
  const initialDef = getCustomizableRule(editingItem?.ruleId ?? "") ?? CUSTOMIZABLE_RULES[0];
  const [ruleId, setRuleId] = useState(initialDef.id);
  const [params, setParams] = useState<number[]>(() => (editingItem && editingItem.ruleId === initialDef.id ? editingItem.params : defaultCustomRuleParams(initialDef)));
  const [name, setName] = useState(() => editingItem?.name ?? initialDef.buildLabel(defaultCustomRuleParams(initialDef)));
  // Once the user has typed into the name field directly, auto-naming stops overwriting it on every
  // rule/param change — an editing session for an EXISTING item starts already "touched" (its name is
  // presumably deliberate, e.g. "My swing RSI"), never silently renamed back to the bare auto-label.
  const [nameTouched, setNameTouched] = useState(editingItem !== null);

  const def: CustomizableRuleDef = getCustomizableRule(ruleId) ?? CUSTOMIZABLE_RULES[0];

  function handleRuleChange(nextRuleId: string) {
    const nextDef = getCustomizableRule(nextRuleId) ?? CUSTOMIZABLE_RULES[0];
    setRuleId(nextDef.id);
    const nextParams = defaultCustomRuleParams(nextDef);
    setParams(nextParams);
    if (!nameTouched) setName(nextDef.buildLabel(nextParams));
  }

  function handleParamChange(index: number, raw: string) {
    const parsed = Number(raw);
    const next = params.map((v, i) => (i === index ? (Number.isFinite(parsed) ? parsed : v) : v));
    setParams(next);
    if (!nameTouched) setName(def.buildLabel(next));
  }

  function handleParamBlur(index: number) {
    setParams((prev) => {
      const spec = def.params[index];
      if (!spec) return prev;
      const next = prev.map((v, i) => (i === index ? Math.min(spec.max, Math.max(spec.min, v)) : v));
      if (!nameTouched) setName(def.buildLabel(next));
      return next;
    });
  }

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;

  function handleSave() {
    if (!canSave) return;
    const clamped = clampCustomRuleParams(def, params);
    onSave({ id: editingItem?.id ?? createCustomSignalId(), name: trimmedName, ruleId: def.id, params: clamped });
  }

  // ── Positioning: fixed inset-0 catcher + absolute anchored card
  // (indicator-settings-popover.tsx's own pattern) + a viewport-fit vertical
  // shift (tool-flyout.tsx's own mechanism) — see module doc. ─────────────
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [topShift, setTopShift] = useState(0);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportBottom = window.innerHeight - 8;
    const overflow = anchorRect.top + rect.height - viewportBottom;
    if (overflow <= 0) {
      setTopShift(0);
      return;
    }
    const maxShiftUp = Math.max(0, anchorRect.top - 8);
    setTopShift(-Math.min(overflow, maxShiftUp));
    // Re-measure whenever the rendered content's own height could change (rule swap changes the param
    // input count).
  }, [anchorRect, ruleId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const anchorRight = anchorRect.left > 320;

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div
        ref={cardRef}
        role="dialog"
        aria-label={editingItem ? "Edit custom signal" : "Build a custom signal"}
        className="absolute z-30 w-72 rounded-2xl border border-ink-200 bg-white p-3 shadow-lg"
        style={{
          left: anchorRight ? undefined : anchorRect.left,
          right: anchorRight ? `calc(100vw - ${anchorRect.left}px)` : undefined,
          top: anchorRect.top + topShift
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <p className="text-xs font-semibold text-ink-800">{editingItem ? "Edit custom signal" : "Build a custom signal"}</p>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Close" aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <label className="mb-2 block text-xs text-ink-600">
          <span className="mb-1 block">Rule</span>
          <select
            value={ruleId}
            onChange={(e) => handleRuleChange(e.target.value)}
            className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm text-ink-800 outline-none focus:border-sky-400"
          >
            {CUSTOMIZABLE_RULES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-2 grid grid-cols-2 gap-2">
          {def.params.map((spec, i) => (
            <label key={spec.key} className="text-xs text-ink-600">
              <span className="mb-1 block">{spec.label}</span>
              <input
                type="number"
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                value={params[i] ?? spec.default}
                onChange={(e) => handleParamChange(i, e.target.value)}
                onBlur={() => handleParamBlur(i)}
                className="w-full rounded-lg border border-ink-200 px-2 py-1 text-right text-xs text-ink-800 outline-none focus:border-sky-400"
              />
            </label>
          ))}
        </div>

        <label className="mb-3 block text-xs text-ink-600">
          <span className="mb-1 block">Name</span>
          <input
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            placeholder={def.buildLabel(params)}
            className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm text-ink-800 outline-none focus:border-sky-400"
          />
        </label>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-ink-200 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 rounded-lg bg-sky-600 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
