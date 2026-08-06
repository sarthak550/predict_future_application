/**
 * TradingView-grade Strategy Results UI — shared formatting helpers for the
 * four new sub-components in this folder (`equity-curve-chart.tsx`,
 * `overview-tab.tsx`, `performance-tab.tsx`, `trades-tab.tsx`). Deliberately
 * a SEPARATE small module rather than importing `strategy-panel.tsx`'s own
 * module-private `formatRupees`/`formatPct` — this house's own convention
 * (see `kline-chart.tsx`/`order-line-overlay.ts`, each with their own
 * module-local `formatRupees`) is small, module-scoped formatters over one
 * shared cross-cutting util; this folder's four files share these, but
 * `strategy-panel.tsx` itself keeps its own (used only by its no-signals
 * empty state and the footer scope note, neither of which moved here).
 */

/** ₹ figure, sign-prefixed (`-₹1,234` not `₹-1,234`), zero decimal places — matches the house's existing money convention across this codebase. */
export function formatRupees(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Percent figure, 2 decimal places, explicit `+` on positive (never on zero or negative — `-` already reads as negative). */
export function formatPct(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

/** A pure ratio (e.g. avg win/loss ratio) — 2 decimal places, no sign/unit decoration; these are always non-negative magnitudes per `backtest.ts`'s own SIGN LAW. */
export function formatRatio(v: number): string {
  return v.toFixed(2);
}

/** `null`/`undefined` render as an em dash — the ONE place this folder spells "undefined", so no sub-component invents its own placeholder string. */
export function formatOrDash(v: string | number | null | undefined, fmt?: (v: number) => string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return fmt ? fmt(v) : String(v);
  return v;
}

/**
 * Bar timestamp -> short IST label. `interval === "1d"` renders a bare date
 * (`"07 Aug '26"`); any intraday interval also renders the time (`"07 Aug,
 * 14:30"`) since same-day bars would otherwise be indistinguishable —
 * matches the house's existing `Intl.DateTimeFormat("en-IN", …, timeZone:
 * "Asia/Kolkata")` convention (`chart-workbench.tsx`, `heartbeat-chip.tsx`).
 */
export function formatBarTimestamp(ts: number, interval: string): string {
  if (interval === "1d") {
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(ts));
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(new Date(ts));
}
