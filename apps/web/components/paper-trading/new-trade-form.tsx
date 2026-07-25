"use client";

/**
 * Paper Trading Phase 1 — New Trade form (T5) with a live pre-trade cost
 * estimate (T5 acceptance: the estimate must match the server-side fill to the
 * rupee). Achieves that by calling computeOrderCosts() — the SAME pure function
 * apps/web/lib/paperTrading/orders.ts calls server-side — directly in the
 * browser, against a live LTP fetched from the existing public
 * /api/instruments/[symbol]/intraday proxy. There is no separate "preview" API
 * route: the estimate and the fill are provably the same computation, not two
 * hand-synced copies.
 */
import { useEffect, useState } from "react";

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { PaperTradingSymbolSearchInput, type PaperSymbolOption } from "@/components/paper-trading/symbol-search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface PlacedOrderPayload {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  productType: "DELIVERY" | "INTRADAY";
  quantity: number;
  fillPrice: number;
  fillTickAt: string;
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
  linkedOpinionId: string | null;
  createdAt: string;
}

const LTP_DEBOUNCE_MS = 400;

export function NewTradeForm({
  cash,
  heldDeliveryQtyBySymbol,
  hasSoldDeliveryTodayBySymbol,
  initialSymbol = null,
  fixedSymbol = null,
  initialSide = "BUY",
  initialProductType = "DELIVERY",
  linkedOpinionId = null,
  onOrderPlaced
}: {
  /** Available cash right now, for the client-side insufficient-cash warning (server re-validates independently). */
  cash: number;
  heldDeliveryQtyBySymbol: Record<string, number>;
  hasSoldDeliveryTodayBySymbol: Record<string, boolean>;
  initialSymbol?: string | null;
  /**
   * Terminal mode: the symbol is owned by the terminal's own focus/search
   * (header search, chart, deep-links) — render a static symbol chip instead
   * of the embedded search input, which is redundant there and collapses to an
   * unusable sliver in the narrow docked-ticket column.
   */
  fixedSymbol?: string | null;
  initialSide?: "BUY" | "SELL";
  initialProductType?: "DELIVERY" | "INTRADAY";
  linkedOpinionId?: string | null;
  onOrderPlaced: (order: PlacedOrderPayload) => void;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState<PaperSymbolOption | null>(
    fixedSymbol ?? initialSymbol ? { symbol: (fixedSymbol ?? initialSymbol) as string, companyName: "", close: 0 } : null
  );
  const [symbolInputValue, setSymbolInputValue] = useState(fixedSymbol ?? initialSymbol ?? "");

  // Terminal focus can change without a remount — keep the fixed symbol synced.
  useEffect(() => {
    if (fixedSymbol) {
      setSelectedSymbol({ symbol: fixedSymbol, companyName: "", close: 0 });
      setSymbolInputValue(fixedSymbol);
    }
  }, [fixedSymbol]);
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [productType, setProductType] = useState<"DELIVERY" | "INTRADAY">(initialProductType);
  const [quantity, setQuantity] = useState("");
  const [ltp, setLtp] = useState<number | null>(null);
  const [ltpLoading, setLtpLoading] = useState(false);
  const [ltpError, setLtpError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const symbol = selectedSymbol?.symbol ?? "";
  const isBearishShort = side === "SELL" && productType === "INTRADAY" && linkedOpinionId !== null;

  useEffect(() => {
    if (!symbol) {
      setLtp(null);
      return;
    }
    let cancelled = false;
    setLtpLoading(true);
    setLtpError("");
    const timer = setTimeout(() => {
      fetch(`/api/instruments/${encodeURIComponent(symbol)}/intraday`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          const points: [number, number][] = data?.points ?? [];
          if (points.length === 0) {
            setLtp(null);
            setLtpError("No live price available for this symbol right now.");
            return;
          }
          setLtp(points[points.length - 1][1]);
        })
        .catch(() => {
          if (!cancelled) {
            setLtp(null);
            setLtpError("Couldn't load a live price — try again shortly.");
          }
        })
        .finally(() => {
          if (!cancelled) setLtpLoading(false);
        });
    }, LTP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol]);

  const qtyNumber = Number(quantity);
  const validQuantity = Number.isInteger(qtyNumber) && qtyNumber > 0;

  const estimate =
    validQuantity && ltp !== null
      ? computeOrderCosts({
          side,
          productType,
          quantity: qtyNumber,
          price: ltp,
          isFirstDeliverySellOfScripToday:
            productType === "DELIVERY" && side === "SELL" ? !hasSoldDeliveryTodayBySymbol[symbol] : undefined
        })
      : null;

  const heldQty = heldDeliveryQtyBySymbol[symbol] ?? 0;
  const insufficientHoldings = productType === "DELIVERY" && side === "SELL" && validQuantity && qtyNumber > heldQty;
  const insufficientCash = side === "BUY" && estimate !== null && estimate.netAmount > cash;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!symbol || !validQuantity || submitting) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/paper-trading/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          productType,
          quantity: qtyNumber,
          ...(linkedOpinionId ? { linkedOpinionId } : {})
        })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setFormError(payload.error ?? "Couldn't place that order.");
        return;
      }
      const data = await res.json();
      onOrderPlaced(data.order);
      setSelectedSymbol(null);
      setSymbolInputValue("");
      setQuantity("");
    } catch {
      setFormError("Couldn't place that order — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {fixedSymbol && (
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white">{fixedSymbol}</span>
          <span className="text-xs text-ink-400">Change via the symbol search above</span>
        </div>
      )}
      <div className={`grid gap-3 ${fixedSymbol ? "grid-cols-[auto_auto_1fr]" : "sm:grid-cols-[1fr_auto_auto_auto]"}`}>
        {!fixedSymbol && (
          <PaperTradingSymbolSearchInput
            value={symbolInputValue}
            onSelect={(opt) => {
              setSelectedSymbol(opt);
              setSymbolInputValue(opt.symbol);
            }}
            disabled={submitting}
          />
        )}
        <Select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")} disabled={submitting}>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </Select>
        <Select
          value={productType}
          onChange={(e) => setProductType(e.target.value as "DELIVERY" | "INTRADAY")}
          disabled={submitting}
        >
          <option value="DELIVERY">Delivery</option>
          <option value="INTRADAY">Intraday</option>
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

      {isBearishShort && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          This is a same-day INTRADAY short — you&apos;re selling shares you don&apos;t hold, betting the price falls, and
          you must buy them back before the market closes today. Delivery short-selling isn&apos;t allowed (it&apos;s
          illegal in the real cash market), so this is the only way to paper-trade a bearish call. If you don&apos;t
          close it yourself, it will be auto-squared-off near session close.
        </p>
      )}

      {symbol && (
        <div className="text-xs text-ink-500">
          {ltpLoading && "Loading live price…"}
          {!ltpLoading && ltp !== null && <>Latest delayed price for {symbol}: ₹{ltp.toLocaleString("en-IN")}</>}
          {!ltpLoading && ltpError && <span className="text-rose-600">{ltpError}</span>}
          {productType === "DELIVERY" && side === "SELL" && (
            <span className="ml-2">
              · Held: {heldQty} share{heldQty === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {estimate && <CostBreakdownTable breakdown={estimate} side={side} />}

      {insufficientHoldings && (
        <p className="text-xs text-rose-600">
          You hold {heldQty} share{heldQty === 1 ? "" : "s"} of {symbol} — DELIVERY sells can&apos;t exceed that
          (no delivery short-selling).
        </p>
      )}
      {insufficientCash && (
        <p className="text-xs text-rose-600">
          Estimated total (₹{estimate?.netAmount.toLocaleString("en-IN")}) exceeds your available cash (₹
          {cash.toLocaleString("en-IN")}).
        </p>
      )}
      {formError && <p className="text-xs text-rose-600">{formError}</p>}

      <Button
        type="submit"
        variant="primary"
        disabled={
          submitting ||
          !symbol ||
          !validQuantity ||
          ltp === null ||
          insufficientHoldings ||
          insufficientCash
        }
      >
        {submitting ? "Placing order…" : `Place ${side.toLowerCase()} order`}
      </Button>
    </form>
  );
}
