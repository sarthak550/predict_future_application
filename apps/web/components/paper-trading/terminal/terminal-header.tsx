"use client";

/**
 * Trading Terminal — sticky account header strip: cash available, portfolio
 * value, today's trading P&L, total (lifetime) net P&L. Founder call
 * 2026-07-25: NO symbol/spot here — the chart card below already names and
 * prices the focused symbol, and duplicating it wasted the strip's space.
 *
 * Pure presentation — reads props only, no data fetching, no business logic.
 *
 * "Today's trading P&L" (not "day P&L"): true mark-to-market day P&L needs a
 * start-of-day position snapshot this engine has never captured — this reads
 * as "the P&L impact of every order placed today," a narrower but
 * honestly-computable and honestly-named metric (see queries.ts's
 * getAccountDetail for the exact derivation).
 */
import type { ReactNode } from "react";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function TerminalHeader({
  cash,
  portfolioValue,
  todayPnl,
  totalPnl,
  navSlot
}: {
  cash: number;
  /** Cash + holdings marked at the latest delayed prices — the account's total worth right now. */
  portfolioValue: number;
  /** Null while the account's order history hasn't loaded yet — renders a placeholder, never a fabricated 0. */
  todayPnl: number | null;
  totalPnl: number;
  /** Cross-nav, "Calls I've traded", reset — kept out of this component's own concerns, just a slot. */
  navSlot?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-1 rounded-[24px] border border-ink-100 bg-white/90 px-5 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        {/* Full-width 4-up grid — the stats own the whole strip instead of huddling left. */}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <HeaderStat label="Cash available" value={formatRupees(cash)} />
          <HeaderStat label="Portfolio value" value={formatRupees(portfolioValue)} />
          <HeaderStat
            label="Today's trading P&L"
            value={todayPnl != null ? formatSignedRupees(todayPnl) : "—"}
            tone={todayPnl != null ? (todayPnl > 0 ? "up" : todayPnl < 0 ? "down" : undefined) : undefined}
          />
          <HeaderStat
            label="Total net P&L"
            value={formatSignedRupees(totalPnl)}
            tone={totalPnl > 0 ? "up" : totalPnl < 0 ? "down" : undefined}
          />
        </div>

        {navSlot && <div className="flex flex-wrap items-center gap-3">{navSlot}</div>}
      </div>
    </div>
  );
}

function HeaderStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-ink-900"}`}>
        {value}
      </p>
    </div>
  );
}
