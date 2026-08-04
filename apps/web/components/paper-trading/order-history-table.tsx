"use client";

/**
 * Order history (T5) — every executed leg, newest first, each with an expandable
 * itemized-cost row (mirrors components/finance/expandable-calls-table.tsx's
 * click-to-expand Fragment pattern).
 */
import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";

import { formatOptionContractLabel } from "@predict-future/business-rules/papertrading/optionContract";
import { formatFuturesContractLabel } from "@predict-future/business-rules/papertrading/futuresContract";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

export interface OrderHistoryEntry {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  /** Null for an option/futures row. */
  productType: "DELIVERY" | "INTRADAY" | null;
  quantity: number;
  fillPrice: number;
  grossAmount: number;
  brokerage: number;
  sttAmount: number;
  exchangeCharge: number;
  sebiFee: number;
  stampDuty: number;
  gstAmount: number;
  dpCharge: number;
  totalCosts: number;
  netAmount: number;
  isSquareOff: boolean;
  autoSquaredOff: boolean;
  createdAt: string;
  /** Phase 2 added INDEX_OPTION, Phase 3 added STOCK_OPTION, Phase 4 added INDEX_FUTURE — discriminates the equity/option/futures row shape below, and which settlement mechanism a row uses. */
  instrumentKind: "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION" | "INDEX_FUTURE";
  underlyingSymbol: string | null;
  optionType: "CE" | "PE" | null;
  strikePrice: number | null;
  expiryDate: string | null;
  lots: number | null;
  squareOffReason:
    | "INTRADAY_SESSION_CLOSE"
    | "OPTION_EXPIRY"
    | "STOCK_OPTION_EXPIRY_SQUAREOFF"
    | "FUTURES_EXPIRY_SETTLEMENT"
    | "FUTURES_MARGIN_CALL"
    | "OPTION_EXPIRY_BACKFILL"
    | "FUTURES_EXPIRY_BACKFILL"
    | null;
  /** Phase 4 — true only for a cash-only daily mark-to-market leg (quantity 0, all costs 0, netAmount is the signed variation-margin cash flow). */
  isDailyMtm?: boolean;
  /** Expiry Settlement Backfill (2026-08-04) — which price source produced fillPrice on an auto-settlement leg. Null for a manual trade or a settlement leg written before this field existed. */
  settlementBasis?: "LIVE_MARKET" | "HISTORICAL_EXCHANGE_CLOSE" | "LAST_KNOWN_MARK" | "ASSUMED_WORTHLESS" | null;
}

/** Human-readable disclosure for a backfilled settlement's price basis — shown only for the non-"normal" bases, see the module doc. Never invents a reason for `LIVE_MARKET`/null (the ordinary same-day path needs no disclosure). */
function settlementBasisDisclosure(basis: OrderHistoryEntry["settlementBasis"]): string | null {
  switch (basis) {
    case "HISTORICAL_EXCHANGE_CLOSE":
      return "Settled late, after this contract's own expiry had already passed — priced from NSE's official exchange record for that expiry date (its live quote was no longer available by the time this ran).";
    case "LAST_KNOWN_MARK":
      return "Settled late, after this contract's own expiry had already passed — no official exchange record was available for that date, so this used the last price we had on record for this contract.";
    case "ASSUMED_WORTHLESS":
      return "Settled late, after this contract's own expiry had already passed — no price data of any kind was available for this contract, so it was conservatively settled at ₹0 rather than guessed.";
    default:
      return null;
  }
}

/** Human label for one row: the contract label for an option leg (index OR stock), the futures contract label, or the plain symbol for an equity leg. */
function orderLabel(order: OrderHistoryEntry): string {
  const isOption = order.instrumentKind === "INDEX_OPTION" || order.instrumentKind === "STOCK_OPTION";
  if (isOption && order.underlyingSymbol && order.strikePrice != null && order.optionType && order.expiryDate) {
    return formatOptionContractLabel(order.underlyingSymbol, order.strikePrice, order.optionType, new Date(order.expiryDate));
  }
  if (order.instrumentKind === "INDEX_FUTURE" && order.underlyingSymbol && order.expiryDate) {
    return formatFuturesContractLabel(order.underlyingSymbol, new Date(order.expiryDate));
  }
  return order.symbol;
}

export function OrderHistoryTable({ orders }: { orders: OrderHistoryEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (orders.length === 0) {
    return <p className="text-sm text-ink-400">No orders yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Symbol</TableHeaderCell>
            <TableHeaderCell>Side</TableHeaderCell>
            <TableHeaderCell>Type</TableHeaderCell>
            <TableHeaderCell>Qty</TableHeaderCell>
            <TableHeaderCell>Fill price</TableHeaderCell>
            <TableHeaderCell>Net amount</TableHeaderCell>
            <TableHeaderCell>When</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((order) => {
            const isOpen = openId === order.id;
            const isIndexOption = order.instrumentKind === "INDEX_OPTION";
            const isStockOption = order.instrumentKind === "STOCK_OPTION";
            const isOption = isIndexOption || isStockOption;
            const isFuture = order.instrumentKind === "INDEX_FUTURE";
            const isMtmLeg = isFuture && order.isDailyMtm === true;
            const isWorthlessExpiry =
              isOption &&
              (order.squareOffReason === "OPTION_EXPIRY" || order.squareOffReason === "OPTION_EXPIRY_BACKFILL") &&
              order.fillPrice === 0;
            const basisDisclosure = settlementBasisDisclosure(order.settlementBasis ?? null);
            return (
              <Fragment key={order.id}>
                <TableRow className="cursor-pointer select-none" onClick={() => setOpenId(isOpen ? null : order.id)}>
                  <TableCell className="font-medium text-ink-900">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                      {orderLabel(order)}
                      {(isOption || isFuture) && order.lots != null && (
                        <span className="text-ink-400">({order.lots} lot{order.lots === 1 ? "" : "s"})</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {isMtmLeg ? (
                      <Badge variant="default">MTM</Badge>
                    ) : (
                      <Badge variant={order.side === "BUY" ? "success" : "danger"}>{order.side}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-ink-600">
                    {isIndexOption
                      ? "INDEX OPTION"
                      : isStockOption
                        ? "STOCK OPTION"
                        : isFuture
                          ? "INDEX FUTURE"
                          : order.productType}
                    {order.autoSquaredOff && order.squareOffReason === "INTRADAY_SESSION_CLOSE" && (
                      <Badge variant="warning" className="ml-1.5">
                        AUTO SQUARE-OFF
                      </Badge>
                    )}
                    {order.autoSquaredOff && order.squareOffReason === "OPTION_EXPIRY" && (
                      <Badge variant={isWorthlessExpiry ? "danger" : "warning"} className="ml-1.5">
                        {isWorthlessExpiry ? "EXPIRED WORTHLESS — FULL LOSS" : "SETTLED AT EXPIRY"}
                      </Badge>
                    )}
                    {order.autoSquaredOff && order.squareOffReason === "STOCK_OPTION_EXPIRY_SQUAREOFF" && (
                      <Badge variant="warning" className="ml-1.5">
                        CLOSED BEFORE EXPIRY — NOT SETTLED
                      </Badge>
                    )}
                    {order.autoSquaredOff && order.squareOffReason === "OPTION_EXPIRY_BACKFILL" && (
                      <Badge variant={isWorthlessExpiry ? "danger" : "warning"} className="ml-1.5">
                        {isWorthlessExpiry ? "EXPIRED WORTHLESS — FULL LOSS" : "SETTLED LATE — EXPIRED"}
                      </Badge>
                    )}
                    {order.autoSquaredOff && order.squareOffReason === "FUTURES_EXPIRY_SETTLEMENT" && (
                      <Badge variant="warning" className="ml-1.5">
                        CASH-SETTLED AT EXPIRY
                      </Badge>
                    )}
                    {order.autoSquaredOff && order.squareOffReason === "FUTURES_EXPIRY_BACKFILL" && (
                      <Badge variant="warning" className="ml-1.5">
                        SETTLED LATE — EXPIRED
                      </Badge>
                    )}
                    {order.autoSquaredOff && order.squareOffReason === "FUTURES_MARGIN_CALL" && (
                      <Badge variant="danger" className="ml-1.5">
                        MARGIN CALL — FORCE CLOSED
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{isMtmLeg ? "—" : order.quantity}</TableCell>
                  <TableCell>₹{order.fillPrice.toLocaleString("en-IN")}</TableCell>
                  <TableCell className={`font-medium ${isMtmLeg ? (order.netAmount >= 0 ? "text-emerald-600" : "text-rose-600") : "text-ink-900"}`}>
                    {isMtmLeg && order.netAmount >= 0 ? "+" : ""}
                    ₹{order.netAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-ink-500">{new Date(order.createdAt).toLocaleString("en-IN")}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-ink-50/50">
                    <TableCell colSpan={7} className="px-6 py-4">
                      {isMtmLeg ? (
                        <p className="text-xs text-ink-500">
                          Daily mark-to-market — a pure cash adjustment against today&apos;s NSE settlement price, marked at ₹
                          {order.fillPrice.toLocaleString("en-IN")}. No brokerage, STT, or other trading costs apply to this leg.
                        </p>
                      ) : (
                        <>
                          {basisDisclosure && (
                            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                              {basisDisclosure}
                            </p>
                          )}
                          <CostBreakdownTable
                            breakdown={{
                              grossAmount: order.grossAmount,
                              brokerage: order.brokerage,
                              stt: order.sttAmount,
                              exchangeCharge: order.exchangeCharge,
                              sebiFee: order.sebiFee,
                              stampDuty: order.stampDuty,
                              gst: order.gstAmount,
                              dpCharge: order.dpCharge,
                              totalCosts: order.totalCosts,
                              netAmount: order.netAmount
                            }}
                            side={order.side}
                          />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
