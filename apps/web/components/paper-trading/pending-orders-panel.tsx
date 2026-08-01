"use client";

/**
 * Limit Orders (Sprint, 2026-07-26) — the "Pending orders" section shared by
 * the main dashboard (equity), the options page, and (Sprint B) the futures
 * page. One list + Cancel action, showing each resting order's blocked
 * amount (BUY) or reserved quantity/lots (SELL) per the brief's "expose the
 * blocked total visibly" mandate.
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, B5) — three additions,
 * per decision 7 of the Sprint B brief:
 *   1. A LIMIT/STOP badge on every row, distinguishable at a glance (not
 *      just an icon users have to learn).
 *   2. `triggerPrice` display — a STOP row's price is labeled "Trigger", not
 *      "Limit", even though the schema denormalizes them to the same number
 *      (see PaperPendingOrder's own doc on why) — the wording is what
 *      matters for user understanding.
 *   3. REJECTED rows now flow into this list (see
 *      `listPendingOrdersForAccount`'s Sprint B widening from `status:
 *      "PENDING"` to `status: {in: ["PENDING","REJECTED"]}`) and render
 *      visibly distinct — a rose-tinted row with its `resolutionNote` shown
 *      inline, no extra click required, so a rejected stop-loss never reads
 *      as just another routine cancelled/expired row. Also added: futures
 *      (INDEX_FUTURE) row description, since this panel is now also used on
 *      the futures terminal page.
 */
import { Fragment, useState } from "react";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

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
  if (order.instrumentKind === "INDEX_FUTURE") {
    const expiryLabel = order.expiryDate ? formatNseExpiryDate(new Date(order.expiryDate)) : "";
    return `${order.underlyingSymbol} FUT ${expiryLabel} · ${order.lots ?? 0} lot(s)`;
  }
  return `${order.underlyingSymbol} ${order.strikePrice} ${order.optionType} · ${order.lots} lot(s)`;
}

/** The number this row's price column shows — a STOP row's `limitPrice` and `triggerPrice` are denormalized equal (see the schema doc), so either field works; `triggerPrice` is preferred when present since it's the semantically correct name for a STOP row. */
function displayPrice(order: PendingOrderPayload): number {
  return order.variant === "STOP" ? (order.triggerPrice ?? order.limitPrice) : order.limitPrice;
}

function VariantBadge({ variant }: { variant: "LIMIT" | "STOP" }) {
  return variant === "STOP" ? (
    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
      Stop
    </span>
  ) : (
    <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
      Limit
    </span>
  );
}

export function PendingOrdersPanel({
  orders,
  onCancelled,
  emptyLabel = "No pending or recently-rejected orders."
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
        <CardTitle>Pending orders</CardTitle>
        <CardDescription>
          Fills only when the delayed market quote reaches your limit price (or crosses your stop trigger) — checked
          roughly every 1-2 minutes during NSE hours. A LIMIT always fills AT your limit price, never a better one,
          and never partially. A STOP fills at the price observed when the market crosses it — that can be better or
          worse than your trigger, never guaranteed exact. Unfilled orders expire automatically at session close (DAY
          validity). A row that couldn&apos;t fill because the crossing price made it infeasible shows as Rejected
          below, with why.
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
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Side</TableHeaderCell>
                  <TableHeaderCell>Qty</TableHeaderCell>
                  <TableHeaderCell>Price</TableHeaderCell>
                  <TableHeaderCell>Blocked</TableHeaderCell>
                  <TableHeaderCell>Placed</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((order) => {
                  const isRejected = order.status === "REJECTED";
                  const price = displayPrice(order);
                  return (
                    <Fragment key={order.id}>
                      <TableRow className={isRejected ? "bg-rose-50/60" : undefined}>
                        <TableCell>{describeInstrument(order)}</TableCell>
                        <TableCell>
                          <VariantBadge variant={order.variant} />
                        </TableCell>
                        <TableCell className={order.side === "BUY" ? "text-emerald-600" : "text-rose-600"}>{order.side}</TableCell>
                        <TableCell>{order.quantity.toLocaleString("en-IN")}</TableCell>
                        <TableCell>
                          {order.variant === "STOP" ? "Trigger " : "Limit "}
                          {formatRupees(price)}
                        </TableCell>
                        <TableCell>
                          {order.blockedAmount != null ? formatRupees(order.blockedAmount) : `${order.quantity.toLocaleString("en-IN")} units reserved`}
                        </TableCell>
                        <TableCell>{new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                        <TableCell>
                          {isRejected ? (
                            <span className="inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                              Rejected
                            </span>
                          ) : (
                            <Button variant="ghost" size="sm" disabled={cancellingId === order.id} onClick={() => handleCancel(order.id)}>
                              {cancellingId === order.id ? "Cancelling…" : "Cancel"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {isRejected && order.resolutionNote && (
                        <TableRow className="bg-rose-50/60">
                          <TableCell colSpan={8} className="pt-0 text-xs leading-5 text-rose-700">
                            <span className="font-semibold">Why: </span>
                            {order.resolutionNote}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
