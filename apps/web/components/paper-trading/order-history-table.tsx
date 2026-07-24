"use client";

/**
 * Order history (T5) — every executed leg, newest first, each with an expandable
 * itemized-cost row (mirrors components/finance/expandable-calls-table.tsx's
 * click-to-expand Fragment pattern).
 */
import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";

import { formatOptionContractLabel } from "@predict-future/business-rules/papertrading/optionContract";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

export interface OrderHistoryEntry {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  /** Null for an option row (Phase 2/3). */
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
  /** Phase 2 added INDEX_OPTION, Phase 3 added STOCK_OPTION — discriminates the equity vs. option row shape below, and which settlement mechanism an option row uses. */
  instrumentKind: "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION";
  underlyingSymbol: string | null;
  optionType: "CE" | "PE" | null;
  strikePrice: number | null;
  expiryDate: string | null;
  lots: number | null;
  squareOffReason: "INTRADAY_SESSION_CLOSE" | "OPTION_EXPIRY" | "STOCK_OPTION_EXPIRY_SQUAREOFF" | null;
}

/** Human label for one row: the contract label for an option leg (index OR stock), the plain symbol for an equity leg. */
function orderLabel(order: OrderHistoryEntry): string {
  const isOption = order.instrumentKind === "INDEX_OPTION" || order.instrumentKind === "STOCK_OPTION";
  if (isOption && order.underlyingSymbol && order.strikePrice != null && order.optionType && order.expiryDate) {
    return formatOptionContractLabel(order.underlyingSymbol, order.strikePrice, order.optionType, new Date(order.expiryDate));
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
            const isWorthlessExpiry = isIndexOption && order.squareOffReason === "OPTION_EXPIRY" && order.fillPrice === 0;
            return (
              <Fragment key={order.id}>
                <TableRow className="cursor-pointer select-none" onClick={() => setOpenId(isOpen ? null : order.id)}>
                  <TableCell className="font-medium text-ink-900">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                      {orderLabel(order)}
                      {isOption && order.lots != null && <span className="text-ink-400">({order.lots} lot{order.lots === 1 ? "" : "s"})</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={order.side === "BUY" ? "success" : "danger"}>{order.side}</Badge>
                  </TableCell>
                  <TableCell className="text-ink-600">
                    {isIndexOption ? "INDEX OPTION" : isStockOption ? "STOCK OPTION" : order.productType}
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
                  </TableCell>
                  <TableCell>{order.quantity}</TableCell>
                  <TableCell>₹{order.fillPrice.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="font-medium text-ink-900">
                    ₹{order.netAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-ink-500">{new Date(order.createdAt).toLocaleString("en-IN")}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-ink-50/50">
                    <TableCell colSpan={7} className="px-6 py-4">
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
