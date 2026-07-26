"use client";

/**
 * Limit Orders (Sprint, 2026-07-26) — the "Pending orders" section shared by
 * the main dashboard (equity) and the options page. One list + Cancel action,
 * showing each resting order's blocked amount (BUY) or reserved
 * quantity/lots (SELL) per the brief's "expose the blocked total visibly"
 * mandate.
 */
import { useState } from "react";

import { cancelPendingOrder, type PendingOrderPayload } from "@/lib/paperTrading/pendingOrdersClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function describeInstrument(order: PendingOrderPayload): string {
  if (order.instrumentKind === "EQUITY") {
    return `${order.symbol} · ${order.productType ?? ""}`;
  }
  return `${order.underlyingSymbol} ${order.strikePrice} ${order.optionType} · ${order.lots} lot(s)`;
}

export function PendingOrdersPanel({
  orders,
  onCancelled,
  emptyLabel = "No pending limit orders."
}: {
  orders: PendingOrderPayload[];
  onCancelled: () => void;
  emptyLabel?: string;
}) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleCancel(id: string) {
    setError("");
    setCancellingId(id);
    try {
      const result = await cancelPendingOrder(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCancelled();
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending limit orders</CardTitle>
        <CardDescription>
          Fills only when the delayed market quote reaches your limit price — checked roughly every 1-2 minutes during
          NSE hours. Always fills AT your limit price, never a better one, and never partially. Unfilled orders expire
          automatically at session close (DAY validity).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-xs text-rose-600">{error}</p>}
        {orders.length === 0 ? (
          <p className="text-sm text-ink-400">{emptyLabel}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Instrument</TableHeaderCell>
                  <TableHeaderCell>Side</TableHeaderCell>
                  <TableHeaderCell>Qty</TableHeaderCell>
                  <TableHeaderCell>Limit price</TableHeaderCell>
                  <TableHeaderCell>Blocked</TableHeaderCell>
                  <TableHeaderCell>Placed</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>{describeInstrument(order)}</TableCell>
                    <TableCell className={order.side === "BUY" ? "text-emerald-600" : "text-rose-600"}>{order.side}</TableCell>
                    <TableCell>{order.quantity.toLocaleString("en-IN")}</TableCell>
                    <TableCell>{formatRupees(order.limitPrice)}</TableCell>
                    <TableCell>
                      {order.blockedAmount != null ? formatRupees(order.blockedAmount) : `${order.quantity.toLocaleString("en-IN")} units reserved`}
                    </TableCell>
                    <TableCell>{new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" disabled={cancellingId === order.id} onClick={() => handleCancel(order.id)}>
                        {cancellingId === order.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
