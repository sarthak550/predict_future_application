"use client";

/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T10) — /paper-trading/futures
 * page composition. Mirrors options-page-client.tsx's terminal-shell wiring:
 * sticky header (cash + P&L, futures unrealized deliberately not folded into
 * "today's trading P&L" — see queries.ts's doc comment), the underlying's spot
 * chart LEFT, the futures contract table (near/next/far, basis vs spot) CENTER,
 * a DOCKED order ticket RIGHT (margin + leverage + disclaimer always visible),
 * a futures-only PositionsStrip pinned bottom (mirrors the options page's
 * "this screen's own asset class only" posture — mixed positions live on the
 * main dashboard).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { PriceChart, type PricePoint } from "@/components/finance/price-chart";
import {
  FuturesContractTable,
  type FuturesQuoteSnapshot,
  type SelectedFuturesContract
} from "@/components/paper-trading/futures-contract-table";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { DockedOrderTicket } from "@/components/paper-trading/terminal/docked-order-ticket";
import { PositionsStrip, type PositionChip } from "@/components/paper-trading/terminal/positions-strip";
import { TerminalHeader } from "@/components/paper-trading/terminal/terminal-header";
import { TerminalShell } from "@/components/paper-trading/terminal/terminal-shell";
import type { PlacedFuturesOrderPayload } from "@/lib/paperTrading/futuresOrdersClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LoadState = "loading" | "signed-out" | "ready";

interface FuturesPositionSummary {
  underlyingSymbol: string;
  expiryDate: string;
  side: "LONG" | "SHORT";
  lots: number;
  todayMtmPnl: number | null;
}

interface AccountSummary {
  cash: number;
  totalValue: number;
  todayNetPnl: number;
  lifetimeNetPnl: number;
  futuresPositions: FuturesPositionSummary[];
  totalFuturesMarginRequired: number;
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const EMPTY_SERIES: PricePoint[] = [];

export function FuturesPageClient() {
  const searchParams = useSearchParams();
  return <FuturesPageClientInner key={searchParams.toString()} />;
}

function FuturesPageClientInner() {
  const searchParams = useSearchParams();
  const deepLinkUnderlying = searchParams.get("underlying");
  const deepLinkExpiry = searchParams.get("expiry");
  const deepLinkSide = searchParams.get("side") === "SELL" ? ("SELL" as const) : searchParams.get("side") === "BUY" ? ("BUY" as const) : null;

  const [state, setState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState("");

  const [underlying, setUnderlying] = useState<string>(deepLinkUnderlying ?? "NIFTY");
  const [selectedContract, setSelectedContract] = useState<SelectedFuturesContract | null>(null);
  const [presetSide, setPresetSide] = useState<"BUY" | "SELL">(deepLinkSide ?? "BUY");
  const [presetLots, setPresetLots] = useState(1);
  const [selectionNonce, setSelectionNonce] = useState(0);
  const [spot, setSpot] = useState<number | null>(null);

  const [lastOrder, setLastOrder] = useState<PlacedFuturesOrderPayload | null>(null);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-trading/account");
      if (!res.ok) {
        setError("Couldn't load your Paper Trading account.");
        return;
      }
      const data = await res.json();
      const a = data.account;
      setAccount({
        cash: a?.cash ?? 0,
        totalValue: a?.totalValue ?? a?.cash ?? 0,
        todayNetPnl: a?.todayNetPnl ?? 0,
        lifetimeNetPnl: a?.lifetimeNetPnl ?? 0,
        futuresPositions: (a?.futuresPositions ?? []).map(
          (p: { underlyingSymbol: string; expiryDate: string; side: "LONG" | "SHORT"; lots: number; todayMtmPnl: number | null }) => ({
            underlyingSymbol: p.underlyingSymbol,
            expiryDate: p.expiryDate,
            side: p.side,
            lots: p.lots,
            todayMtmPnl: p.todayMtmPnl
          })
        ),
        totalFuturesMarginRequired: a?.totalFuturesMarginRequired ?? 0
      });
    } catch {
      setError("Couldn't load your Paper Trading account — check your connection.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const sessionRes = await fetch("/api/auth/session").catch(() => null);
      const session = sessionRes?.ok ? await sessionRes.json().catch(() => null) : null;
      if (cancelled) return;
      if (!session?.user) {
        setState("signed-out");
        return;
      }
      await loadAccount();
      if (!cancelled) setState("ready");
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [loadAccount]);

  // Best-effort spot value for the "basis vs spot" column — reuses the
  // already-public, already-battle-tested options-expiry/chain endpoints
  // purely for their `underlyingValue` field (spot), polled implicitly via
  // FuturesContractTable's own 30s cadence triggering a re-run through
  // underlying changes; refreshed independently here on underlying change.
  useEffect(() => {
    let cancelled = false;
    setSpot(null);
    async function loadSpot() {
      try {
        const expiriesRes = await fetch(`/api/paper-trading/options/expiries?underlying=${underlying}`);
        if (!expiriesRes.ok) return;
        const expiriesData = await expiriesRes.json();
        const nearest = Array.isArray(expiriesData?.expiries) ? expiriesData.expiries[0] : null;
        if (!nearest || cancelled) return;
        const chainRes = await fetch(`/api/paper-trading/options/chain?underlying=${underlying}&expiry=${encodeURIComponent(nearest)}`);
        if (!chainRes.ok) return;
        const chainData = await chainRes.json();
        if (!cancelled && typeof chainData?.underlyingValue === "number") setSpot(chainData.underlyingValue);
      } catch {
        // Best-effort — the contract table's basis column just renders "—" without it.
      }
    }
    void loadSpot();
    const interval = setInterval(loadSpot, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [underlying]);

  const getHeldPosition = useCallback(
    (u: string, expiry: string): { lots: number; side: "LONG" | "SHORT" } | null => {
      if (!account) return null;
      const match = account.futuresPositions.find(
        (p) => p.underlyingSymbol === u && p.expiryDate && formatNseExpiryDate(new Date(p.expiryDate)) === expiry
      );
      return match ? { lots: match.lots, side: match.side } : null;
    },
    [account]
  );

  function handleSelectContract(contract: SelectedFuturesContract, side: "BUY" | "SELL") {
    const held = getHeldPosition(contract.underlying, contract.expiry);
    const isClosing = held != null && ((held.side === "LONG" && side === "SELL") || (held.side === "SHORT" && side === "BUY"));
    setSelectedContract(contract);
    setPresetSide(side);
    setPresetLots(isClosing ? Math.max(1, Math.min(1, held!.lots)) : 1);
    setSelectionNonce((n) => n + 1);
  }

  // Deep-link auto-select: once the contract table reports a live quote whose
  // near-month expiry matches the deep-linked expiry (or when no expiry was
  // specified, the near month), pre-fill the ticket — mirrors options-page-
  // client.tsx's autoSelectedRef one-shot pattern, keyed on the outer
  // component remount (page.tsx keys the whole client on the query string).
  const [autoSelected, setAutoSelected] = useState(false);
  function handleQuoteData(quote: FuturesQuoteSnapshot) {
    if (autoSelected || !deepLinkUnderlying || quote.underlying !== deepLinkUnderlying) return;
    const contracts = quote.allContracts.length > 0 ? quote.allContracts : [{ expiry: quote.expiry, price: quote.price, lotSize: quote.lotSize, openInterest: quote.openInterest, changePercent: quote.changePercent }];
    const target = deepLinkExpiry ? contracts.find((c) => c.expiry === deepLinkExpiry) : contracts[0];
    if (!target || target.lotSize == null) return;
    setAutoSelected(true);
    handleSelectContract(
      { underlying: quote.underlying, expiry: target.expiry, price: target.price, lotSize: target.lotSize, source: quote.source, spot },
      deepLinkSide ?? "BUY"
    );
  }

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-ink-500">Loading…</CardContent>
      </Card>
    );
  }

  if (state === "signed-out") {
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>Sign in to trade futures</CardTitle>
          <CardDescription>Your Paper Trading account is tied to your Predict Future account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in?callbackUrl=%2Fpaper-trading%2Ffutures">
            <Button variant="primary">Sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!account) return null;

  const heldForSelected = selectedContract ? getHeldPosition(selectedContract.underlying, selectedContract.expiry) : null;

  const positionChips: PositionChip[] = account.futuresPositions.map(
    (p): PositionChip => ({
      kind: "future",
      underlyingSymbol: p.underlyingSymbol,
      expiryDate: p.expiryDate,
      side: p.side,
      lots: p.lots,
      todayMtmPnl: p.todayMtmPnl
    })
  );

  const indexIntradaySource = { url: `/api/instruments/index/${underlying}/intraday` };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {lastOrder && (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/60 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Order filled — {lastOrder.side} {lastOrder.lots} lot(s) × {lastOrder.underlyingSymbol} FUT
          </p>
          <p className="mt-2 text-lg font-semibold text-ink-900">
            Margin required {formatRupees(lastOrder.marginRequired)} ({lastOrder.impliedLeverage.toFixed(1)}x leverage) · Costs{" "}
            {formatRupees(lastOrder.totalCosts)} · Cash impact {formatRupees(lastOrder.netAmount)}
          </p>
          <p className="mt-1 text-xs text-emerald-800/80">
            {lastOrder.quoteSource === "PCP_DERIVED" ? "Filled at a price derived from option prices. " : "Filled at a live NSE price. "}
            Marked to market daily against the real NSE settlement price until closed or it expires.
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLastOrder(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <TerminalShell
        header={
          <TerminalHeader
            cash={account.cash}
            portfolioValue={account.totalValue}
            todayPnl={account.todayNetPnl}
            totalPnl={account.lifetimeNetPnl}
          />
        }
        chart={
          <div>
            <PriceChart key={underlying} symbol={underlying} series={EMPTY_SERIES} defaultTimeframe="1D" intradaySource={indexIntradaySource} />
          </div>
        }
        ladder={
          <FuturesContractTable
            underlying={underlying}
            onUnderlyingChange={(u) => {
              setUnderlying(u);
              setSelectedContract(null);
            }}
            onSelectContract={handleSelectContract}
            onQuoteData={handleQuoteData}
            spot={spot}
            getHeldLots={(u, expiry) => getHeldPosition(u, expiry)}
          />
        }
        ticket={
          <DockedOrderTicket
            kind="future"
            contract={selectedContract}
            cash={account.cash}
            heldPosition={heldForSelected}
            selectionNonce={selectionNonce}
            presetSide={presetSide}
            presetLots={presetLots}
            onOrderPlaced={(order) => {
              setLastOrder(order);
              void loadAccount();
            }}
          />
        }
        positions={<PositionsStrip positions={positionChips} />}
      />

      <div className="rounded-[24px] border border-ink-100 bg-white p-5 text-xs leading-5 text-ink-500">
        <p className="font-medium text-ink-700">Why no stock futures yet?</p>
        <p className="mt-1">
          Live futures prices are reliable for all 5 index futures, but the direct feed only covers a small slice of
          the ~200-name stock-futures universe — the rest would need a synthesized price on order entry, which is a
          meaningfully weaker &quot;honest fill&quot; than everything else in Paper Trading. We&apos;d rather ship
          index futures honestly now than stock futures on shaky pricing.
        </p>
      </div>

      <PaperTradingDisclaimerFooter />
    </div>
  );
}
