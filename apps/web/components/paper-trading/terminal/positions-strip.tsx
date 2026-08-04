"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T4 chrome / T8 wiring) — bottom-
 * pinned horizontal strip: one chip per open position, equity and option
 * mixed in one continuous bar (per the brief: "a mixed equity+option account
 * should show one continuous bar, not two separate ones per page").
 *
 * Tap → Sell, reusing the EXACT deep-link contracts already read elsewhere:
 *   - Option: `?underlying=&expiry=&strike=&optionType=&side=SELL` — the same
 *     shape options-page-client.tsx's OptionPositionsTable already builds
 *     (shipped 2026-07-25), unchanged here.
 *   - Equity: `?symbol=&side=SELL&productType=&quantity=` — GENERALIZED here
 *     for the first time into an actual UI link. paper-trading-dashboard.tsx
 *     already READS these params (via useSearchParams, pre-dating this
 *     brief) but no surface previously WROTE this link for an equity holding
 *     — this strip is that surface. `quantity` (Delivery-holdings Sell
 *     button, 2026-08-04) mirrors the same param the dashboard's own
 *     holdings-table Sell links now send, defaulting the ticket to the
 *     chip's full held size.
 *
 *     NOTE: as of 2026-08-04, neither options-page-client.tsx nor
 *     futures-page-client.tsx actually constructs an `EquityPositionChip` —
 *     both fetch `deliveryHoldings`/`openIntradayPositions` into their
 *     account state but only ever map option/futures positions into
 *     `positionChips`. This equity branch is kept correct and consistent for
 *     whenever that gets wired up, but it isn't reachable in the running app
 *     today — flagged separately, not fixed here (out of scope: it's "no
 *     equity holdings shown here at all" rather than "shown without a Sell
 *     action").
 *
 * Pure presentation — no data fetching. Receives already-derived equity +
 * option position rows from the account payload both terminal pages already
 * poll every 60s (use-visible-polling.ts, paused on hidden tab).
 */
import Link from "next/link";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { formatFuturesContractLabel } from "@predict-future/business-rules/papertrading/futuresContract";

function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export interface EquityPositionChip {
  kind: "equity";
  symbol: string;
  productType: "DELIVERY" | "INTRADAY";
  quantity: number;
  netPnl: number | null;
}

export interface OptionPositionChip {
  kind: "option";
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string; // ISO
  lots: number;
  netPnl: number | null;
}

/** Phase 4 (Sprint 2, T10) — one open INDEX_FUTURE position chip. `pnl` here is TODAY's live-estimated MTM movement (see queries.ts's FuturesPositionRow.todayMtmPnl doc) — NOT unrealized-since-entry, and rendered labeled as such below so it's never misread as the option/equity chips' "P&L since I opened this" framing. */
export interface FuturesPositionChip {
  kind: "future";
  underlyingSymbol: string;
  expiryDate: string; // ISO
  side: "LONG" | "SHORT";
  lots: number;
  todayMtmPnl: number | null;
}

export type PositionChip = EquityPositionChip | OptionPositionChip | FuturesPositionChip;

export function PositionsStrip({ positions }: { positions: PositionChip[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-ink-200 bg-white/60 px-5 py-3 text-center text-xs text-ink-400">
        No open positions yet — trades you place will show up here for a quick sell.
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto rounded-[24px] border border-ink-100 bg-white p-2">
      {positions.map((p) => (
        <PositionChipCard key={chipKey(p)} chip={p} />
      ))}
    </div>
  );
}

function chipKey(chip: PositionChip): string {
  if (chip.kind === "equity") return `equity-${chip.symbol}-${chip.productType}`;
  if (chip.kind === "future") return `future-${chip.underlyingSymbol}-${chip.expiryDate}`;
  return `option-${chip.underlyingSymbol}-${chip.strikePrice}-${chip.optionType}-${chip.expiryDate}`;
}

function PositionChipCard({ chip }: { chip: PositionChip }) {
  const pnl = chip.kind === "future" ? chip.todayMtmPnl : chip.netPnl;
  const tone = pnl == null ? "text-ink-400" : pnl >= 0 ? "text-emerald-600" : "text-rose-600";
  const href =
    chip.kind === "equity"
      ? `/paper-trading?symbol=${encodeURIComponent(chip.symbol)}&side=SELL&productType=${chip.productType}&quantity=${Math.abs(chip.quantity)}`
      : chip.kind === "future"
        ? `/paper-trading/futures?underlying=${encodeURIComponent(chip.underlyingSymbol)}&expiry=${encodeURIComponent(
            formatNseExpiryDate(new Date(chip.expiryDate))
          )}&side=${chip.side === "LONG" ? "SELL" : "BUY"}`
        : `/paper-trading/options?underlying=${encodeURIComponent(chip.underlyingSymbol)}&expiry=${encodeURIComponent(
            formatNseExpiryDate(new Date(chip.expiryDate))
          )}&strike=${chip.strikePrice}&optionType=${chip.optionType}&side=SELL`;

  const label =
    chip.kind === "equity"
      ? chip.symbol
      : chip.kind === "future"
        ? formatFuturesContractLabel(chip.underlyingSymbol, new Date(chip.expiryDate))
        : `${chip.underlyingSymbol} ${chip.strikePrice} ${chip.optionType}`;

  const sublabel =
    chip.kind === "equity"
      ? `Stock · ${chip.productType.toLowerCase()} · ${chip.quantity} shares`
      : chip.kind === "future"
        ? `Future · ${chip.side.toLowerCase()} · ${chip.lots} lot(s)`
        : `Option · ${chip.lots} lot(s)`;

  return (
    <Link
      href={href}
      className="flex shrink-0 flex-col gap-0.5 rounded-2xl border border-ink-100 bg-ink-50/60 px-3 py-2 text-left transition hover:border-rose-200 hover:bg-rose-50"
    >
      <span className="whitespace-nowrap text-xs font-semibold text-ink-900">{label}</span>
      <span className="whitespace-nowrap text-[10px] text-ink-400">{sublabel}</span>
      <span className={`whitespace-nowrap text-xs font-medium ${tone}`}>
        {pnl != null ? formatSignedRupees(pnl) : "—"}
        {chip.kind === "future" && <span className="ml-1 text-[9px] font-normal text-ink-400">today&apos;s MTM</span>}
      </span>
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-rose-500">
        {chip.kind === "future" ? "Close" : "Sell"}
      </span>
    </Link>
  );
}
