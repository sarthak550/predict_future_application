"use client";

/**
 * Per-portfolio management panel for /portfolios/manage — holdings, pending
 * orders (cancellable), the add-transaction form, and the visibility toggle.
 * Fetches its own full detail via GET /api/portfolios/:id (owner-authenticated
 * — see apps/web/app/api/portfolios/[id]/route.ts) rather than relying on the
 * lighter /mine summary, since this is the one surface that needs pending
 * orders + per-symbol holdings, not just the live totals.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { ModelPortfolioBadge } from "@/components/portfolios/model-portfolio-badge";
import { SymbolSearchInput, type SymbolOption } from "@/components/portfolios/symbol-search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatRupees, formatSignedPercent } from "@/lib/portfolios/format";
import { formatDateTime } from "@/lib/utils";

interface HoldingRow {
  symbol: string;
  quantity: number;
  costBasis: number;
  avgCost: number;
  latestClose: number | null;
}

interface PendingTxn {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  requestedAt: string;
}

interface PortfolioDetailPayload {
  id: string;
  slug: string;
  name: string;
  kind: "USER" | "SHADOW";
  visibility: "PUBLIC" | "PRIVATE";
  startingCapital: number;
  holdings: HoldingRow[];
  live: { cash: number; holdingsValue: number; totalValue: number; returnPct: number };
  pendingTransactions: PendingTxn[] | null;
  executedTransactionCount: number;
}

export interface PortfolioSummary {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
}

export function PortfolioManagePanel({ portfolio }: { portfolio: PortfolioSummary }) {
  const [detail, setDetail] = useState<PortfolioDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [selectedSymbol, setSelectedSymbol] = useState<SymbolOption | null>(null);
  const [symbolInputValue, setSymbolInputValue] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchDetail = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setLoadError(payload.error ?? "Couldn't load this portfolio.");
        return;
      }
      const data = await res.json();
      setDetail(data.portfolio);
    } catch {
      setLoadError("Couldn't load this portfolio — check your connection.");
    } finally {
      setLoading(false);
    }
  }, [portfolio.id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function handleToggleVisibility() {
    if (!detail || togglingVisibility) return;
    const nextVisibility = detail.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC";
    setTogglingVisibility(true);
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility })
      });
      if (res.ok) {
        await fetchDetail();
      }
    } finally {
      setTogglingVisibility(false);
    }
  }

  async function handleCancel(txnId: string) {
    if (cancellingId) return;
    setCancellingId(txnId);
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}/transactions/${txnId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchDetail();
      }
    } finally {
      setCancellingId(null);
    }
  }

  async function handleSubmitOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSymbol || submitting) return;
    const qty = Number(quantity);
    setFormError("");

    if (!Number.isInteger(qty) || qty < 1) {
      setFormError("Enter a whole number of shares.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selectedSymbol.symbol, side, quantity: qty })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setFormError(payload.error ?? "Couldn't place that order.");
        return;
      }
      setSelectedSymbol(null);
      setSymbolInputValue("");
      setQuantity("");
      await fetchDetail();
    } catch {
      setFormError("Couldn't place that order — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-ink-500">Loading…</CardContent>
      </Card>
    );
  }

  if (loadError || !detail) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-rose-600">{loadError || "Not found."}</CardContent>
      </Card>
    );
  }

  const heldQty = detail.holdings.find((h) => h.symbol === selectedSymbol?.symbol)?.quantity ?? 0;
  const pendingSellQty = (detail.pendingTransactions ?? [])
    .filter((t) => t.side === "SELL" && t.symbol === selectedSymbol?.symbol)
    .reduce((sum, t) => sum + t.quantity, 0);
  const sellableQty = heldQty - pendingSellQty;

  const qtyNumber = Number(quantity);
  const estimatedCost =
    selectedSymbol && Number.isFinite(qtyNumber) && qtyNumber > 0 ? qtyNumber * selectedSymbol.close : null;
  const insufficientCash = side === "BUY" && estimatedCost != null && estimatedCost > detail.live.cash;
  const insufficientHoldings = side === "SELL" && Number.isFinite(qtyNumber) && qtyNumber > sellableQty;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{detail.name}</CardTitle>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={detail.visibility === "PUBLIC" ? "success" : "default"}>{detail.visibility}</Badge>
              {detail.visibility === "PUBLIC" && (
                <Link href={`/portfolios/${detail.slug}`} className="text-xs font-medium text-signal-sky hover:underline">
                  View public page
                </Link>
              )}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleToggleVisibility} disabled={togglingVisibility}>
            {togglingVisibility ? "Updating…" : detail.visibility === "PUBLIC" ? "Make private" : "Make public"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <ModelPortfolioBadge />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Cash" value={formatRupees(detail.live.cash)} />
          <Stat label="Holdings value" value={formatRupees(detail.live.holdingsValue)} />
          <Stat label="Total value" value={formatRupees(detail.live.totalValue)} />
          <Stat
            label="Return"
            value={formatSignedPercent(detail.live.returnPct)}
            tone={detail.live.returnPct >= 0 ? "up" : "down"}
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-700">Holdings</h3>
          {detail.holdings.length === 0 ? (
            <p className="text-sm text-ink-400">No open positions.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Symbol</TableHeaderCell>
                    <TableHeaderCell>Qty</TableHeaderCell>
                    <TableHeaderCell>Avg. cost</TableHeaderCell>
                    <TableHeaderCell>Latest close</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detail.holdings.map((h) => (
                    <TableRow key={h.symbol}>
                      <TableCell className="font-medium text-ink-900">{h.symbol}</TableCell>
                      <TableCell>{h.quantity}</TableCell>
                      <TableCell>{formatRupees(h.avgCost)}</TableCell>
                      <TableCell>{h.latestClose != null ? formatRupees(h.latestClose) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-700">Pending orders</h3>
          {!detail.pendingTransactions || detail.pendingTransactions.length === 0 ? (
            <p className="text-sm text-ink-400">No pending orders.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {detail.pendingTransactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <Badge variant={t.side === "BUY" ? "success" : "danger"} className="mr-2">
                      {t.side}
                    </Badge>
                    {t.quantity} × {t.symbol}
                    <span className="ml-2 text-xs text-ink-400">{formatDateTime(t.requestedAt)}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancel(t.id)}
                    disabled={cancellingId === t.id}
                  >
                    {cancellingId === t.id ? "Cancelling…" : "Cancel"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-[24px] border border-ink-100 p-4">
          <h3 className="text-sm font-semibold text-ink-700">Place an order</h3>
          <p className="mt-1 text-xs text-ink-400">
            Orders execute at the next market close, not immediately — the fill price is that session&apos;s
            closing price, whatever it turns out to be.
          </p>
          <form className="mt-4 space-y-3" onSubmit={handleSubmitOrder}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <SymbolSearchInput
                value={symbolInputValue}
                onSelect={(opt) => {
                  setSelectedSymbol(opt);
                  setSymbolInputValue(opt.symbol);
                }}
                disabled={submitting}
              />
              <Select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")} disabled={submitting}>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </Select>
              <Input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Qty"
                className="w-24"
                disabled={submitting}
              />
            </div>

            {selectedSymbol && (
              <p className="text-xs text-ink-500">
                Latest close for {selectedSymbol.symbol}: {formatRupees(selectedSymbol.close)}
                {estimatedCost != null && side === "BUY" && <> · Estimated cost: {formatRupees(estimatedCost)}</>}
                {side === "SELL" && <> · Sellable: {Math.max(sellableQty, 0)} of {heldQty} held</>}
              </p>
            )}
            {insufficientCash && (
              <p className="text-xs text-rose-600">
                Estimated cost exceeds available cash ({formatRupees(detail.live.cash)}). This is an
                estimate — the order may also be rejected at settlement if the price moves.
              </p>
            )}
            {insufficientHoldings && (
              <p className="text-xs text-rose-600">
                You can sell at most {Math.max(sellableQty, 0)} shares of {selectedSymbol?.symbol}.
              </p>
            )}
            {formError && <p className="text-xs text-rose-600">{formError}</p>}

            <Button
              type="submit"
              variant="primary"
              disabled={
                submitting ||
                !selectedSymbol ||
                !Number.isInteger(qtyNumber) ||
                qtyNumber < 1 ||
                insufficientCash ||
                insufficientHoldings
              }
            >
              {submitting ? "Placing order…" : `Place ${side.toLowerCase()} order`}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold ${tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-ink-900"}`}
      >
        {value}
      </p>
    </div>
  );
}
