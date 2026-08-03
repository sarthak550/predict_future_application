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
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, B4) — the chart slot now
 * carries an Underlying/Contract-premium toggle: "Underlying" is the
 * existing index/stock spot chart (default, unchanged), "Contract premium"
 * is the NEW `PremiumChart` (terminal/premium-chart.tsx) for the currently
 * selected contract — order lines, click-to-prefill, and the position
 * avg-premium line all attach ONLY to the premium chart, never mixed onto
 * the underlying view (decision 6 of the Sprint B brief).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatNseExpiryDate, isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

import { PriceChart, type ChartOrderLine, type PricePoint } from "@/components/finance/price-chart";
import { EMPTY_ORDER_LINES } from "@/components/finance/chart-order-lines";
import { OptionChainBrowser, type OptionChainSnapshot, type SelectedContract } from "@/components/paper-trading/option-chain-browser";
import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import type { PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { InstrumentContextCard } from "@/components/paper-trading/instrument-context-card";
import { PendingOrdersPanel } from "@/components/paper-trading/pending-orders-panel";
import { DockedOrderTicket } from "@/components/paper-trading/terminal/docked-order-ticket";
import { PositionsStrip, type PositionChip } from "@/components/paper-trading/terminal/positions-strip";
import { TerminalHeader } from "@/components/paper-trading/terminal/terminal-header";
import { TerminalShell } from "@/components/paper-trading/terminal/terminal-shell";
import { PremiumChart } from "@/components/paper-trading/terminal/premium-chart";
import { useEodSeries } from "@/components/paper-trading/terminal/use-eod-series";
import { usePriceOverrides } from "@/components/paper-trading/use-price-overrides";
import { DynamicChartWorkbench, WorkbenchMaximizeButton } from "@/components/paper-trading/workbench/workbench-maximize-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLastLotsForContract } from "@/lib/paperTrading/lastLotsMemory";
import { cancelPendingOrder, repricePendingOrder, type PendingOrderPayload } from "@/lib/paperTrading/pendingOrdersClient";
import { useWorkbenchAutoRestore, useWorkbenchUrlParam } from "@/components/paper-trading/use-workbench-url-param";

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
  /** Chart Trading + SL/TP (Sprint B, B4) — the premium chart's position line needs the entry cost basis; already present on the server's OptionPositionRow, this interface just hadn't declared it. */
  avgCost: number;
  netPnl: number | null;
}

interface AccountSummary {
  cash: number;
  /** Limit Orders (Sprint, 2026-07-26) — cash - pendingBlockedCash; use this for order-ticket cash props, never raw `cash`. */
  availableCash: number;
  totalValue: number;
  todayNetPnl: number;
  lifetimeNetPnl: number;
  deliveryHoldings: EquityPositionSummary[];
  openIntradayPositions: EquityPositionSummary[];
  optionPositions: OptionPositionSummary[];
  pendingOrders: PendingOrderPayload[];
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Signed rupee format for the premium chart's position-line label (Sprint B, B4). */
function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** ISO expiryDate string (from the JSON API response) -> NSE "DD-MMM-YYYY" format, to compare against SelectedContract.expiry (which is already in NSE format from the chain browser). */
function formatExpiryFromIso(iso: string): string {
  return formatNseExpiryDate(new Date(iso));
}

function isIndexUnderlying(symbol: string): boolean {
  return isIndexOptionUnderlying(symbol);
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
  // Founder bug fix (2026-08-06) — the `?workbench=` param (see
  // use-workbench-url-param.ts) must NOT be part of this remount key, for
  // the same reason futures-page-client.tsx's identical wrapper excludes
  // it: toggling the workbench does its OWN router.replace and must not
  // blow away the selected contract / chain state / everything else just
  // to persist which chart is maximized.
  const remountKey = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workbench");
    return params.toString();
  }, [searchParams]);
  return <OptionsPageClientInner key={remountKey} />;
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
  const [pendingOrderNotice, setPendingOrderNotice] = useState<string | null>(null);

  const [chartUnderlying, setChartUnderlying] = useState<string | null>(deepLinkUnderlying);

  // Chart Trading + SL/TP (Sprint B, B4) — Underlying/Contract-premium toggle
  // + the premium chart's own click-prefill preset channel, reusing the SAME
  // `selectionNonce` the ladder taps already bump (a premium-chart click can
  // only happen once a contract is already selected, so presetSide/presetLots
  // are always already concrete by then — see openTicketForLadderTap below).
  // (Declared before the two workbench blocks below since both reference
  // `setChartMode` in their own restore callbacks.)
  const [chartMode, setChartMode] = useState<"underlying" | "premium">("underlying");
  const hasSelectedContract = selectedContract != null;
  // Keyed on the PRIMITIVE "is anything selected" flag, never on
  // `selectedContract`'s own object identity (which churns every ~30s chain
  // poll even for the same contract) — falling back to "underlying" only
  // needs to happen on the null<->non-null transition, not every poll tick.
  useEffect(() => {
    if (!hasSelectedContract) setChartMode("underlying");
  }, [hasSelectedContract]);

  // Charting Workbench (W2) — the UNDERLYING chart's maximize button only
  // this sprint (the premium chart's own maximize button is explicitly W3 —
  // see the founder plan §9, entry point 4). See paper-trading-dashboard.tsx
  // for the ticket single-mount reasoning. Closed on an underlying change so
  // a stale workbench for the PREVIOUS underlying never lingers, and closed
  // if the user switches to the premium chart mode (the workbench only ever
  // shows the underlying view this sprint, so it can't stay meaningfully
  // open across that toggle).
  //
  // Founder bug fix (2026-08-06) — refresh-persistence: this page has TWO
  // workbenches (underlying + premium), so the single `?workbench=` param
  // carries which one — `"underlying" | "premium"` — rather than a bare
  // `"1"`. `useWorkbenchAutoRestore` handles the routine "restore once
  // `chartUnderlying` resolves, close on any REAL later change" half
  // exactly like the other 2 terminal pages; the PREMIUM half needs its own
  // fallback (below) since a premium restore additionally needs a resolved
  // `selectedContract`, which — unlike a focused symbol/underlying — has no
  // guarantee of EVER resolving on a plain refresh (see that block's doc).
  const [workbenchParam, setWorkbenchParam] = useWorkbenchUrlParam();
  const [workbenchOpen, setWorkbenchOpenState] = useState(false);
  const setWorkbenchOpen = useCallback(
    (open: boolean) => {
      setWorkbenchOpenState(open);
      setWorkbenchParam(open ? "underlying" : null);
    },
    [setWorkbenchParam]
  );
  useWorkbenchAutoRestore(
    chartUnderlying,
    workbenchParam === "underlying",
    () => {
      setChartMode("underlying");
      setWorkbenchOpenState(true);
    },
    () => setWorkbenchOpen(false)
  );

  // Charting Workbench (W3, T6) — the PREMIUM chart's own maximize button
  // (entry point 4 — order execution lives here, never on the maximized
  // underlying view, same "decision 6" split as the small charts). Closed
  // on a contract-identity change (a stale workbench for the PREVIOUS
  // contract must never linger) and whenever the user leaves premium chart
  // mode. The two workbenches (this one and the underlying's, above) are
  // mutually exclusive — see the ticket single-mount `ticket=` prop below —
  // so switching `chartMode` away from either one's own mode always closes
  // ITS workbench, never both at once.
  //
  // Founder bug fix (2026-08-06) — refresh-persistence for `?workbench=
  // premium`. The routine "restore once resolved / close on real change"
  // half is `useWorkbenchAutoRestore` again, keyed on a composite
  // contract-identity string (object identity itself churns every ~30s
  // chain poll — see the effect this replaces). But a premium restore can
  // ALSO be asked for on a URL with no way to ever resolve a contract (the
  // ladder-tap selection that put the page into premium mode originally was
  // never itself persisted to the URL — only a full contract deep-link
  // (`?underlying=&expiry=&strike=&optionType=`) can repopulate
  // `selectedContract` automatically) — the bounded fallback effect below
  // handles that: falls back to the underlying chart (or, if even THAT
  // hasn't resolved, no workbench at all) rather than leave a permanently
  // empty "waiting for a contract" premium workbench open.
  const [premiumWorkbenchOpen, setPremiumWorkbenchOpenState] = useState(false);
  const setPremiumWorkbenchOpen = useCallback(
    (open: boolean) => {
      setPremiumWorkbenchOpenState(open);
      setWorkbenchParam(open ? "premium" : null);
    },
    [setWorkbenchParam]
  );
  const contractKey = selectedContract
    ? `${selectedContract.underlying}:${selectedContract.expiry}:${selectedContract.strikePrice}:${selectedContract.optionType}`
    : null;
  useWorkbenchAutoRestore(
    contractKey,
    workbenchParam === "premium",
    () => {
      setChartMode("premium");
      setPremiumWorkbenchOpenState(true);
    },
    () => setPremiumWorkbenchOpen(false)
  );
  // Runs at most once (`consumedRef`): if the URL asked for the premium
  // chart but there's no deep-linked contract that could EVER auto-resolve
  // `selectedContract` (a plain `?workbench=premium` with no
  // `underlying/expiry/strike/optionType`), fall back immediately. If a
  // deep-linked contract IS present, give its own auto-select effect
  // (handleChainData, above) a bounded window to resolve it — an
  // expired/invalid strike would otherwise leave this waiting forever.
  const premiumFallbackConsumedRef = useRef(false);
  useEffect(() => {
    if (premiumFallbackConsumedRef.current) return;
    if (workbenchParam !== "premium") return;
    if (selectedContract) {
      premiumFallbackConsumedRef.current = true;
      return;
    }
    const hasDeepLinkContract = Boolean(
      deepLinkUnderlying && deepLinkExpiry && deepLinkStrike != null && Number.isFinite(deepLinkStrike) && deepLinkOptionType
    );
    const fallBackToUnderlying = () => {
      premiumFallbackConsumedRef.current = true;
      if (chartUnderlying) {
        setChartMode("underlying");
        setWorkbenchOpenState(true);
        setWorkbenchParam("underlying");
      } else {
        setWorkbenchParam(null);
      }
    };
    if (!hasDeepLinkContract) {
      fallBackToUnderlying();
      return;
    }
    const timer = setTimeout(() => {
      if (!premiumFallbackConsumedRef.current && !selectedContract) fallBackToUnderlying();
    }, 6_000);
    return () => clearTimeout(timer);
  }, [workbenchParam, selectedContract, chartUnderlying, deepLinkUnderlying, deepLinkExpiry, deepLinkStrike, deepLinkOptionType, setWorkbenchParam]);
  useEffect(() => {
    // Mutual exclusion between the two workbenches — guarded on the boolean
    // actually being `true` so this doesn't fire a spurious "close" (and
    // its URL write) on mount, before either restore effect above has had a
    // chance to open one from `?workbench=`.
    if (chartMode !== "underlying" && workbenchOpen) setWorkbenchOpen(false);
    if (chartMode !== "premium" && premiumWorkbenchOpen) setPremiumWorkbenchOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartMode]);
  // Sprint C, C2 widens this from LIMIT-only to LIMIT|STOP (the popover
  // confirms an explicit variant, unlike Sprint B's hardcoded LIMIT click).
  const [presetOrderType, setPresetOrderType] = useState<"LIMIT" | "STOP" | undefined>(undefined);
  const [presetLimitPrice, setPresetLimitPrice] = useState<number | undefined>(undefined);
  const [presetTriggerPrice, setPresetTriggerPrice] = useState<number | undefined>(undefined);

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
        availableCash: a?.availableCash ?? a?.cash ?? 0,
        totalValue: a?.totalValue ?? a?.cash ?? 0,
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
        optionPositions: a?.optionPositions ?? [],
        pendingOrders: a?.pendingOrders ?? []
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
    // A fresh ladder tap always starts clean — never carries a stale
    // premium-chart-click preset forward from a PREVIOUS contract.
    setPresetOrderType(undefined);
    setPresetLimitPrice(undefined);
    setPresetTriggerPrice(undefined);
    setSelectionNonce((n) => n + 1);
  }

  // Every ladder [B]/[S] tap pre-fills the docked ticket for one explicit
  // Confirm — the only order path. (Express instant-fill was cut 2026-07-25.)
  const handleLadderAction = openTicketForLadderTap;

  // Chart Trading + SL/TP (Sprint C, C2) — clicking the PREMIUM chart opens
  // the order-intent popover; confirming a choice prefills the ticket with
  // the user's explicit side/variant on the currently selected contract
  // (never the underlying spot chart, which stays click-inert — decision 6's
  // "never mixed onto the underlying view" still holds, only the click
  // MECHANISM on the premium chart itself changed this sprint).
  function handlePremiumOrderIntentConfirm(input: { price: number; side: "BUY" | "SELL"; variant: "LIMIT" | "STOP" }) {
    if (!selectedContract) return;
    setPresetSide(input.side);
    setPresetOrderType(input.variant);
    setPresetLimitPrice(input.variant === "LIMIT" ? input.price : undefined);
    setPresetTriggerPrice(input.variant === "STOP" ? input.price : undefined);
    setSelectionNonce((n) => n + 1);
  }

  function handlePremiumOrderLineCancel(id: string) {
    if (id.startsWith("position-")) return;
    void cancelPendingOrder(id).then((result) => {
      if (result.ok) void loadAccount();
    });
  }

  // Chart Trading + SL/TP (Sprint C, C1) — drag-to-reprice optimistic-UI
  // wiring, identical contract to paper-trading-dashboard.tsx's/futures-
  // page-client.tsx's (see use-price-overrides.ts's own doc for the
  // anti-snap-back reasoning). Options is the one terminal where the
  // draggable line lives on the PREMIUM chart, not the underlying spot chart.
  const currentPendingOrderPrices = useMemo(
    () => account?.pendingOrders.map((o) => ({ id: o.id, price: o.variant === "STOP" ? (o.triggerPrice ?? o.limitPrice) : o.limitPrice })) ?? [],
    [account]
  );
  const { overrides: priceOverrides, setOverride: setPriceOverride, clearOverride: clearPriceOverride } = usePriceOverrides(currentPendingOrderPrices);
  const [repriceError, setRepriceError] = useState<string | null>(null);

  async function handlePremiumOrderLineDrag(id: string, newPrice: number) {
    const order = account?.pendingOrders.find((o) => o.id === id);
    if (!order) return;
    setRepriceError(null);
    setPriceOverride(id, newPrice);
    const result = await repricePendingOrder(id, order.variant === "STOP" ? { triggerPrice: newPrice } : { limitPrice: newPrice });
    if (!result.ok) {
      clearPriceOverride(id);
      setRepriceError(result.error);
      return;
    }
    await loadAccount();
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

  // OPTION positions only — stock chips on the options screen were noise
  // (founder feedback 2026-07-25); stock positions live on the dashboard's
  // full tables.
  const positionChips: PositionChip[] = account.optionPositions.map(
    (o): PositionChip => ({
      kind: "option",
      underlyingSymbol: o.underlyingSymbol,
      optionType: o.optionType,
      strikePrice: o.strikePrice,
      expiryDate: o.expiryDate,
      lots: o.lots,
      netPnl: o.netPnl
    })
  );

  // Chart Trading + SL/TP (Sprint B, B4) — order lines for the SELECTED
  // contract's premium chart only (decision 6: never attached to the
  // underlying view). Built directly at render time, same "no memo, no
  // effect dependency" posture as the dashboard/futures pages' orderLines.
  const premiumOrderLines: ChartOrderLine[] = selectedContract
    ? [
        ...account.pendingOrders
          .filter(
            (o) =>
              (o.instrumentKind === "INDEX_OPTION" || o.instrumentKind === "STOCK_OPTION") &&
              o.underlyingSymbol === selectedContract.underlying &&
              o.strikePrice === selectedContract.strikePrice &&
              o.optionType === selectedContract.optionType &&
              o.expiryDate != null &&
              formatExpiryFromIso(o.expiryDate) === selectedContract.expiry
          )
          .map((o): ChartOrderLine => {
            // Sprint C, C1 — an active optimistic drag override wins over
            // the account payload's own price (see use-price-overrides.ts).
            const price = priceOverrides[o.id] ?? (o.variant === "STOP" ? (o.triggerPrice ?? o.limitPrice) : o.limitPrice);
            return {
              id: o.id,
              price,
              kind: o.variant === "STOP" ? "pending-stop" : "pending-limit",
              side: o.side,
              label: `${o.variant} ${o.side} ${o.lots ?? 0} lot(s) @ ${formatRupees(price)}`,
              cancellable: true,
              draggable: true
            };
          }),
        ...(() => {
          const heldPosition = account.optionPositions.find(
            (p) =>
              p.underlyingSymbol === selectedContract.underlying &&
              p.strikePrice === selectedContract.strikePrice &&
              p.optionType === selectedContract.optionType &&
              formatExpiryFromIso(p.expiryDate) === selectedContract.expiry
          );
          if (!heldPosition || heldPosition.lots === 0) return [];
          const line: ChartOrderLine = {
            id: `position-${heldPosition.underlyingSymbol}-${heldPosition.strikePrice}-${heldPosition.optionType}-${heldPosition.expiryDate}`,
            price: heldPosition.avgCost,
            kind: "position",
            side: heldPosition.lots < 0 ? "SELL" : "BUY",
            label: `Avg ${formatRupees(heldPosition.avgCost)}${heldPosition.netPnl != null ? ` · ${formatSignedRupees(heldPosition.netPnl)}` : ""}`,
            cancellable: false
          };
          return [line];
        })()
      ]
    : EMPTY_ORDER_LINES;

  // Charting Workbench (W2) — ONE ticket element instance, reused verbatim
  // whether it renders in TerminalShell's own slot or inside the maximized
  // underlying workbench (ticket single-mount rule — see
  // paper-trading-dashboard.tsx's identical doc).
  const ticketElement = (
    <DockedOrderTicket
      kind="option"
      contract={selectedContract}
      cash={account.availableCash}
      heldLots={heldLotsForSelected}
      linkedOpinionId={deepLinkOpinionId}
      selectionNonce={selectionNonce}
      presetSide={presetSide}
      presetLots={presetLots}
      onOrderPlaced={(order) => {
        setLastOrder(order);
        void loadAccount();
      }}
      onPendingOrderPlaced={(order) => {
        setPendingOrderNotice(
          order.variant === "STOP"
            ? "Stop order queued — it fills at the price observed when the market crosses your trigger."
            : "Limit order queued — it fills automatically once the market reaches your price."
        );
        void loadAccount();
      }}
      presetOrderType={presetOrderType}
      presetLimitPrice={presetLimitPrice}
      presetTriggerPrice={presetTriggerPrice}
    />
  );

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
            cash={account.cash}
            portfolioValue={account.totalValue}
            todayPnl={account.todayNetPnl}
            totalPnl={account.lifetimeNetPnl}
          />
        }
        chart={
          <div>
            <div className="mb-2 inline-flex rounded-2xl border border-ink-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setChartMode("underlying")}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  chartMode === "underlying" ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
                }`}
              >
                Underlying
              </button>
              <button
                type="button"
                disabled={!selectedContract}
                onClick={() => setChartMode("premium")}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  chartMode === "premium" ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
                }`}
                title={selectedContract ? undefined : "Select a contract in the chain to see its premium chart"}
              >
                Contract premium
              </button>
            </div>
            {chartMode === "premium" && selectedContract ? (
              <div className="relative">
                <WorkbenchMaximizeButton onClick={() => setPremiumWorkbenchOpen(true)} label="Maximize premium chart" />
                <PremiumChart
                  underlying={selectedContract.underlying}
                  expiry={selectedContract.expiry}
                  strikePrice={selectedContract.strikePrice}
                  optionType={selectedContract.optionType}
                  livePremium={selectedContract.premium}
                  orderLines={premiumOrderLines}
                  onOrderIntentConfirm={handlePremiumOrderIntentConfirm}
                  onOrderLineDrag={handlePremiumOrderLineDrag}
                  onOrderLineCancel={handlePremiumOrderLineCancel}
                />
              </div>
            ) : (
              <>
                <div className="relative">
                  {chartUnderlying && <WorkbenchMaximizeButton onClick={() => setWorkbenchOpen(true)} />}
                  <OptionsUnderlyingChart underlying={chartUnderlying} isIndex={isIndexChart} />
                </div>
                <InstrumentContextCard symbol={chartUnderlying} />
              </>
            )}
          </div>
        }
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
        ticket={workbenchOpen || premiumWorkbenchOpen ? null : ticketElement}
        positions={<PositionsStrip positions={positionChips} />}
      />

      {workbenchOpen && chartUnderlying && (
        <DynamicChartWorkbench
          feed={isIndexChart ? { kind: "index", symbol: chartUnderlying } : { kind: "equity", symbol: chartUnderlying }}
          chartKey={`${isIndexChart ? "INDEX" : "EQ"}:${chartUnderlying}`}
          title={chartUnderlying}
          onClose={() => setWorkbenchOpen(false)}
          // Decision 6 (Sprint B) holds here too: order execution attaches
          // ONLY to the premium view, never the underlying — see
          // OptionsUnderlyingChart's own PriceChart call, which omits these
          // same props. The maximized underlying view stays click-inert.
          orderLines={EMPTY_ORDER_LINES}
          ticket={ticketElement}
        />
      )}

      {premiumWorkbenchOpen && selectedContract && (
        <DynamicChartWorkbench
          feed={{
            kind: "optionPremium",
            underlying: selectedContract.underlying,
            expiry: selectedContract.expiry,
            strikePrice: selectedContract.strikePrice,
            optionType: selectedContract.optionType,
            livePremium: selectedContract.premium
          }}
          chartKey={`OPT:${selectedContract.underlying}:${selectedContract.expiry}:${selectedContract.strikePrice}:${selectedContract.optionType}`}
          title={`${selectedContract.underlying} ${selectedContract.strikePrice} ${selectedContract.optionType}`}
          onClose={() => setPremiumWorkbenchOpen(false)}
          // Entry point 4 — reuses the SAME premiumOrderLines/handlers the
          // small PremiumChart already has (options-page-client.tsx line
          // ~579's own props), never re-derived — order execution lives on
          // the premium view for options, exactly as it does on the small
          // chart this replaces.
          orderLines={premiumOrderLines}
          onOrderIntentConfirm={handlePremiumOrderIntentConfirm}
          onOrderLineDrag={handlePremiumOrderLineDrag}
          onOrderLineCancel={handlePremiumOrderLineCancel}
          ticket={ticketElement}
        />
      )}

      {pendingOrderNotice && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {pendingOrderNotice}{" "}
          <button type="button" className="underline" onClick={() => setPendingOrderNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {repriceError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Couldn&apos;t move that order — {repriceError}{" "}
          <button type="button" className="underline" onClick={() => setRepriceError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <PendingOrdersPanel orders={account.pendingOrders} onCancelled={() => void loadAccount()} />

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
  isIndex
}: {
  underlying: string | null;
  isIndex: boolean;
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
      />
    );
  }

  return <PriceChart key={underlying} symbol={underlying} series={stockEodSeries} />;
}
