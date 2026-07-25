"use client";

/**
 * Paper Trading Phase 2 (index options) + Phase 3 (stock options) —
 * /paper-trading/options page composition.
 *
 * Trading Terminal UI Overhaul (Sprint A, T6/T7) — rebuilt onto the shared
 * terminal shell: sticky header (spot + day/total P&L + cash), the
 * underlying's spot chart LEFT, the restyled option chain (inline [B]/[S]
 * chips) CENTER, a DOCKED order ticket RIGHT that never disappears
 * off-screen, and a shared PositionsStrip (equity + option mixed) pinned
 * bottom. Every [B]/[S] tap pre-fills the ticket for one explicit Confirm —
 * that is the only order path.
 *
 * `?underlying=&optionType=&linkedOpinionId=` (PaperTradeCta's "Trade options
 * on this call") and `?underlying=&expiry=&strike=&optionType=&side=SELL`
 * (the positions-table Sell action) are both still read via useSearchParams()
 * and threaded into OptionChainBrowser exactly as before — the chain
 * browser's own deep-link auto-select logic is UNCHANGED (only its row
 * rendering changed, per the brief's explicit "no changes to
 * OptionChainBrowser's data-fetching/polling/flash logic" constraint).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { PriceChart, type PricePoint } from "@/components/finance/price-chart";
import { OptionChainBrowser, type OptionChainSnapshot, type SelectedContract } from "@/components/paper-trading/option-chain-browser";
import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import type { PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { DockedOrderTicket } from "@/components/paper-trading/terminal/docked-order-ticket";
import { PositionsStrip, type PositionChip } from "@/components/paper-trading/terminal/positions-strip";
import { TerminalHeader, type TerminalSpotQuote } from "@/components/paper-trading/terminal/terminal-header";
import { TerminalShell } from "@/components/paper-trading/terminal/terminal-shell";
import { useEodSeries } from "@/components/paper-trading/terminal/use-eod-series";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLastLotsForContract } from "@/lib/paperTrading/lastLotsMemory";

type LoadState = "loading" | "signed-out" | "ready";

interface EquityPositionSummary {
  symbol: string;
  productType: "DELIVERY" | "INTRADAY";
  quantity: number;
  netPnl: number | null;
}

interface OptionPositionSummary {
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  lots: number;
  netPnl: number | null;
}

interface AccountSummary {
  cash: number;
  todayNetPnl: number;
  lifetimeNetPnl: number;
  deliveryHoldings: EquityPositionSummary[];
  openIntradayPositions: EquityPositionSummary[];
  optionPositions: OptionPositionSummary[];
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** ISO expiryDate string (from the JSON API response) -> NSE "DD-MMM-YYYY" format, to compare against SelectedContract.expiry (which is already in NSE format from the chain browser). */
function formatExpiryFromIso(iso: string): string {
  return formatNseExpiryDate(new Date(iso));
}

function isIndexUnderlying(symbol: string): boolean {
  return symbol === "NIFTY" || symbol === "BANKNIFTY";
}

/**
 * Trading Terminal UI Overhaul (Sprint A, T6) — keys the INNER composition on
 * the query string, so a NEW deep-link (e.g. the positions-strip's Sell tap
 * while ALREADY on this page) gets a fresh mount instead of being silently
 * swallowed by `OptionsPageClientInner`'s own one-shot `autoSelectedRef`,
 * which is only ever evaluated once per component instance. A full inner
 * remount is a deliberate, low-risk trade-off for a low-frequency,
 * deliberate user action (this is a signed-in personal utility page, not a
 * hot path) — same reasoning documented inline on `autoSelectedRef` below.
 *
 * (Express mode lived here in the first Sprint A cut; the founder cut the
 * feature on 2026-07-25 — every ladder tap now pre-fills the docked ticket
 * for one explicit Confirm, no instant-fill path exists.)
 */
export function OptionsPageClient() {
  const searchParams = useSearchParams();
  return <OptionsPageClientInner key={searchParams.toString()} />;
}

function OptionsPageClientInner() {
  const searchParams = useSearchParams();
  const deepLinkUnderlying = searchParams.get("underlying");
  const deepLinkOptionTypeRaw = searchParams.get("optionType");
  const deepLinkOptionType = deepLinkOptionTypeRaw === "CE" || deepLinkOptionTypeRaw === "PE" ? deepLinkOptionTypeRaw : null;
  const deepLinkOpinionId = searchParams.get("linkedOpinionId");
  const deepLinkExpiry = searchParams.get("expiry");
  const deepLinkStrikeRaw = searchParams.get("strike");
  const deepLinkStrike = deepLinkStrikeRaw != null && deepLinkStrikeRaw !== "" ? Number(deepLinkStrikeRaw) : null;
  const deepLinkSide = searchParams.get("side") === "SELL" ? ("SELL" as const) : null;

  const [state, setState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState("");

  const [selectedContract, setSelectedContract] = useState<SelectedContract | null>(null);
  const [presetSide, setPresetSide] = useState<"BUY" | "SELL">(deepLinkSide ?? "BUY");
  const [presetLots, setPresetLots] = useState(1);
  const [selectionNonce, setSelectionNonce] = useState(0);

  const [lastOrder, setLastOrder] = useState<PlacedOptionOrderPayload | null>(null);

  const [chartUnderlying, setChartUnderlying] = useState<string | null>(deepLinkUnderlying);
  const [chartQuote, setChartQuote] = useState<TerminalSpotQuote | null>(null);

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
        todayNetPnl: a?.todayNetPnl ?? 0,
        lifetimeNetPnl: a?.lifetimeNetPnl ?? 0,
        deliveryHoldings: (a?.deliveryHoldings ?? []).map((h: { symbol: string; quantity: number; netPnl: number | null }) => ({
          symbol: h.symbol,
          productType: "DELIVERY" as const,
          quantity: h.quantity,
          netPnl: h.netPnl
        })),
        openIntradayPositions: (a?.openIntradayPositions ?? []).map((h: { symbol: string; quantity: number; netPnl: number | null }) => ({
          symbol: h.symbol,
          productType: "INTRADAY" as const,
          quantity: h.quantity,
          netPnl: h.netPnl
        })),
        optionPositions: a?.optionPositions ?? []
      });
    } catch {
      setError("Couldn't load your Paper Trading account — check your connection.");
    }
  }, []);

  // Positions/cash tick along with the chain instead of freezing until a manual
  // refresh — paused while the tab is hidden.
  useVisiblePolling(() => void loadAccount(), 60_000, state === "ready");

  // One-shot guard: the Sell/opinion deep-link auto-opens its contract on the
  // FIRST matching chain snapshot only — after that the user owns the
  // selection. (page.tsx keys this whole component on the query string, so a
  // NEW deep-link tap while already on this page gets a fresh instance of
  // this ref rather than being silently swallowed by a stale "already used"
  // guard.)
  const autoSelectedRef = useRef(false);

  const handleChainData = useCallback(
    (chain: OptionChainSnapshot) => {
      setChartUnderlying((prev) => (prev === chain.underlying ? prev : chain.underlying));

      if (
        !autoSelectedRef.current &&
        deepLinkUnderlying &&
        deepLinkExpiry &&
        deepLinkStrike != null &&
        Number.isFinite(deepLinkStrike) &&
        deepLinkOptionType &&
        chain.underlying === deepLinkUnderlying &&
        chain.expiry === deepLinkExpiry &&
        chain.lotSize
      ) {
        const row = chain.strikes.find((s) => s.strikePrice === deepLinkStrike);
        const quote = row?.[deepLinkOptionType];
        if (quote?.lastPrice != null && quote.lastPrice > 0) {
          autoSelectedRef.current = true;
          setSelectedContract({
            underlying: chain.underlying,
            expiry: chain.expiry,
            strikePrice: deepLinkStrike,
            optionType: deepLinkOptionType,
            premium: quote.lastPrice,
            lotSize: chain.lotSize,
            underlyingValue: chain.underlyingValue
          });
          setPresetSide(deepLinkSide ?? "BUY");
          setPresetLots(1);
          setSelectionNonce((n) => n + 1);
          return;
        }
      }
      setSelectedContract((selected) => {
        if (!selected || selected.underlying !== chain.underlying || selected.expiry !== chain.expiry) return selected;
        const row = chain.strikes.find((s) => s.strikePrice === selected.strikePrice);
        const livePremium = row?.[selected.optionType]?.lastPrice;
        if (livePremium == null || livePremium <= 0) return selected;
        if (livePremium === selected.premium && chain.underlyingValue === selected.underlyingValue) return selected;
        return { ...selected, premium: livePremium, underlyingValue: chain.underlyingValue };
      });
    },
    [deepLinkUnderlying, deepLinkExpiry, deepLinkStrike, deepLinkOptionType, deepLinkSide]
  );

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

  const getHeldLots = useCallback(
    (underlying: string, strikePrice: number, optionType: "CE" | "PE", expiry: string): number => {
      if (!account) return 0;
      return (
        account.optionPositions.find(
          (p) =>
            p.underlyingSymbol === underlying &&
            p.strikePrice === strikePrice &&
            p.optionType === optionType &&
            formatExpiryFromIso(p.expiryDate) === expiry
        )?.lots ?? 0
      );
    },
    [account]
  );

  function openTicketForLadderTap(contract: SelectedContract, side: "BUY" | "SELL") {
    const held = side === "SELL" ? getHeldLots(contract.underlying, contract.strikePrice, contract.optionType, contract.expiry) : 0;
    if (side === "SELL" && held <= 0) return; // defensive — the chip should already be disabled
    const remembered = getLastLotsForContract(contract.underlying, contract.strikePrice, contract.optionType, contract.expiry) ?? 1;
    const lots = side === "SELL" ? Math.max(1, Math.min(remembered, held)) : Math.max(1, remembered);
    setSelectedContract(contract);
    setPresetSide(side);
    setPresetLots(lots);
    setSelectionNonce((n) => n + 1);
  }

  // Every ladder [B]/[S] tap pre-fills the docked ticket for one explicit
  // Confirm — the only order path. (Express instant-fill was cut 2026-07-25.)
  const handleLadderAction = openTicketForLadderTap;

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
          <CardTitle>Sign in to trade options</CardTitle>
          <CardDescription>Your Paper Trading account is tied to your Predict Future account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in?callbackUrl=%2Fpaper-trading%2Foptions">
            <Button variant="primary">Sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!account) return null;

  const heldLotsForSelected = selectedContract
    ? getHeldLots(selectedContract.underlying, selectedContract.strikePrice, selectedContract.optionType, selectedContract.expiry)
    : 0;

  const isIndexChart = chartUnderlying != null && isIndexUnderlying(chartUnderlying);

  const positionChips: PositionChip[] = [
    ...account.deliveryHoldings.map((h): PositionChip => ({ kind: "equity", symbol: h.symbol, productType: h.productType, quantity: h.quantity, netPnl: h.netPnl })),
    ...account.openIntradayPositions.map((h): PositionChip => ({ kind: "equity", symbol: h.symbol, productType: h.productType, quantity: h.quantity, netPnl: h.netPnl })),
    ...account.optionPositions.map(
      (o): PositionChip => ({
        kind: "option",
        underlyingSymbol: o.underlyingSymbol,
        optionType: o.optionType,
        strikePrice: o.strikePrice,
        expiryDate: o.expiryDate,
        lots: o.lots,
        netPnl: o.netPnl
      })
    )
  ];

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {lastOrder && (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/60 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Order filled — {lastOrder.side} {lastOrder.lots} lot(s) × {lastOrder.underlyingSymbol} {lastOrder.strikePrice}{" "}
            {lastOrder.optionType}
          </p>
          <p className="mt-2 text-lg font-semibold text-ink-900">
            Gross {formatRupees(lastOrder.grossAmount)} → Costs {formatRupees(lastOrder.totalCosts)} →{" "}
            {lastOrder.side === "BUY" ? "You paid" : "You received"} {formatRupees(lastOrder.netAmount)}
          </p>
          <p className="mt-1 text-xs text-emerald-800/80">
            {lastOrder.instrumentKind === "STOCK_OPTION"
              ? "Squares off before expiry close — stock options are physically settled, we won't take delivery."
              : "Cash-settled at intrinsic value on expiry day."}
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLastOrder(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <TerminalShell
        header={
          <TerminalHeader
            title={selectedContract ? `${selectedContract.underlying} ${selectedContract.strikePrice} ${selectedContract.optionType}` : chartUnderlying ?? ""}
            spot={chartQuote}
            cash={account.cash}
            todayPnl={account.todayNetPnl}
            totalPnl={account.lifetimeNetPnl}
          />
        }
        chart={<OptionsUnderlyingChart underlying={chartUnderlying} isIndex={isIndexChart} onQuoteChange={setChartQuote} />}
        ladder={
          <OptionChainBrowser
            onSelectContract={handleLadderAction}
            onChainData={handleChainData}
            initialUnderlying={deepLinkUnderlying}
            initialOptionType={deepLinkOptionType}
            initialExpiry={deepLinkExpiry}
            getHeldLots={getHeldLots}
          />
        }
        ticket={
          <DockedOrderTicket
            kind="option"
            contract={selectedContract}
            cash={account.cash}
            heldLots={heldLotsForSelected}
            linkedOpinionId={deepLinkOpinionId}
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

      <PaperTradingDisclaimerFooter />
    </div>
  );
}

/**
 * Underlying spot chart pane. Index underlying (NIFTY/BANKNIFTY): the NEW
 * index-intraday path (T2) via PriceChart's `intradaySource` prop, defaulted
 * to the 1D timeframe (no EOD series exists for an index in this app — see
 * PriceChart's own doc comment on `defaultTimeframe`). Stock underlying: the
 * EXISTING equity PriceChart, unmodified default 1D path, plus a fetched EOD
 * series for the other timeframes.
 */
/** Stable empty series for the index chart — an inline `[]` would be a fresh identity every render, which (before PriceChart's primitive-keyed quote effect) was the exact fuel for a render-loop tab freeze. Belt and braces: keep props referentially stable anyway. */
const EMPTY_SERIES: PricePoint[] = [];

function OptionsUnderlyingChart({
  underlying,
  isIndex,
  onQuoteChange
}: {
  underlying: string | null;
  isIndex: boolean;
  onQuoteChange: (quote: TerminalSpotQuote | null) => void;
}) {
  const stockEodSeries = useEodSeries(!isIndex ? underlying : null);
  const indexIntradaySource = useMemo(
    () => (underlying ? { url: `/api/instruments/index/${underlying}/intraday` } : undefined),
    [underlying]
  );

  if (!underlying) {
    return <p className="text-sm text-ink-400">Select an underlying in the chain below to see its chart.</p>;
  }

  if (isIndex) {
    return (
      <PriceChart
        key={underlying}
        symbol={underlying}
        series={EMPTY_SERIES}
        defaultTimeframe="1D"
        intradaySource={indexIntradaySource}
        onQuoteChange={onQuoteChange}
      />
    );
  }

  return <PriceChart key={underlying} symbol={underlying} series={stockEodSeries} onQuoteChange={onQuoteChange} />;
}
