"use client";

/**
 * Paper Trading Phase 2 — options trade panel (T8). Same "live pre-trade cost
 * estimate before confirm" pattern as Phase 1's New Trade form: the estimate
 * calls computeOptionOrderCosts() — the SAME pure function
 * lib/paperTrading/optionOrders.ts calls server-side at fill time — directly in
 * the browser, against the premium the chain browser (T7) already fetched. No
 * separate "preview" API route: estimate and fill are provably the same
 * computation.
 *
 * Lots stepper increments in whole lots (never a raw unit quantity) — the live
 * `lotSize` from the selected contract, never a hardcoded step (see the
 * contract-specs section of the Phase 2 brief on why lot size must never be
 * hardcoded anywhere in this feature).
 *
 * SELL is long-only enforcement's client-side mirror: a SELL is only offered
 * (and only submittable) up to `heldLots` for the exact selected contract — the
 * server independently re-validates this (see optionOrders.ts's naked-write
 * guardrail), this is purely the UX-level guidance + the T9 explainer for why
 * writing/selling isn't offered at all beyond an existing long.
 */
import { useState } from "react";

import { computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatOptionContractLabel } from "@predict-future/business-rules/papertrading/optionContract";

import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { Button } from "@/components/ui/button";
import type { SelectedContract } from "@/components/paper-trading/option-chain-browser";

export interface PlacedOptionOrderPayload {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  lotSize: number;
  lots: number;
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

export function OptionTradePanel({
  contract,
  cash,
  heldLots,
  onOrderPlaced,
  onClose
}: {
  contract: SelectedContract;
  /** Available cash right now, for the client-side insufficient-cash warning (server re-validates independently). */
  cash: number;
  /** Lots currently held for this EXACT contract (0 if none) — determines whether SELL is even offered. */
  heldLots: number;
  onOrderPlaced: (order: PlacedOptionOrderPayload) => void;
  onClose: () => void;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [lots, setLots] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showWhySection, setShowWhySection] = useState(false);

  const quantity = lots * contract.lotSize;
  const estimate = computeOptionOrderCosts({ side, quantity, price: contract.premium });
  const insufficientCash = side === "BUY" && estimate.netAmount > cash;
  const exceedsHolding = side === "SELL" && lots > heldLots;

  const contractDate = parseExpiryDisplayDate(contract.expiry);
  const contractLabel = contractDate
    ? formatOptionContractLabel(contract.underlying, contract.strikePrice, contract.optionType, contractDate)
    : `${contract.underlying} ${contract.strikePrice} ${contract.optionType}, ${contract.expiry}`;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || insufficientCash || exceedsHolding) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/paper-trading/options/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          underlyingSymbol: contract.underlying,
          optionType: contract.optionType,
          strikePrice: contract.strikePrice,
          expiryDate: contract.expiry,
          side,
          lots
        })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setFormError(payload.error ?? "Couldn't place that order.");
        return;
      }
      const data = await res.json();
      onOrderPlaced(data.order);
    } catch {
      setFormError("Couldn't place that order — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 rounded-[24px] border border-ink-100 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">Trade panel</p>
          <p className="mt-1 text-lg font-semibold text-ink-900">{contractLabel}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Live premium ₹{contract.premium.toLocaleString("en-IN")} · Lot size {contract.lotSize} · Spot{" "}
            {contract.underlyingValue.toLocaleString("en-IN")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
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

        {heldLots === 0 && (
          <p className="text-xs text-ink-400">
            You don&apos;t hold this contract, so only Buy is available.{" "}
            <button type="button" onClick={() => setShowWhySection((v) => !v)} className="underline hover:text-ink-700">
              Why can&apos;t I sell/write options?
            </button>
          </p>
        )}
        {heldLots > 0 && (
          <p className="text-xs text-ink-400">You hold {heldLots} lot(s) of this contract — Sell closes some or all of it.</p>
        )}

        {showWhySection && <WhyNoWritingExplainer />}

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
            Estimated total (₹{estimate.netAmount.toLocaleString("en-IN")}) exceeds your available cash (₹
            {cash.toLocaleString("en-IN")}).
          </p>
        )}
        {exceedsHolding && (
          <p className="text-xs text-rose-600">
            You hold {heldLots} lot(s) — can&apos;t sell {lots}.
          </p>
        )}
        {formError && <p className="text-xs text-rose-600">{formError}</p>}

        <Button type="submit" variant={side === "BUY" ? "primary" : "danger"} disabled={submitting || insufficientCash || exceedsHolding}>
          {submitting ? "Placing order…" : `Place ${side.toLowerCase()} order`}
        </Button>
      </form>
    </div>
  );
}

/** T9 — the honest "why can't I sell options" explainer, reachable from the trade panel per the brief's acceptance criteria (not buried only in the page footer). */
export function WhyNoWritingExplainer() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
      <p>
        Writing (selling) options isn&apos;t offered here. Writing carries theoretically unlimited loss and needs real
        exchange margin (SPAN + exposure margin) to size responsibly — we don&apos;t have a path to simulate that
        honestly, and a made-up margin number would be worse than not having the feature.
      </p>
      <p className="mt-2">
        For a bearish view, buy a PE instead (already covered above), or use Phase 1&apos;s existing INTRADAY equity
        shorting on a bearish single stock from the main{" "}
        <a href="/paper-trading" className="underline">
          Paper Trading
        </a>{" "}
        dashboard.
      </p>
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
