"use client";

/**
 * Charting Workbench (W2, T2) — indicator picker: MA/EMA/BOLL toggle onto
 * the main candle pane (multiple can be active at once — they overlay the
 * price series, no pane budget to protect), VOL/MACD/RSI each get their OWN
 * sub-pane, capped at 2 concurrent sub-panes.
 *
 * Policy decision on a 3rd sub-pane pick (founder plan explicitly defers
 * this choice to the component, "pick whichever is less surprising"): this
 * component REJECTS the 3rd pick (disables its own toggle with an
 * explanatory title) rather than silently evicting whichever sub-pane
 * indicator the user added first. Reasoning: an indicator a user
 * deliberately turned on disappearing WITHOUT them touching it is a more
 * surprising, harder-to-notice-why UI event than a disabled button they can
 * see and understand immediately (works the same way a "max 5 tabs" browser
 * extension typically disables the "new tab" affordance rather than closing
 * an old tab out from under you).
 *
 * Pure controlled UI — no klinecharts import here at all. Selection state
 * is owned by chart-workbench.tsx and handed to kline-chart.tsx as
 * `mainIndicators`/`subIndicators` string arrays; this component only reads
 * the current selection and calls `onChange`.
 *
 * W3, T5 — `mode: "spot" | "premium"` gates the VOL toggle: option premium
 * snapshots carry no real traded-volume figure, so offering a volume
 * overlay in premium mode would be fabricated data. An additive optional
 * prop (default `"spot"`) rather than a second component, per the brief's
 * explicit "don't duplicate the picker" instruction — the other 5
 * indicators (MA/EMA/BOLL/MACD/RSI) are unaffected in either mode. Also
 * sanitizes a restored `localStorage` selection: a prior SPOT session's
 * saved `sub` array may contain `"VOL"`, which must never silently reach
 * `kline-chart.tsx`'s `createIndicator({name:"VOL"})` call while this
 * instance is in premium mode, even though the toggle button itself is
 * disabled.
 */
import { useEffect } from "react";

const MAIN_PANE_INDICATORS = ["MA", "EMA", "BOLL"] as const;
const SUB_PANE_INDICATORS = ["VOL", "MACD", "RSI"] as const;
const MAX_SUB_PANES = 2;

const STORAGE_KEY = "pf.workbench.indicators";

export interface IndicatorSelection {
  main: string[];
  sub: string[];
}

function isValidSelection(v: unknown): v is IndicatorSelection {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<IndicatorSelection>;
  return (
    Array.isArray(s.main) &&
    s.main.every((n) => (MAIN_PANE_INDICATORS as readonly string[]).includes(n)) &&
    Array.isArray(s.sub) &&
    s.sub.every((n) => (SUB_PANE_INDICATORS as readonly string[]).includes(n)) &&
    s.sub.length <= MAX_SUB_PANES
  );
}

export function IndicatorPicker({
  selection,
  onChange,
  mode = "spot"
}: {
  selection: IndicatorSelection;
  onChange: (next: IndicatorSelection) => void;
  mode?: "spot" | "premium";
}) {
  // Restore once, after mount (same localStorage-after-hydration posture as
  // timeframe-selector.tsx). Strips a stale "VOL" pick when restoring into a
  // premium-mode instance — see module doc.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isValidSelection(parsed)) {
          onChange(mode === "premium" ? { ...parsed, sub: parsed.sub.filter((n) => n !== "VOL") } : parsed);
        }
      }
    } catch {
      // Private mode / storage disabled / corrupt value — keep the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(next: IndicatorSelection) {
    onChange(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preference just won't survive the refresh.
    }
  }

  function toggleMain(name: string) {
    const active = selection.main.includes(name);
    persist({ ...selection, main: active ? selection.main.filter((n) => n !== name) : [...selection.main, name] });
  }

  function toggleSub(name: string) {
    if (mode === "premium" && name === "VOL") return; // disabled in premium mode — see module doc.
    const active = selection.sub.includes(name);
    if (active) {
      persist({ ...selection, sub: selection.sub.filter((n) => n !== name) });
      return;
    }
    if (selection.sub.length >= MAX_SUB_PANES) return; // rejected — see module doc.
    persist({ ...selection, sub: [...selection.sub, name] });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {MAIN_PANE_INDICATORS.map((name) => (
        <IndicatorChip key={name} label={name} active={selection.main.includes(name)} onClick={() => toggleMain(name)} />
      ))}
      <span className="mx-1 h-4 w-px bg-ink-200" aria-hidden="true" />
      {SUB_PANE_INDICATORS.map((name) => {
        const volDisabledForMode = mode === "premium" && name === "VOL";
        const active = selection.sub.includes(name);
        const disabled = volDisabledForMode || (!active && selection.sub.length >= MAX_SUB_PANES);
        const title = volDisabledForMode
          ? "Volume isn't available for option premium data"
          : disabled
            ? "Remove a sub-pane indicator first (max 2 at once)"
            : undefined;
        return <IndicatorChip key={name} label={name} active={active} disabled={disabled} title={title} onClick={() => toggleSub(name)} />;
      })}
    </div>
  );
}

function IndicatorChip({
  label,
  active,
  disabled,
  title,
  onClick
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100"
      }`}
    >
      {label}
    </button>
  );
}

export const WORKBENCH_MAIN_INDICATORS = MAIN_PANE_INDICATORS;
export const WORKBENCH_SUB_INDICATORS = SUB_PANE_INDICATORS;
export const WORKBENCH_MAX_SUB_PANES = MAX_SUB_PANES;
