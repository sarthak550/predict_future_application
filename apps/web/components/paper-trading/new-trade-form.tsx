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
 *
 * Limit Orders (Sprint, 2026-07-26) — added a Market/Limit order-type toggle.
 * Market mode is BYTE-IDENTICAL to pre-Sprint behavior (same POST
 * /api/paper-trading/orders request shape) — this is the T6 regression bar.
 * Limit mode reveals a limit-price input (with a live "X% above/below LTP"
 * hint reusing the SAME live LTP this form already fetches for the cost
 * preview) and posts to POST /api/paper-trading/pending-orders instead,
 * never to the market-order route.
 */
import { useEffect, useState } from "react";

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { PaperTradingSymbolSearchInput, type PaperSymbolOption } from "@/components/paper-trading/symbol-search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { submitPendingOrder, type PendingOrderPayload } from "@/lib/paperTrading/pendingOrdersClient";

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
  onOrderPlaced,
  onPendingOrderPlaced
}: {
  /** Available cash right now, for the client-side insufficient-cash warning (server re-validates independently). Callers should pass `availableCash` (cash minus pending-order blocks), not raw account cash — see queries.ts's PaperAccountDetail.availableCash. */
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
  /** Market-mode fill confirmation — unchanged Phase 1 contract. */
  onOrderPlaced: (order: PlacedOrderPayload) => void;
  /** Limit Orders (Sprint, 2026-07-26) — fired when a LIMIT order is successfully QUEUED (never fills synchronously — see PendingOrderPayload). Optional so a caller that hasn't adopted the pending-orders section yet still compiles; omitting it simply means the Limit toggle is unavailable (see the guard below). */
  onPendingOrderPlaced?: (order: PendingOrderPayload) => void;
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
  // Limit Orders (Sprint, 2026-07-26) — Market/Limit toggle. Market mode's
  // request shape/route is untouched from Phase 1 (the T6 regression bar).
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [limitPrice, setLimitPrice] = useState("");

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
  const limitPriceNumber = Number(limitPrice);
  const validLimitPrice = limitPrice.trim() !== "" && Number.isFinite(limitPriceNumber) && limitPriceNumber > 0;
  // The price the cost/blocked-amount estimate is computed against: the live
  // LTP in Market mode, the user's own limit price in Limit mode (a limit
  // order fills AT the limit price — see pendingOrders.ts's doc — so this is
  // the honest preview, not an approximation).
  const estimatePrice = orderType === "MARKET" ? ltp : validLimitPrice ? limitPriceNumber : null;

  const estimate =
    validQuantity && estimatePrice !== null
      ? computeOrderCosts({
          side,
          productType,
          quantity: qtyNumber,
          price: estimatePrice,
          isFirstDeliverySellOfScripToday:
            productType === "DELIVERY" && side === "SELL" ? !hasSoldDeliveryTodayBySymbol[symbol] : undefined
        })
      : null;

  const heldQty = heldDeliveryQtyBySymbol[symbol] ?? 0;
  const insufficientHoldings = productType === "DELIVERY" && side === "SELL" && validQuantity && qtyNumber > heldQty;
  const insufficientCash = side === "BUY" && estimate !== null && estimate.netAmount > cash;

  // Live "X% above/below LTP" hint for the limit-price input, per T6's
  // acceptance criteria — reuses the SAME live ltp already fetched above.
  const limitDistancePct =
    orderType === "LIMIT" && validLimitPrice && ltp !== null && ltp > 0 ? ((limitPriceNumber - ltp) / ltp) * 100 : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!symbol || !validQuantity || submitting) return;
    if (orderType === "LIMIT" && !validLimitPrice) return;
    setFormError("");
    setSubmitting(true);
    try {
      if (orderType === "LIMIT") {
        const result = await submitPendingOrder({
          orderKind: "EQUITY",
          symbol,
          side,
          productType,
          quantity: qtyNumber,
          limitPrice: limitPriceNumber,
          linkedOpinionId
        });
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        onPendingOrderPlaced?.(result.order);
        setSelectedSymbol(null);
        setSymbolInputValue("");
        setQuantity("");
        setLimitPrice("");
        return;
      }

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

      {onPendingOrderPlaced && (
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setOrderType("MARKET")}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                orderType === "MARKET" ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => setOrderType("LIMIT")}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                orderType === "LIMIT" ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              Limit
            </button>
          </div>
          {orderType === "LIMIT" && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step="0.05"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="Limit price"
                className="w-32"
                disabled={submitting}
              />
              {limitDistancePct !== null && (
                <span className={`text-xs ${limitDistancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {limitDistancePct >= 0 ? "+" : ""}
                  {limitDistancePct.toFixed(2)}% vs LTP
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {orderType === "LIMIT" && (
        <p className="text-xs leading-5 text-ink-500">
          Fills only when the delayed market price reaches ₹{validLimitPrice ? limitPriceNumber.toLocaleString("en-IN") : "your limit"} — at
          your limit price, never a better one, and never partially. Cash is reserved now; unfilled orders expire at
          today&apos;s session close.
        </p>
      )}

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
          (orderType === "MARKET" ? ltp === null : !validLimitPrice) ||
          insufficientHoldings ||
          insufficientCash
        }
      >
        {submitting
          ? orderType === "LIMIT"
            ? "Placing limit order…"
            : "Placing order…"
          : orderType === "LIMIT"
            ? `Place ${side.toLowerCase()} limit order`
            : `Place ${side.toLowerCase()} order`}
      </Button>
    </form>
  );
}
