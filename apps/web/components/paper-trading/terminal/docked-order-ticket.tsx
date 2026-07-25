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
 */
import { useEffect, useRef, useState } from "react";

import { computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatOptionContractLabel, isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import type { PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";
import { NewTradeForm, type PlacedOrderPayload } from "@/components/paper-trading/new-trade-form";
import type { SelectedContract } from "@/components/paper-trading/option-chain-browser";
import { Button } from "@/components/ui/button";
import { submitOptionOrder } from "@/lib/paperTrading/optionOrdersClient";
import { rememberLotsForContract } from "@/lib/paperTrading/lastLotsMemory";

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
  linkedOpinionId: string | null;
  onOrderPlaced: (order: PlacedOrderPayload) => void;
}

interface OptionTicketProps {
  kind: "option";
  contract: SelectedContract | null;
  cash: number;
  heldLots: number;
  linkedOpinionId?: string | null;
  /** Bumped by the parent on every ladder [B]/[S] tap — the ticket syncs its local side/lots from presetSide/presetLots exactly when this changes, decoupled from `contract`'s own object identity (which changes on every ~30s poll tick even for the SAME selected contract). */
  selectionNonce: number;
  presetSide: "BUY" | "SELL";
  presetLots: number;
  onOrderPlaced: (order: PlacedOptionOrderPayload) => void;
}

export type DockedOrderTicketProps = EquityTicketProps | OptionTicketProps;

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
          linkedOpinionId={props.linkedOpinionId}
          onOrderPlaced={props.onOrderPlaced}
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
  onOrderPlaced
}: {
  contract: SelectedContract | null;
  cash: number;
  heldLots: number;
  linkedOpinionId: string | null;
  selectionNonce: number;
  presetSide: "BUY" | "SELL";
  presetLots: number;
  onOrderPlaced: (order: PlacedOptionOrderPayload) => void;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">(presetSide);
  const [lots, setLots] = useState(presetLots);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // Mount-computed, not render-computed — matches this domain's established
  // convention for a time-dependent value (see option-trade-panel.tsx's
  // identical pattern) so SSR and hydration agree.
  const [marketClosed, setMarketClosed] = useState(false);
  useEffect(() => {
    setMarketClosed(!isNseWeekdayMarketHours());
  }, []);

  // A ladder [B]/[S] tap bumps selectionNonce — sync local side/lots from the
  // parent's preset exactly then, never on every re-render (which would wipe
  // out a lots value the user is mid-adjusting) and never merely because
  // `contract`'s object identity changed on a routine ~30s chain poll.
  const lastSyncedNonce = useRef(-1);
  useEffect(() => {
    if (selectionNonce === lastSyncedNonce.current) return;
    lastSyncedNonce.current = selectionNonce;
    setSide(presetSide);
    setLots(presetLots);
    setFormError("");
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
  const estimate = computeOptionOrderCosts({ side, quantity, price: contract.premium });
  const insufficientCash = side === "BUY" && estimate.netAmount > cash;
  const exceedsHolding = side === "SELL" && lots > heldLots;

  const contractDate = parseExpiryDisplayDate(contract.expiry);
  const contractLabel = contractDate
    ? formatOptionContractLabel(contract.underlying, contract.strikePrice, contract.optionType, contractDate)
    : `${contract.underlying} ${contract.strikePrice} ${contract.optionType}, ${contract.expiry}`;
  const isStockOption = !isIndexOptionUnderlying(contract.underlying);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || insufficientCash || exceedsHolding || !contract) return;
    setFormError("");
    setSubmitting(true);
    try {
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

        <CostBreakdownTable breakdown={estimate} side={side} />

        {insufficientCash && (
          <p className="text-xs text-rose-600">
            Estimated total (₹{estimate.netAmount.toLocaleString("en-IN")}) exceeds your available cash (₹{cash.toLocaleString("en-IN")}).
          </p>
        )}
        {exceedsHolding && (
          <p className="text-xs text-rose-600">
            You hold {heldLots} lot(s) — can&apos;t sell {lots}.
          </p>
        )}
        {marketClosed && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Market closed — orders fill only during NSE hours, 09:15–15:30 IST Mon–Fri.
          </p>
        )}
        {formError && <p className="text-xs text-rose-600">{formError}</p>}

        <Button type="submit" variant={side === "BUY" ? "primary" : "danger"} disabled={submitting || insufficientCash || exceedsHolding}>
          {submitting ? "Placing order…" : `Confirm ${side.toLowerCase()} order`}
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
