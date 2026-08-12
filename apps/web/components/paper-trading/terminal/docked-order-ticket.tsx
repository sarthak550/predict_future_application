"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T4/T6) — the docked order ticket
 * itself: always visible in the terminal shell's right-hand column (desktop),
 * never an appear/disappear card. Two modes via `kind`:
 *
 *   - "equity": chrome only, wraps the EXISTING NewTradeForm unmodified —
 *     the equity side needed no new submit logic (per the brief: "chart +
 *     simple buy/sell ticket, no ladder... it just needs the chart and the
 *     docking").
 *   - "option": a NEW OptionTicketBody (below) that handles a NULLABLE
 *     contract (the docked ticket is visible even before any ladder tap —
 *     "select a contract" empty state) and a preset side/lots that the
 *     ladder's [B]/[S] chips push in via `selectionNonce`. Its cost math and
 *     submit call are UNCHANGED from option-trade-panel.tsx — same
 *     computeOptionOrderCosts call, same extracted submitOptionOrder()
 *     helper (see lib/paperTrading/optionOrdersClient.ts) — only the chrome
 *     and the pre-fill trigger are new.
 *   - "index-view-only": Index Universe SPRINT B (2026-08-12), founder:
 *     "even though the Indices are not tradable we should be able to get
 *     their charts... when something non-tradable they open, the disclaimer
 *     that it's not traded should be there with buy/sell getting disabled."
 *     A NEW, deliberately separate body (`IndexViewOnlyTicketBody`, below) —
 *     NOT a `disabled` prop threaded through `NewTradeForm`, which owns real
 *     submit/validation logic this mode must never accidentally reach (a
 *     disabled-but-still-wired form is a bigger regression surface than a
 *     small inert lookalike). Visually mirrors the equity ticket's Buy/Sell
 *     segmented control + quantity stepper shape (so the ticket panel
 *     doesn't visually "jump" when the focused symbol becomes a view-only
 *     index) but every control is `disabled` and nothing here ever calls an
 *     order-placement endpoint. Renders an inline disclaimer, plus — when
 *     the index has registry-confirmed tracking ETFs — a "trade via ETF"
 *     pointer to the equity ticket instead.
 */
import { useEffect, useRef, useState } from "react";

import { computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatOptionContractLabel, isIndexOptionUnderlying, parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { computeFuturesOrderCosts } from "@predict-future/business-rules/papertrading/futuresCosts";
import { computeFuturesMarginRequired, INDEX_FUTURES_MARGIN_RATE } from "@predict-future/business-rules/papertrading/futuresMargin";
import { formatFuturesContractLabel, formatFuturesContractSymbol } from "@predict-future/business-rules/papertrading/futuresContract";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import type { PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";
import { NewTradeForm, type PlacedOrderPayload } from "@/components/paper-trading/new-trade-form";
import type { SelectedContract } from "@/components/paper-trading/option-chain-browser";
import type { SelectedFuturesContract } from "@/components/paper-trading/futures-contract-table";
import { Button } from "@/components/ui/button";
import { submitOptionOrder } from "@/lib/paperTrading/optionOrdersClient";
import { submitFuturesOrder, type PlacedFuturesOrderPayload } from "@/lib/paperTrading/futuresOrdersClient";
import { submitPendingOrder, type PendingOrderPayload } from "@/lib/paperTrading/pendingOrdersClient";
import { rememberLotsForContract } from "@/lib/paperTrading/lastLotsMemory";

const FUTURES_MARGIN_DISCLAIMER =
  "Margin shown is an approximate, conservative simulator estimate — real SPAN margin changes daily and may be lower. Never size a real trade off this number.";

function DockedTicketChrome({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-[24px] border border-ink-100 bg-white lg:sticky lg:top-24">
      <div className="border-b border-ink-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">Order ticket</p>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
    </div>
  );
}

interface EquityTicketProps {
  kind: "equity";
  cash: number;
  heldDeliveryQtyBySymbol: Record<string, number>;
  hasSoldDeliveryTodayBySymbol: Record<string, boolean>;
  initialSymbol: string | null;
  initialSide: "BUY" | "SELL";
  initialProductType: "DELIVERY" | "INTRADAY";
  /** Delivery-holdings Sell button (2026-08-04) — passed straight through to NewTradeForm's own mount-time initializer. See that component's doc for why this isn't part of the preset-nonce channel below. */
  initialQuantity?: number | null;
  linkedOpinionId: string | null;
  onOrderPlaced: (order: PlacedOrderPayload) => void;
  /** Limit Orders (Sprint, 2026-07-26) — optional so callers that haven't wired a pending-orders section still compile; the Limit toggle itself only renders when this is provided (see NewTradeForm). */
  onPendingOrderPlaced?: (order: PendingOrderPayload) => void;
  /** Chart Trading + SL/TP (Sprint B) — chart-click preset channel, passed straight through to NewTradeForm. See that component's own doc for the full contract. */
  presetNonce?: number;
  presetSide?: "BUY" | "SELL";
  presetOrderType?: "MARKET" | "LIMIT" | "STOP";
  presetLimitPrice?: number;
  presetTriggerPrice?: number;
  /** Founder bug fix (2026-08-04b) — the terminal chart's own live quote tick for this symbol, passed straight through to NewTradeForm (see that component's own doc for the full contract). */
  liveLtp?: number | null;
}

interface OptionTicketProps {
  kind: "option";
  contract: SelectedContract | null;
  cash: number;
  heldLots: number;
  linkedOpinionId?: string | null;
  /** Bumped by the parent on every ladder [B]/[S] tap OR a premium-chart click (Sprint B) — the ticket syncs its local side/lots from presetSide/presetLots exactly when this changes, decoupled from `contract`'s own object identity (which now changes on TWO independent poll tickers for the SAME selected contract — the chain browser's own 30s poll and, as of 2026-08-07b, a dedicated ~15s selected-contract poll during market hours — see options-page-client.tsx's own doc). */
  selectionNonce: number;
  presetSide: "BUY" | "SELL";
  presetLots: number;
  onOrderPlaced: (order: PlacedOptionOrderPayload) => void;
  /** Limit Orders (Sprint, 2026-07-26) — optional, same "toggle only renders when provided" gating as the equity ticket. */
  onPendingOrderPlaced?: (order: PendingOrderPayload) => void;
  /**
   * Chart Trading + SL/TP (Sprint B, B4) — set ONLY by a premium-chart click,
   * never by a ladder tap. When present, the nonce-sync effect applies this
   * order type + price instead of resetting to MARKET (decision 4 of the
   * Sprint B brief: "stop resetting orderType when presets are supplied").
   * The caller must reset these to `undefined` before the next ladder tap's
   * nonce bump, or that tap would incorrectly preserve a stale chart preset.
   */
  presetOrderType?: "MARKET" | "LIMIT" | "STOP";
  presetLimitPrice?: number;
  presetTriggerPrice?: number;
}

interface FuturesTicketProps {
  kind: "future";
  contract: SelectedFuturesContract | null;
  cash: number;
  /** The account's held lots/direction for this EXACT contract (underlying+expiry), if any — null when flat. */
  heldPosition: { lots: number; side: "LONG" | "SHORT" } | null;
  selectionNonce: number;
  presetSide: "BUY" | "SELL";
  presetLots: number;
  onOrderPlaced: (order: PlacedFuturesOrderPayload) => void;
  /** Chart Trading + SL/TP (Sprint B) — optional, same "toggle only renders when provided" gating as the equity/option tickets; the Limit/Stop toggle is unavailable when omitted. */
  onPendingOrderPlaced?: (order: PendingOrderPayload) => void;
  /** Same chart-click-only preset convention as OptionTicketProps above. */
  presetOrderType?: "MARKET" | "LIMIT" | "STOP";
  presetLimitPrice?: number;
  presetTriggerPrice?: number;
}

interface IndexViewOnlyTicketProps {
  kind: "index-view-only";
  /** `/instruments/[symbol]` code (e.g. "NIFTYIT") — display only, this ticket never submits anything. */
  symbol: string;
  displayName: string;
  /** Registry-confirmed ETFs tracking this index (`getEtfsTrackingIndex`), for the "trade via ETF" pointer — empty array (never omitted) when none exist. */
  trackingEtfs: { symbol: string; displayName: string }[];
  /** Switches the equity ticket to the clicked ETF's symbol in place. Optional so a bare caller degrades to plain (non-clickable) ETF text rather than a crash. */
  onTradeEtf?: (symbol: string) => void;
  /**
   * Derivatives gate follow-up (2026-08-12c), founder: "the charts for
   * tradable indices are not accessible — they are blocked since options and
   * futures are disabled for now." `true` for one of the 5 F&O underlyings
   * (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50) landing in this
   * view-only ticket ONLY because `PAPER_TRADING_OPTIONS_ENABLED`/
   * `PAPER_TRADING_FUTURES_ENABLED` are currently off (see
   * `paper-trading-dashboard.tsx`'s `handleWorkbenchSymbolPick`/
   * `handleDockedIndexPick` — they never set `focusedIndexSymbol` for a
   * tradable underlying unless its route is gated) — `false` (default) for
   * a genuinely-never-tradable `INDEX_UNIVERSE`/`BSE_INDEX_UNIVERSE` index.
   * Swaps the "not tradable, ever" copy for "coming soon" copy — same inert
   * fieldset, same ETF pointer, different words, since the underlying truth
   * is different (a launch flag flip away vs. structurally never tradable).
   */
  comingSoon?: boolean;
}

export type DockedOrderTicketProps = EquityTicketProps | OptionTicketProps | FuturesTicketProps | IndexViewOnlyTicketProps;

export function DockedOrderTicket(props: DockedOrderTicketProps) {
  if (props.kind === "equity") {
    return (
      <DockedTicketChrome subtitle="Stocks — buy shares for delivery, or trade intraday">
        <NewTradeForm
          cash={props.cash}
          heldDeliveryQtyBySymbol={props.heldDeliveryQtyBySymbol}
          hasSoldDeliveryTodayBySymbol={props.hasSoldDeliveryTodayBySymbol}
          initialSymbol={props.initialSymbol}
          fixedSymbol={props.initialSymbol}
          initialSide={props.initialSide}
          initialProductType={props.initialProductType}
          initialQuantity={props.initialQuantity}
          linkedOpinionId={props.linkedOpinionId}
          onOrderPlaced={props.onOrderPlaced}
          onPendingOrderPlaced={props.onPendingOrderPlaced}
          presetNonce={props.presetNonce}
          presetSide={props.presetSide}
          presetOrderType={props.presetOrderType}
          presetLimitPrice={props.presetLimitPrice}
          presetTriggerPrice={props.presetTriggerPrice}
          liveLtp={props.liveLtp}
        />
      </DockedTicketChrome>
    );
  }

  if (props.kind === "index-view-only") {
    return (
      <DockedTicketChrome subtitle={`${props.displayName} — ${props.comingSoon ? "derivatives coming soon" : "index, not tradable"}`}>
        <IndexViewOnlyTicketBody
          symbol={props.symbol}
          displayName={props.displayName}
          trackingEtfs={props.trackingEtfs}
          onTradeEtf={props.onTradeEtf}
          comingSoon={props.comingSoon}
        />
      </DockedTicketChrome>
    );
  }

  if (props.kind === "future") {
    return (
      <DockedTicketChrome subtitle={props.contract ? undefined : "Tap B or S in the contract table to begin"}>
        <FuturesTicketBody
          contract={props.contract}
          cash={props.cash}
          heldPosition={props.heldPosition}
          selectionNonce={props.selectionNonce}
          presetSide={props.presetSide}
          presetLots={props.presetLots}
          onOrderPlaced={props.onOrderPlaced}
          onPendingOrderPlaced={props.onPendingOrderPlaced}
          presetOrderType={props.presetOrderType}
          presetLimitPrice={props.presetLimitPrice}
          presetTriggerPrice={props.presetTriggerPrice}
        />
      </DockedTicketChrome>
    );
  }

  return (
    <DockedTicketChrome subtitle={props.contract ? undefined : "Tap a contract in the chain to begin"}>
      <OptionTicketBody
        contract={props.contract}
        cash={props.cash}
        heldLots={props.heldLots}
        linkedOpinionId={props.linkedOpinionId ?? null}
        selectionNonce={props.selectionNonce}
        presetSide={props.presetSide}
        presetLots={props.presetLots}
        onOrderPlaced={props.onOrderPlaced}
        onPendingOrderPlaced={props.onPendingOrderPlaced}
        presetOrderType={props.presetOrderType}
        presetLimitPrice={props.presetLimitPrice}
        presetTriggerPrice={props.presetTriggerPrice}
      />
    </DockedTicketChrome>
  );
}

function OptionTicketBody({
  contract,
  cash,
  heldLots,
  linkedOpinionId,
  selectionNonce,
  presetSide,
  presetLots,
  onOrderPlaced,
  onPendingOrderPlaced,
  presetOrderType,
  presetLimitPrice,
  presetTriggerPrice
}: {
  contract: SelectedContract | null;
  cash: number;
  heldLots: number;
  linkedOpinionId: string | null;
  selectionNonce: number;
  presetSide: "BUY" | "SELL";
  presetLots: number;
  onOrderPlaced: (order: PlacedOptionOrderPayload) => void;
  onPendingOrderPlaced?: (order: PendingOrderPayload) => void;
  presetOrderType?: "MARKET" | "LIMIT" | "STOP";
  presetLimitPrice?: number;
  presetTriggerPrice?: number;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">(presetSide);
  const [lots, setLots] = useState(presetLots);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // Limit Orders (Sprint, 2026-07-26) — Market/Limit toggle, widened to
  // Market/Limit/STOP by Chart Trading + SL/TP (Sprint B). Market mode's
  // submitOptionOrder call is untouched.
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">(presetOrderType ?? "MARKET");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  // Mount-computed, not render-computed — matches this domain's established
  // convention for a time-dependent value (see option-trade-panel.tsx's
  // identical pattern) so SSR and hydration agree.
  const [marketClosed, setMarketClosed] = useState(false);
  useEffect(() => {
    setMarketClosed(!isNseWeekdayMarketHours());
  }, []);

  // A ladder [B]/[S] tap OR a premium-chart click (Sprint B, B4) bumps
  // selectionNonce — sync local side/lots from the parent's preset exactly
  // then, never on every re-render (which would wipe out a lots value the
  // user is mid-adjusting) and never merely because `contract`'s object
  // identity changed on a routine chain poll (the chain browser's own 30s
  // poll, or the dedicated ~15s selected-contract poll — 2026-08-07b).
  //
  // Chart Trading + SL/TP (Sprint B) — a ladder tap never supplies
  // `presetOrderType` (undefined), so this keeps resetting to MARKET exactly
  // as before Sprint B (zero regression). A premium-chart click DOES supply
  // it, and per decision 4 of the Sprint B brief the sync must apply that
  // order type/price rather than wiping it back to MARKET.
  const lastSyncedNonce = useRef(-1);
  useEffect(() => {
    if (selectionNonce === lastSyncedNonce.current) return;
    lastSyncedNonce.current = selectionNonce;
    setSide(presetSide);
    setLots(presetLots);
    setFormError("");
    if (presetOrderType) {
      setOrderType(presetOrderType);
      setLimitPrice(presetOrderType === "LIMIT" && presetLimitPrice != null ? String(presetLimitPrice) : "");
      setTriggerPrice(presetOrderType === "STOP" && presetTriggerPrice != null ? String(presetTriggerPrice) : "");
    } else {
      setOrderType("MARKET");
      setLimitPrice("");
      setTriggerPrice("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionNonce]);

  if (!contract) {
    return (
      <p className="text-sm text-ink-400">
        Tap <span className="font-medium text-ink-600">B</span> or <span className="font-medium text-ink-600">S</span> next to any strike
        in the chain to pre-fill an order here.
      </p>
    );
  }

  const quantity = lots * contract.lotSize;
  const limitPriceNumber = Number(limitPrice);
  const validLimitPrice = limitPrice.trim() !== "" && Number.isFinite(limitPriceNumber) && limitPriceNumber > 0;
  const triggerPriceNumber = Number(triggerPrice);
  const validTriggerPrice = triggerPrice.trim() !== "" && Number.isFinite(triggerPriceNumber) && triggerPriceNumber > 0;
  const estimatePrice =
    orderType === "MARKET"
      ? contract.premium
      : orderType === "LIMIT"
        ? (validLimitPrice ? limitPriceNumber : contract.premium)
        : validTriggerPrice
          ? triggerPriceNumber
          : contract.premium;
  const estimate = computeOptionOrderCosts({ side, quantity, price: estimatePrice });
  const insufficientCash = side === "BUY" && estimate.netAmount > cash;
  const exceedsHolding = side === "SELL" && lots > heldLots;
  const limitDistancePct = orderType === "LIMIT" && validLimitPrice ? ((limitPriceNumber - contract.premium) / contract.premium) * 100 : null;
  const triggerDistancePct = orderType === "STOP" && validTriggerPrice ? ((triggerPriceNumber - contract.premium) / contract.premium) * 100 : null;

  const contractDate = parseExpiryDisplayDate(contract.expiry);
  const contractLabel = contractDate
    ? formatOptionContractLabel(contract.underlying, contract.strikePrice, contract.optionType, contractDate)
    : `${contract.underlying} ${contract.strikePrice} ${contract.optionType}, ${contract.expiry}`;
  const isStockOption = !isIndexOptionUnderlying(contract.underlying);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || exceedsHolding || !contract) return;
    if (orderType === "MARKET" && insufficientCash) return;
    if (orderType === "LIMIT" && !validLimitPrice) return;
    if (orderType === "STOP" && !validTriggerPrice) return;
    setFormError("");
    setSubmitting(true);
    try {
      if (orderType === "LIMIT" || orderType === "STOP") {
        const result = await submitPendingOrder({
          orderKind: "OPTION",
          underlyingSymbol: contract.underlying,
          optionType: contract.optionType,
          strikePrice: contract.strikePrice,
          expiryDate: contract.expiry,
          side,
          lots,
          variant: orderType,
          ...(orderType === "LIMIT" ? { limitPrice: limitPriceNumber } : { triggerPrice: triggerPriceNumber }),
          linkedOpinionId
        });
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        onPendingOrderPlaced?.(result.order);
        return;
      }

      const result = await submitOptionOrder({
        underlyingSymbol: contract.underlying,
        optionType: contract.optionType,
        strikePrice: contract.strikePrice,
        expiryDate: contract.expiry,
        side,
        lots,
        linkedOpinionId
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      rememberLotsForContract(contract.underlying, contract.strikePrice, contract.optionType, contract.expiry, lots);
      onOrderPlaced(result.order);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-ink-900">{contractLabel}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          Live premium ₹{contract.premium.toLocaleString("en-IN")} · Lot size {contract.lotSize} · Spot{" "}
          {contract.underlyingValue.toLocaleString("en-IN")}
        </p>
        {isStockOption && (
          <p className="mt-2 text-xs leading-5 text-amber-700">
            Physically settled at expiry — we close open positions before expiry rather than take delivery.
          </p>
        )}
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setSide("BUY")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              side === "BUY" ? "bg-emerald-600 text-white" : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => heldLots > 0 && setSide("SELL")}
            disabled={heldLots === 0}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:text-ink-300 ${
              side === "SELL" ? "bg-rose-600 text-white" : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Sell
          </button>
        </div>

        {heldLots > 0 && (
          <p className="text-xs text-ink-400">You hold {heldLots} lot(s) of this contract — Sell closes some or all of it.</p>
        )}

        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-600">Lots</span>
          <div className="inline-flex items-center rounded-2xl border border-ink-200">
            <button
              type="button"
              onClick={() => setLots((v) => Math.max(1, v - 1))}
              disabled={submitting}
              className="h-11 w-11 text-lg text-ink-600 hover:text-ink-900 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-14 text-center text-sm font-medium text-ink-900">{lots}</span>
            <button
              type="button"
              onClick={() => setLots((v) => (side === "SELL" ? Math.min(heldLots, v + 1) : v + 1))}
              disabled={submitting || (side === "SELL" && lots >= heldLots)}
              className="h-11 w-11 text-lg text-ink-600 hover:text-ink-900 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <span className="text-xs text-ink-400">= {quantity.toLocaleString("en-IN")} units</span>
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
              <button
                type="button"
                onClick={() => setOrderType("STOP")}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  orderType === "STOP" ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
                }`}
              >
                Stop
              </button>
            </div>
            {orderType === "LIMIT" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Limit premium"
                  disabled={submitting}
                  className="w-28 rounded-xl border border-ink-200 px-3 py-1.5 text-sm"
                />
                {limitDistancePct !== null && (
                  <span className={`text-xs ${limitDistancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {limitDistancePct >= 0 ? "+" : ""}
                    {limitDistancePct.toFixed(2)}% vs premium
                  </span>
                )}
              </div>
            )}
            {orderType === "STOP" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.05"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value)}
                  placeholder="Trigger premium"
                  disabled={submitting}
                  className="w-28 rounded-xl border border-ink-200 px-3 py-1.5 text-sm"
                />
                {triggerDistancePct !== null && (
                  <span className={`text-xs ${triggerDistancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {triggerDistancePct >= 0 ? "+" : ""}
                    {triggerDistancePct.toFixed(2)}% vs premium
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {orderType === "LIMIT" && (
          <p className="text-xs leading-5 text-ink-500">
            Fills only when the delayed premium reaches ₹{validLimitPrice ? limitPriceNumber.toLocaleString("en-IN") : "your limit"} — at
            your limit price, never a better one. Blocked now; expires at today&apos;s session close if unfilled.
          </p>
        )}
        {orderType === "STOP" && (
          <p className="text-xs leading-5 text-ink-500">
            Fills at the delayed premium observed when it crosses ₹
            {validTriggerPrice ? triggerPriceNumber.toLocaleString("en-IN") : "your trigger"} — that crossing premium
            may be better or worse than your trigger, it is never guaranteed to fill exactly at it. Blocked now
            against the trigger premium; if the actual crossing premium would make this order infeasible, it&apos;s
            rejected (never filled into negative cash) — you&apos;ll see why in Pending orders. Expires at
            today&apos;s session close if unfilled.
          </p>
        )}

        <CostBreakdownTable breakdown={estimate} side={side} />

        {orderType === "MARKET" && insufficientCash && (
          <p className="text-xs text-rose-600">
            Estimated total (₹{estimate.netAmount.toLocaleString("en-IN")}) exceeds your available cash (₹{cash.toLocaleString("en-IN")}).
          </p>
        )}
        {exceedsHolding && (
          <p className="text-xs text-rose-600">
            You hold {heldLots} lot(s) — can&apos;t sell {lots}.
          </p>
        )}
        {marketClosed && orderType === "MARKET" && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Market closed — orders fill only during NSE hours, 09:15–15:30 IST Mon–Fri.
          </p>
        )}
        {formError && <p className="text-xs text-rose-600">{formError}</p>}

        <Button
          type="submit"
          variant={side === "BUY" ? "primary" : "danger"}
          disabled={
            submitting ||
            exceedsHolding ||
            (orderType === "MARKET" ? insufficientCash : orderType === "LIMIT" ? !validLimitPrice : !validTriggerPrice)
          }
        >
          {submitting
            ? "Placing order…"
            : orderType === "LIMIT"
              ? `Place ${side.toLowerCase()} limit order`
              : orderType === "STOP"
                ? `Place ${side.toLowerCase()} stop order`
                : `Confirm ${side.toLowerCase()} order`}
        </Button>
      </form>
    </div>
  );
}

/**
 * Index Universe SPRINT B (2026-08-12) — see this file's own module doc for
 * why this is a separate, deliberately inert body rather than a `disabled`
 * prop threaded through `NewTradeForm`. Wrapped in a native `<fieldset
 * disabled>` (belt-and-suspenders alongside each control's own `disabled`
 * attribute) — no control here can ever be interacted with regardless of
 * whether a future edit forgets one spot's own disabled prop, and no
 * click handler in this function ever calls an order-placement endpoint.
 */
function IndexViewOnlyTicketBody({
  symbol,
  displayName,
  trackingEtfs,
  onTradeEtf,
  comingSoon
}: {
  symbol: string;
  displayName: string;
  trackingEtfs: { symbol: string; displayName: string }[];
  onTradeEtf?: (symbol: string) => void;
  /** Derivatives gate follow-up (2026-08-12c) — see `IndexViewOnlyTicketProps.comingSoon`'s own doc. */
  comingSoon?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-ink-900">{displayName}</p>
        <p className="mt-0.5 text-xs text-ink-500">{symbol} · Index</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
        {comingSoon
          ? `${displayName} derivatives trading is coming soon — chart and analyze meanwhile.`
          : "Indices aren't directly tradable — chart and analyze here, then trade via the index's constituent stocks or an index ETF."}
        {trackingEtfs.length > 0 && (
          <>
            {" "}
            Trade via ETF:{" "}
            {trackingEtfs.map((etf, i) => (
              <span key={etf.symbol}>
                {i > 0 && ", "}
                {onTradeEtf ? (
                  <button
                    type="button"
                    onClick={() => onTradeEtf(etf.symbol)}
                    className="font-semibold underline underline-offset-2 hover:text-amber-900"
                    title={etf.displayName}
                  >
                    {etf.symbol}
                  </button>
                ) : (
                  <span className="font-semibold">{etf.symbol}</span>
                )}
              </span>
            ))}
          </>
        )}
      </div>

      <fieldset disabled className="space-y-4">
        <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1 opacity-50">
          <button type="button" disabled className="cursor-not-allowed rounded-xl px-4 py-2 text-sm font-medium text-ink-600">
            Buy
          </button>
          <button type="button" disabled className="cursor-not-allowed rounded-xl px-4 py-2 text-sm font-medium text-ink-600">
            Sell
          </button>
        </div>

        <div className="flex items-center gap-3 opacity-50">
          <span className="text-sm text-ink-600">Quantity</span>
          <div className="inline-flex items-center rounded-2xl border border-ink-200">
            <button type="button" disabled className="h-11 w-11 cursor-not-allowed text-lg text-ink-400">
              −
            </button>
            <input
              type="text"
              value=""
              disabled
              placeholder="0"
              className="w-14 cursor-not-allowed border-0 bg-transparent text-center text-sm font-medium text-ink-400"
            />
            <button type="button" disabled className="h-11 w-11 cursor-not-allowed text-lg text-ink-400">
              +
            </button>
          </div>
        </div>

        <Button type="button" variant="primary" disabled className="w-full cursor-not-allowed">
          {comingSoon ? "Coming soon" : "Not tradable"}
        </Button>
      </fieldset>
    </div>
  );
}

const IMPLIED_FUTURES_LEVERAGE = 1 / INDEX_FUTURES_MARGIN_RATE;

function FuturesTicketBody({
  contract,
  cash,
  heldPosition,
  selectionNonce,
  presetSide,
  presetLots,
  onOrderPlaced,
  onPendingOrderPlaced,
  presetOrderType,
  presetLimitPrice,
  presetTriggerPrice
}: {
  contract: SelectedFuturesContract | null;
  cash: number;
  heldPosition: { lots: number; side: "LONG" | "SHORT" } | null;
  selectionNonce: number;
  presetSide: "BUY" | "SELL";
  presetLots: number;
  onOrderPlaced: (order: PlacedFuturesOrderPayload) => void;
  onPendingOrderPlaced?: (order: PendingOrderPayload) => void;
  presetOrderType?: "MARKET" | "LIMIT" | "STOP";
  presetLimitPrice?: number;
  presetTriggerPrice?: number;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">(presetSide);
  const [lots, setLots] = useState(presetLots);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [marketClosed, setMarketClosed] = useState(false);
  useEffect(() => {
    setMarketClosed(!isNseWeekdayMarketHours());
  }, []);
  // Chart Trading + SL/TP (Sprint B) — futures previously had no pending-order
  // path at all (Sprint A added it); MARKET/LIMIT/STOP toggle, same shape as
  // the equity/option tickets. MARKET mode's submitFuturesOrder call is
  // untouched.
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">(presetOrderType ?? "MARKET");
  const [limitPrice, setLimitPrice] = useState(presetLimitPrice != null ? String(presetLimitPrice) : "");
  const [triggerPrice, setTriggerPrice] = useState(presetTriggerPrice != null ? String(presetTriggerPrice) : "");

  // A ladder [B]/[S] tap never supplies `presetOrderType` (resets to MARKET,
  // same as before Sprint B); the futures chart's click-to-prefill DOES
  // supply it and must be preserved, not wiped — same "preserve, don't
  // reset" convention as the option ticket's nonce-sync above.
  const lastSyncedNonce = useRef(-1);
  useEffect(() => {
    if (selectionNonce === lastSyncedNonce.current) return;
    lastSyncedNonce.current = selectionNonce;
    setSide(presetSide);
    setLots(presetLots);
    setFormError("");
    if (presetOrderType) {
      setOrderType(presetOrderType);
      setLimitPrice(presetOrderType === "LIMIT" && presetLimitPrice != null ? String(presetLimitPrice) : "");
      setTriggerPrice(presetOrderType === "STOP" && presetTriggerPrice != null ? String(presetTriggerPrice) : "");
    } else {
      setOrderType("MARKET");
      setLimitPrice("");
      setTriggerPrice("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionNonce]);

  if (!contract) {
    return (
      <p className="text-sm text-ink-400">
        Tap <span className="font-medium text-ink-600">B</span> or <span className="font-medium text-ink-600">S</span> next to any
        contract month in the table to pre-fill an order here.
      </p>
    );
  }

  // Is this order (in the direction currently selected) closing/reducing the
  // held position at this exact contract, or opening/adding to one? Mirrors
  // futuresOrders.ts's (T7) server-side isOpeningOrAdding derivation exactly —
  // this client-side estimate is UX-only, the server route is the sole
  // authority on margin/holding validation.
  const isClosing = heldPosition != null && ((heldPosition.side === "LONG" && side === "SELL") || (heldPosition.side === "SHORT" && side === "BUY"));
  const exceedsHolding = isClosing && lots > (heldPosition?.lots ?? 0);

  const quantity = lots * contract.lotSize;
  const limitPriceNumber = Number(limitPrice);
  const validLimitPrice = limitPrice.trim() !== "" && Number.isFinite(limitPriceNumber) && limitPriceNumber > 0;
  const triggerPriceNumber = Number(triggerPrice);
  const validTriggerPrice = triggerPrice.trim() !== "" && Number.isFinite(triggerPriceNumber) && triggerPriceNumber > 0;
  // The price the margin/costs preview is computed against — the live
  // contract price in Market mode, the user's own limit/trigger price
  // otherwise (a pending futures order blocks margin against ITS OWN price,
  // never the live quote — see pendingOrders.ts's web placement doc).
  const estimatePrice =
    orderType === "MARKET"
      ? contract.price
      : orderType === "LIMIT"
        ? (validLimitPrice ? limitPriceNumber : contract.price)
        : validTriggerPrice
          ? triggerPriceNumber
          : contract.price;
  const costs = computeFuturesOrderCosts({ side, quantity, price: estimatePrice });
  const notional = quantity * estimatePrice;
  const marginRequired = computeFuturesMarginRequired(notional);
  const limitDistancePct = orderType === "LIMIT" && validLimitPrice ? ((limitPriceNumber - contract.price) / contract.price) * 100 : null;
  const triggerDistancePct = orderType === "STOP" && validTriggerPrice ? ((triggerPriceNumber - contract.price) / contract.price) * 100 : null;

  // Soft client-side pre-check ONLY — cash here doesn't know about OTHER open
  // positions' margin usage (the docked ticket isn't handed the full account
  // read). The server route (futuresOrders.ts / pendingOrders.ts) is the
  // authoritative, aggregate-margin check; this just avoids an
  // obviously-doomed submit.
  const likelyInsufficientMargin = !isClosing && cash < marginRequired + costs.totalCosts;

  const expiryDate = parseNseExpiryDate(contract.expiry);
  const contractLabel = expiryDate
    ? formatFuturesContractLabel(contract.underlying, expiryDate)
    : `${contract.underlying} FUT, ${contract.expiry}`;
  const contractSymbol = expiryDate ? formatFuturesContractSymbol(contract.underlying, expiryDate) : contract.underlying;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || exceedsHolding || !contract) return;
    if (orderType === "LIMIT" && !validLimitPrice) return;
    if (orderType === "STOP" && !validTriggerPrice) return;
    setFormError("");
    setSubmitting(true);
    try {
      if (orderType === "LIMIT" || orderType === "STOP") {
        const result = await submitPendingOrder({
          orderKind: "FUTURE",
          underlyingSymbol: contract.underlying,
          expiryDate: contract.expiry,
          side,
          lots,
          variant: orderType,
          ...(orderType === "LIMIT" ? { limitPrice: limitPriceNumber } : { triggerPrice: triggerPriceNumber })
        });
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        onPendingOrderPlaced?.(result.order);
        return;
      }

      const result = await submitFuturesOrder({
        underlyingSymbol: contract.underlying,
        expiryDate: contract.expiry,
        side,
        lots
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onOrderPlaced(result.order);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-ink-900">{contractLabel}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {contract.source === "LIVE" ? "Live price" : "Derived price"} ₹{contract.price.toLocaleString("en-IN")}
          {contract.source === "PCP_DERIVED" && (
            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
              derived from option prices
            </span>
          )}{" "}
          · Lot size {contract.lotSize} · {contractSymbol}
        </p>
        {heldPosition && (
          <p className="mt-2 text-xs text-ink-500">
            You hold {heldPosition.lots} lot(s) {heldPosition.side} of this contract.
          </p>
        )}
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setSide("BUY")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              side === "BUY" ? "bg-emerald-600 text-white" : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setSide("SELL")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              side === "SELL" ? "bg-rose-600 text-white" : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Sell
          </button>
        </div>
        <p className="text-xs text-ink-400">
          {isClosing
            ? `Closes some or all of your held ${heldPosition?.side.toLowerCase()} position.`
            : "Both directions open a new (or add to an existing) position — long and short are both offered on index futures."}
        </p>

        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-600">Lots</span>
          <div className="inline-flex items-center rounded-2xl border border-ink-200">
            <button
              type="button"
              onClick={() => setLots((v) => Math.max(1, v - 1))}
              disabled={submitting}
              className="h-11 w-11 text-lg text-ink-600 hover:text-ink-900 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-14 text-center text-sm font-medium text-ink-900">{lots}</span>
            <button
              type="button"
              onClick={() => setLots((v) => v + 1)}
              disabled={submitting}
              className="h-11 w-11 text-lg text-ink-600 hover:text-ink-900 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <span className="text-xs text-ink-400">= {quantity.toLocaleString("en-IN")} units</span>
        </div>

        {onPendingOrderPlaced && (
          <div className="flex flex-wrap items-center gap-3">
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
              <button
                type="button"
                onClick={() => setOrderType("STOP")}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  orderType === "STOP" ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
                }`}
              >
                Stop
              </button>
            </div>
            {orderType === "LIMIT" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Limit price"
                  disabled={submitting}
                  className="w-28 rounded-xl border border-ink-200 px-3 py-1.5 text-sm"
                />
                {limitDistancePct !== null && (
                  <span className={`text-xs ${limitDistancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {limitDistancePct >= 0 ? "+" : ""}
                    {limitDistancePct.toFixed(2)}% vs price
                  </span>
                )}
              </div>
            )}
            {orderType === "STOP" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.05"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value)}
                  placeholder="Trigger price"
                  disabled={submitting}
                  className="w-28 rounded-xl border border-ink-200 px-3 py-1.5 text-sm"
                />
                {triggerDistancePct !== null && (
                  <span className={`text-xs ${triggerDistancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {triggerDistancePct >= 0 ? "+" : ""}
                    {triggerDistancePct.toFixed(2)}% vs price
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {orderType === "LIMIT" && (
          <p className="text-xs leading-5 text-ink-500">
            Fills only when the delayed contract price reaches ₹
            {validLimitPrice ? limitPriceNumber.toLocaleString("en-IN") : "your limit"} — at your limit price, never a
            better one. Margin is reserved now against the limit price; expires at today&apos;s session close if
            unfilled.
          </p>
        )}
        {orderType === "STOP" && (
          <p className="text-xs leading-5 text-ink-500">
            Fills at the delayed contract price observed when it crosses ₹
            {validTriggerPrice ? triggerPriceNumber.toLocaleString("en-IN") : "your trigger"} — that crossing price
            may be better or worse than your trigger, it is never guaranteed to fill exactly at it. Margin is
            reserved now against the trigger price; if the actual crossing price would make this order infeasible
            (insufficient margin), it&apos;s rejected (never filled) — you&apos;ll see why in Pending orders. Expires
            at today&apos;s session close if unfilled.
          </p>
        )}

        <div className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4 text-sm">
          <div className="flex items-center justify-between text-ink-700">
            <span>Notional value</span>
            <span className="font-medium">₹{notional.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-ink-700">
            <span>Margin required (15%, conservative)</span>
            <span className="font-medium">₹{marginRequired.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-ink-700">
            <span>Implied leverage</span>
            <span className="font-medium">{IMPLIED_FUTURES_LEVERAGE.toFixed(1)}x</span>
          </div>
          <div className="mt-2 space-y-1 border-t border-ink-100 pt-2 text-ink-600">
            <div className="flex items-center justify-between">
              <span>Brokerage</span>
              <span>₹{costs.brokerage.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>STT</span>
              <span>₹{costs.stt.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Exchange + SEBI + stamp + GST</span>
              <span>₹{(costs.exchangeCharge + costs.sebiFee + costs.stampDuty + costs.gst).toFixed(2)}</span>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-ink-200 pt-2 font-medium text-ink-900">
            <span>Total costs</span>
            <span>₹{costs.totalCosts.toFixed(2)}</span>
          </div>
          {!isClosing && (
            <div className="mt-2 flex items-center justify-between border-t border-ink-200 pt-2 text-base font-semibold text-ink-900">
              <span>Margin + costs needed</span>
              <span>₹{(marginRequired + costs.totalCosts).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>

        <p className="rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-4 text-ink-500">{FUTURES_MARGIN_DISCLAIMER}</p>

        {likelyInsufficientMargin && (
          <p className="text-xs text-rose-600">
            This looks like more margin than your available cash (₹{cash.toLocaleString("en-IN")}) covers — the order may be rejected;
            final check happens on submit.
          </p>
        )}
        {exceedsHolding && (
          <p className="text-xs text-rose-600">
            You hold {heldPosition?.lots ?? 0} lot(s) — can&apos;t close {lots} in one order.
          </p>
        )}
        {marketClosed && orderType === "MARKET" && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Market closed — orders fill only during NSE hours, 09:15–15:30 IST Mon–Fri.
          </p>
        )}
        {formError && <p className="text-xs text-rose-600">{formError}</p>}

        <Button
          type="submit"
          variant={side === "BUY" ? "primary" : "danger"}
          disabled={
            submitting ||
            exceedsHolding ||
            (orderType === "LIMIT" ? !validLimitPrice : orderType === "STOP" ? !validTriggerPrice : false)
          }
        >
          {submitting
            ? "Placing order…"
            : orderType === "LIMIT"
              ? `Place ${side.toLowerCase()} limit order`
              : orderType === "STOP"
                ? `Place ${side.toLowerCase()} stop order`
                : `Confirm ${side.toLowerCase()} order`}
        </Button>
      </form>
    </div>
  );
}

function parseExpiryDisplayDate(expiry: string): Date | null {
  const match = expiry.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const [, dd, mon, yyyy] = match;
  const monthIndex = months.indexOf(mon.toUpperCase());
  if (monthIndex < 0) return null;
  return new Date(Date.UTC(Number(yyyy), monthIndex, Number(dd)));
}
