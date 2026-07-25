"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T4) — sticky header strip: spot +
 * day change (sourced from PriceChart's own onQuoteChange callback — no
 * second fetch, per the brief), account cash, today's trading P&L, total
 * (lifetime) net P&L.
 *
 * Pure presentation — reads props only, no data fetching, no business logic.
 *
 * DEVIATION FROM THE BRIEF'S LITERAL "day P&L": labeled "Today's trading P&L"
 * instead. True mark-to-market day P&L needs a start-of-day position snapshot
 * this engine has never captured (no such column/table exists, and the
 * engine is untouchable this sprint) — this reads as "the P&L impact of every
 * order placed today," a narrower but honestly-computable and honestly-named
 * metric (see queries.ts's getAccountDetail for the exact derivation). Same
 * "don't show a number you can't stand behind" ethos as the rest of this
 * product's cost-breakdown copy.
 */
import type { ReactNode } from "react";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export interface TerminalSpotQuote {
  price: number;
  changeAbs: number;
  changePct: number;
}

export function TerminalHeader({
  title,
  spot,
  cash,
  todayPnl,
  totalPnl,
  navSlot
}: {
  /** e.g. "RELIANCE" (equity terminal) or "NIFTY 24700 CE" (options terminal, once a contract is selected). */
  title: string;
  spot: TerminalSpotQuote | null;
  cash: number;
  /** Null while the account's order history hasn't loaded yet — renders a placeholder, never a fabricated 0. */
  todayPnl: number | null;
  totalPnl: number;
  /** Back link / Options-Equity cross-nav, "Calls I've traded", reset — kept out of this component's own concerns, just a slot. */
  navSlot?: ReactNode;
}) {
  const spotTone = spot ? (spot.changeAbs >= 0 ? "text-emerald-600" : "text-rose-600") : "text-ink-400";

  return (
    <div className="sticky top-0 z-20 -mx-1 rounded-[24px] border border-ink-100 bg-white/90 px-5 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">{title || "Select a symbol"}</p>
            {spot ? (
              <p className="mt-0.5 flex items-baseline gap-2">
                <span className="text-lg font-semibold text-ink-900">{formatRupees(spot.price)}</span>
                <span className={`text-sm font-medium ${spotTone}`}>
                  {spot.changeAbs >= 0 ? "+" : ""}
                  {formatRupees(spot.changeAbs)} ({spot.changePct >= 0 ? "+" : ""}
                  {spot.changePct.toFixed(2)}%)
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-ink-400">—</p>
            )}
          </div>

          <HeaderStat label="Cash" value={formatRupees(cash)} />
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

        <div className="flex flex-wrap items-center gap-3">
          {navSlot}
        </div>
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
