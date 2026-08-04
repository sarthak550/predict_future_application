"use client";

/**
 * Paper Trading Phase 1 — main dashboard (T5/T6/T9). Session-aware client-side
 * (same fetch("/api/auth/session") pattern as ManageDashboard/SessionChip) since
 * this whole surface is a signed-in personal utility page, never indexed.
 *
 * Reads ?symbol=&side=&productType=&linkedOpinionId= from the URL to pre-fill the
 * New Trade form — this is how "Paper trade this call" (T7) hands off into this
 * page without any prop-drilling across the navigation boundary.
 *
 * Delivery-holdings Sell button (2026-08-04) — every row in the "Delivery
 * holdings" / "Open intraday positions" tables below now links to this SAME
 * `?symbol=&side=SELL&productType=` deep-link (a `?quantity=` param added
 * alongside it, defaulting the ticket's quantity field to the row's full
 * held size — editable from there) instead of inventing a second prefill
 * path. This is the exact shape terminal/positions-strip.tsx already builds
 * for its equity chips (T8, 2026-07-25) — that surface just had no caller
 * wiring equity positions into it yet (see that file's own note). A plain
 * `<Link>` (default `scroll={true}`) is used rather than a client `onClick`
 * handler specifically so the browser's own scroll-to-top-of-page behavior
 * (already relied on elsewhere in this codebase — see
 * use-workbench-url-param.ts's contrasting `scroll: false`) carries the
 * ticket into view on a mobile-narrow layout where the holdings tables sit
 * well below the fold; no bespoke scroll code was added.
 *
 * Trading Terminal UI Overhaul (Sprint A, T5) — the top section is now a
 * TerminalShell: sticky header (spot + day/total P&L + cash), the focused
 * symbol's PriceChart, and a DockedOrderTicket delegating to the EXISTING,
 * UNMODIFIED NewTradeForm (equity needed no new submit logic — "chart +
 * simple buy/sell ticket, no ladder" per the brief). Everything from
 * "Delivery holdings" down keeps the full tables (with Sell actions) — the
 * chips strip was removed 2026-07-25 as pure duplication of those tables.
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, B3) — the terminal chart
 * now wires: pending-order lines for the focused symbol (with cancel), a
 * position line at avg cost with live P&L composed from the chart's own
 * `onQuoteChange` (this is the first production consumer of that callback —
 * confirmed at implementation time by grepping for other subscribers, per
 * the Sprint B brief's own ground-truth note), click-to-prefill a LIMIT
 * order into NewTradeForm's new preset channel, and an opt-in 60s 1D poll.
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint C) — the click prefill above
 * is now the order-intent POPOVER (C2: side/variant inference vs LTP,
 * replacing the hardcoded-LIMIT click), and pending-order lines are now
 * DRAGGABLE (C1: pointer-drag reprices via PATCH /api/paper-trading/
 * pending-orders/[id], with optimistic-UI + revert-on-4xx-with-toast + the
 * shared `usePriceOverrides` anti-snap-back guard against a stale account
 * poll landing mid-drag — see that hook's own doc for the exact race it
 * closes).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { PriceChart, type ChartOrderLine } from "@/components/finance/price-chart";
import { EMPTY_ORDER_LINES } from "@/components/finance/chart-order-lines";
import { PaperTradingSymbolSearchInput, type PaperSymbolOption } from "@/components/paper-trading/symbol-search-input";
import { type PlacedOrderPayload } from "@/components/paper-trading/new-trade-form";
import { InstrumentContextCard } from "@/components/paper-trading/instrument-context-card";
import { OrderConfirmation } from "@/components/paper-trading/order-confirmation";
import { OrderHistoryTable, type OrderHistoryEntry } from "@/components/paper-trading/order-history-table";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { PendingOrdersPanel } from "@/components/paper-trading/pending-orders-panel";
import { cancelPendingOrder, repricePendingOrder, type PendingOrderPayload } from "@/lib/paperTrading/pendingOrdersClient";
import { usePriceOverrides } from "@/components/paper-trading/use-price-overrides";
import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import { useWorkbenchAutoRestore, useWorkbenchUrlParam } from "@/components/paper-trading/use-workbench-url-param";
import { DockedOrderTicket } from "@/components/paper-trading/terminal/docked-order-ticket";
import { TerminalHeader } from "@/components/paper-trading/terminal/terminal-header";
import { TerminalShell } from "@/components/paper-trading/terminal/terminal-shell";
import { useEodSeries } from "@/components/paper-trading/terminal/use-eod-series";
import { DynamicChartWorkbench, WorkbenchMaximizeButton } from "@/components/paper-trading/workbench/workbench-maximize-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

type LoadState = "loading" | "signed-out" | "ready";

/** Device-wide "last focused symbol" — restores the terminal's chart/ticket focus across visits when no deep-link and no holding is available. */
const LAST_FOCUSED_SYMBOL_KEY = "pf.papertrading.lastFocusedSymbol";

interface PositionRow {
  symbol: string;
  quantity: number;
  avgCost: number;
  latestLtp: number | null;
  realizedGrossPnl: number;
  unrealizedGrossPnl: number | null;
  totalCosts: number;
  netPnl: number | null;
}

/** Phase 2/3 — mirrors lib/paperTrading/queries.ts's OptionPositionRow, JSON-serialized (Date -> ISO string). */
interface OptionPositionRow {
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  lotSize: number | null;
  lots: number;
  quantity: number;
  avgCost: number;
  latestPremium: number | null;
  realizedGrossPnl: number;
  unrealizedGrossPnl: number | null;
  totalCosts: number;
  netPnl: number | null;
  daysToExpiry: number;
  /** Phase 3 — which settlement mechanism this contract uses. */
  instrumentKind: "INDEX_OPTION" | "STOCK_OPTION";
}

/** Phase 4 (Sprint 2, T10) — mirrors lib/paperTrading/queries.ts's FuturesPositionRow, JSON-serialized (Date -> ISO string). */
interface FuturesPositionRow {
  underlyingSymbol: string;
  expiryDate: string;
  side: "LONG" | "SHORT";
  lotSize: number | null;
  lots: number;
  quantity: number;
  referencePrice: number;
  latestPrice: number | null;
  quoteSource: "LIVE" | "PCP_DERIVED" | null;
  marginRequired: number | null;
  impliedLeverage: number;
  todayMtmPnl: number | null;
  realizedGrossPnl: number;
  totalCosts: number;
  daysToExpiry: number;
}

interface AccountDetail {
  account: { id: string; generation: number; startingCapital: number; createdAt: string; status: "ACTIVE" | "ARCHIVED" };
  cash: number;
  /** Limit Orders (Sprint, 2026-07-26). */
  pendingBlockedCash: number;
  availableCash: number;
  pendingOrders: PendingOrderPayload[];
  deliveryHoldings: PositionRow[];
  openIntradayPositions: PositionRow[];
  optionPositions: OptionPositionRow[];
  futuresPositions: FuturesPositionRow[];
  totalFuturesMarginRequired: number;
  lifetimeCostsPaid: number;
  lifetimeRealizedGrossPnl: number;
  lifetimeUnrealizedGrossPnl: number;
  lifetimeNetPnl: number;
  /** Trading Terminal UI Overhaul (Sprint A, T4) — see queries.ts's computeTodayNetPnl for the exact derivation. */
  todayNetPnl: number;
  totalValue: number;
  resetEligible: boolean;
  daysUntilReset: number;
  recentOrders: OrderHistoryEntry[];
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function pnlTone(value: number): "up" | "down" | undefined {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return undefined;
}

export function PaperTradingDashboard() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [error, setError] = useState("");
  const [lastOrder, setLastOrder] = useState<PlacedOrderPayload | null>(null);
  const [pendingOrderNotice, setPendingOrderNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Chart Trading + SL/TP (Sprint B, B3) — chart-click preset channel into
  // NewTradeForm, and the chart's own live spot (via onQuoteChange) for the
  // position line's live P&L.
  const [presetNonce, setPresetNonce] = useState(0);
  const [presetSide, setPresetSide] = useState<"BUY" | "SELL" | undefined>(undefined);
  const [presetOrderType, setPresetOrderType] = useState<"LIMIT" | "STOP" | undefined>(undefined);
  const [presetLimitPrice, setPresetLimitPrice] = useState<number | undefined>(undefined);
  const [presetTriggerPrice, setPresetTriggerPrice] = useState<number | undefined>(undefined);
  const [chartQuote, setChartQuote] = useState<{ price: number } | null>(null);

  // Chart Trading + SL/TP (Sprint C, C2) — the click-popover's confirmed
  // side/variant/price feeds the SAME nonce-gated preset channel Sprint B
  // built, now carrying the user's explicit choice instead of a hardcoded
  // LIMIT (decision 3 of the Sprint C brief).
  function handleOrderIntentConfirm(input: { price: number; side: "BUY" | "SELL"; variant: "LIMIT" | "STOP" }) {
    setPresetSide(input.side);
    setPresetOrderType(input.variant);
    setPresetLimitPrice(input.variant === "LIMIT" ? input.price : undefined);
    setPresetTriggerPrice(input.variant === "STOP" ? input.price : undefined);
    setPresetNonce((n) => n + 1);
  }

  // Chart Trading + SL/TP (Sprint C, C1) — drag-to-reprice's optimistic-UI
  // wiring: the shared usePriceOverrides hook (see that file's own doc for
  // the exact anti-snap-back race it closes) plus a dismissible error
  // banner for the "revert on 4xx" toast requirement.
  const currentPendingOrderPrices = useMemo(
    () => account?.pendingOrders.map((o) => ({ id: o.id, price: o.variant === "STOP" ? (o.triggerPrice ?? o.limitPrice) : o.limitPrice })) ?? [],
    [account]
  );
  const { overrides: priceOverrides, setOverride: setPriceOverride, clearOverride: clearPriceOverride } = usePriceOverrides(currentPendingOrderPrices);
  const [repriceError, setRepriceError] = useState<string | null>(null);

  async function handleOrderLineDrag(id: string, newPrice: number) {
    const order = account?.pendingOrders.find((o) => o.id === id);
    if (!order) return;
    setRepriceError(null);
    setPriceOverride(id, newPrice);
    const result = await repricePendingOrder(id, order.variant === "STOP" ? { triggerPrice: newPrice } : { limitPrice: newPrice });
    if (!result.ok) {
      // Reverts the optimistic line — NOT a silent snap-back, per the Sprint
      // C brief's honesty framing: the user gets an explicit, visible reason
      // the drag didn't stick, rather than discovering it later when the
      // order doesn't behave as they assumed.
      clearPriceOverride(id);
      setRepriceError(result.error);
      return;
    }
    await loadAccount();
  }

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-trading/account");
      if (!res.ok) {
        setError("Couldn't load your Paper Trading account.");
        return;
      }
      const data = await res.json();
      setAccount(data.account);
    } catch {
      setError("Couldn't load your Paper Trading account — check your connection.");
    }
  }, []);

  function handleOrderLineCancel(id: string) {
    if (id.startsWith("position-")) return; // defensive — the position line is never cancellable
    void cancelPendingOrder(id).then((result) => {
      if (result.ok) void loadAccount();
    });
  }

  // Positions mark-to-market and cash tick on their own (delayed feed) instead
  // of freezing until a manual refresh — paused while the tab is hidden.
  useVisiblePolling(() => void loadAccount(), 60_000, state === "ready");

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

  // Reset is where users set their own capital (founder 2026-07-26):
  // prompt() keeps this dependency-free — default ₹1Cr, bounds enforced
  // server-side too (₹1L–₹1000Cr).
  async function handleReset() {
    if (!account || resetting) return;
    const raw = window.prompt(
      "Reset your Paper Trading account?\n\nThis archives the current account (order history stays viewable) and starts fresh.\n\nStarting capital in rupees (₹1,00,000 – ₹1,000 crore):",
      "10000000"
    );
    if (raw === null) return; // cancelled
    const startingCapital = Number(raw.replace(/[,\s]/g, ""));
    if (!Number.isInteger(startingCapital) || startingCapital <= 0) {
      setError("Starting capital must be a whole rupee amount.");
      return;
    }
    setResetting(true);
    try {
      const res = await fetch("/api/paper-trading/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingCapital }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? "Couldn't reset your account.");
        return;
      }
      await loadAccount();
    } finally {
      setResetting(false);
    }
  }

  // ── Focused symbol (T5): deep-link > largest holding by value > last
  // focused (localStorage) > null (search prompt). ──────────────────────────
  const deepLinkSymbol = searchParams.get("symbol");
  const [manualFocus, setManualFocus] = useState<string | null>(null);
  const [restoredLastFocus, setRestoredLastFocus] = useState<string | null | undefined>(undefined); // undefined = not yet read from storage

  useEffect(() => {
    try {
      setRestoredLastFocus(window.localStorage.getItem(LAST_FOCUSED_SYMBOL_KEY));
    } catch {
      setRestoredLastFocus(null);
    }
  }, []);

  const largestHoldingSymbol = useMemo(() => {
    if (!account || account.deliveryHoldings.length === 0) return null;
    const byValue = [...account.deliveryHoldings].sort(
      (a, b) => Math.abs(b.quantity * (b.latestLtp ?? b.avgCost)) - Math.abs(a.quantity * (a.latestLtp ?? a.avgCost))
    );
    return byValue[0]?.symbol ?? null;
  }, [account]);

  const focusedSymbol = deepLinkSymbol ?? manualFocus ?? largestHoldingSymbol ?? restoredLastFocus ?? null;

  // Chart Trading + SL/TP (Sprint B, B3) — a stale quote from the PREVIOUS
  // focused symbol must never compute the position line's P&L for the NEW
  // one, even for the one render between a symbol change and the chart's own
  // first `onQuoteChange` report. Keyed on the primitive `focusedSymbol`
  // string, never on the chart's own quote object.
  useEffect(() => {
    setChartQuote(null);
  }, [focusedSymbol]);

  // Charting Workbench (W2) — the maximize state lives here (not inside
  // WorkbenchMaximizeButton) because the ticket single-mount rule requires
  // THIS component to swap its own docked ticket to `null` while the
  // workbench is open (see the render below). Closed on a symbol change so
  // a stale workbench for the PREVIOUS focused symbol never lingers open.
  //
  // Founder bug fix (2026-08-06) — "when we refresh, the chart view goes
  // away": open/closed state is now mirrored into a `?workbench=1` URL
  // param (use-workbench-url-param.ts) so a hard refresh — or a browser
  // back/forward landing back on this exact URL — restores it.
  // `workbenchOpen` stays the actual render-driving boolean (every other
  // call site below is unchanged); `setWorkbenchOpen` now also writes the
  // URL. `useWorkbenchAutoRestore` replaces the old bare `[focusedSymbol]`
  // effect: it restores an open workbench the FIRST time `focusedSymbol`
  // resolves (deep-link/holding/localStorage — see above — can take a tick
  // to settle), and force-closes (+ cleans the URL) on every REAL change
  // after that, same as before.
  const [workbenchParam, setWorkbenchParam] = useWorkbenchUrlParam();
  const [workbenchOpen, setWorkbenchOpenState] = useState(false);
  const setWorkbenchOpen = useCallback(
    (open: boolean) => {
      setWorkbenchOpenState(open);
      setWorkbenchParam(open ? "1" : null);
    },
    [setWorkbenchParam]
  );
  useWorkbenchAutoRestore(
    focusedSymbol,
    workbenchParam === "1",
    () => setWorkbenchOpenState(true),
    () => setWorkbenchOpen(false)
  );

  const setFocusedSymbol = useCallback((symbol: string) => {
    setManualFocus(symbol);
    try {
      window.localStorage.setItem(LAST_FOCUSED_SYMBOL_KEY, symbol);
    } catch {
      // Preference just won't persist.
    }
  }, []);

  const eodSeries = useEodSeries(focusedSymbol);

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
          <CardTitle>Sign in to start paper trading</CardTitle>
          <CardDescription>Your Paper Trading account is tied to your Predict Future account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in?callbackUrl=%2Fpaper-trading">
            <Button variant="primary">Sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (error && !account) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-rose-600">{error}</CardContent>
      </Card>
    );
  }

  if (!account) return null;

  const heldDeliveryQtyBySymbol = Object.fromEntries(account.deliveryHoldings.map((h) => [h.symbol, h.quantity]));
  const hasSoldDeliveryTodayBySymbol: Record<string, boolean> = {};
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  for (const order of account.recentOrders) {
    if (order.productType !== "DELIVERY" || order.side !== "SELL") continue;
    const orderDayIst = new Date(order.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    if (orderDayIst === todayIst) hasSoldDeliveryTodayBySymbol[order.symbol] = true;
  }

  const initialSymbol = deepLinkSymbol;
  const initialSide = searchParams.get("side") === "SELL" ? "SELL" : "BUY";
  const initialProductType = searchParams.get("productType") === "INTRADAY" ? "INTRADAY" : "DELIVERY";
  const linkedOpinionId = searchParams.get("linkedOpinionId");
  // Delivery-holdings Sell button (2026-08-04) — sibling to the three params
  // above, carrying the holding row's full quantity across the same
  // deep-link hand-off. Validated defensively (positive integer) since it's
  // user-editable URL text; anything else just leaves the ticket's quantity
  // field blank, same as omitting it entirely.
  const rawQuantityParam = searchParams.get("quantity");
  const parsedQuantityParam = rawQuantityParam != null ? Number(rawQuantityParam) : NaN;
  const initialQuantity = Number.isInteger(parsedQuantityParam) && parsedQuantityParam > 0 ? parsedQuantityParam : undefined;

  // Chart Trading + SL/TP (Sprint B, B3) — order lines for the FOCUSED
  // symbol's chart only: its own resting pending orders (LIMIT/STOP,
  // cancellable) plus a position line at avg cost (delivery holding takes
  // priority over an open intraday position, mirroring how the rest of this
  // page already treats delivery as the "primary" equity position type).
  // Built directly at render time from props/state — deliberately NOT a
  // `useMemo` keyed on anything that could churn every quote tick, since
  // this array is only ever read by PriceChart's own render (never an effect
  // dependency anywhere), so there is no render-loop risk from recomputing
  // it on every render.
  const focusedPosition = focusedSymbol
    ? (account.deliveryHoldings.find((h) => h.symbol === focusedSymbol) ?? account.openIntradayPositions.find((h) => h.symbol === focusedSymbol))
    : undefined;
  const orderLines: ChartOrderLine[] = focusedSymbol
    ? [
        ...account.pendingOrders
          .filter((o) => o.instrumentKind === "EQUITY" && o.symbol === focusedSymbol)
          .map((o): ChartOrderLine => {
            // Sprint C, C1 — an active optimistic drag override (see
            // usePriceOverrides) wins over whatever the account payload
            // itself reports, until the account data self-confirms the new
            // price — this is what stops a stale in-flight poll response
            // from snapping the line back mid-drag or right after a
            // successful reprice.
            const price = priceOverrides[o.id] ?? (o.variant === "STOP" ? (o.triggerPrice ?? o.limitPrice) : o.limitPrice);
            return {
              id: o.id,
              price,
              kind: o.variant === "STOP" ? "pending-stop" : "pending-limit",
              side: o.side,
              label: `${o.variant} ${o.side} ${o.quantity} @ ${formatRupees(price)}`,
              cancellable: true,
              draggable: true
            };
          }),
        ...(focusedPosition && focusedPosition.quantity !== 0
          ? [
              {
                id: `position-${focusedSymbol}`,
                price: focusedPosition.avgCost,
                kind: "position" as const,
                side: focusedPosition.quantity < 0 ? ("SELL" as const) : ("BUY" as const),
                label:
                  `Avg ${formatRupees(focusedPosition.avgCost)}` +
                  (chartQuote ? ` · ${formatSignedRupees((chartQuote.price - focusedPosition.avgCost) * focusedPosition.quantity)}` : ""),
                cancellable: false
              }
            ]
          : [])
      ]
    : EMPTY_ORDER_LINES;

  // Charting Workbench (W2) — ONE ticket element instance, reused verbatim
  // whether it renders in TerminalShell's own slot or inside the maximized
  // workbench (see the ticket single-mount rule above) — never two separate
  // <DockedOrderTicket> JSX literals that could drift out of sync.
  const ticketElement = (
    <DockedOrderTicket
      key={`${initialSymbol ?? focusedSymbol ?? ""}-${initialSide}-${initialProductType}-${initialQuantity ?? ""}`}
      kind="equity"
      cash={account.availableCash}
      heldDeliveryQtyBySymbol={heldDeliveryQtyBySymbol}
      hasSoldDeliveryTodayBySymbol={hasSoldDeliveryTodayBySymbol}
      initialSymbol={initialSymbol ?? focusedSymbol}
      initialSide={initialSide}
      initialProductType={initialProductType}
      initialQuantity={initialQuantity}
      linkedOpinionId={linkedOpinionId}
      onOrderPlaced={(order) => {
        setLastOrder(order);
        setFocusedSymbol(order.symbol);
        loadAccount();
      }}
      onPendingOrderPlaced={(order) => {
        setPendingOrderNotice(
          order.variant === "STOP"
            ? "Stop order queued — it fills at the price observed when the market crosses your trigger."
            : "Limit order queued — it fills automatically once the market reaches your price."
        );
        loadAccount();
      }}
      presetNonce={presetNonce}
      presetSide={presetSide}
      presetOrderType={presetOrderType}
      presetLimitPrice={presetLimitPrice}
      presetTriggerPrice={presetTriggerPrice}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Paper Trading</h1>
          <p className="mt-1 text-sm text-ink-500">
            Account #{account.account.generation} · Started with {formatRupees(account.account.startingCapital)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/paper-trading/options">
            <Button variant="secondary" size="sm">
              Options
            </Button>
          </Link>
          <Link href="/paper-trading/futures">
            <Button variant="secondary" size="sm">
              Futures
            </Button>
          </Link>
          <Link href="/paper-trading/calls-traded">
            <Button variant="secondary" size="sm">
              Calls I&apos;ve traded
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={resetting || !account.resetEligible}
            title={!account.resetEligible ? `You can reset again in ${account.daysUntilReset} day(s).` : undefined}
          >
            {resetting ? "Resetting…" : account.resetEligible ? "Reset account" : `Reset in ${account.daysUntilReset}d`}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

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
          focusedSymbol ? (
            <div>
              <div className="relative">
                <WorkbenchMaximizeButton onClick={() => setWorkbenchOpen(true)} />
                <PriceChart
                  key={focusedSymbol}
                  symbol={focusedSymbol}
                  series={eodSeries}
                  orderLines={orderLines}
                  onOrderIntentConfirm={handleOrderIntentConfirm}
                  onOrderLineDrag={handleOrderLineDrag}
                  onOrderLineCancel={handleOrderLineCancel}
                  onQuoteChange={(q) => setChartQuote(q ? { price: q.price } : null)}
                  pollIntervalMs={60_000}
                />
              </div>
              <InstrumentContextCard symbol={focusedSymbol} />
              <div className="mt-3 max-w-xs">
                <PaperTradingSymbolSearchInput
                  value=""
                  onSelect={(opt: PaperSymbolOption) => setFocusedSymbol(opt.symbol)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-500">Search a symbol to start trading.</p>
              <div className="max-w-xs">
                <PaperTradingSymbolSearchInput value="" onSelect={(opt: PaperSymbolOption) => setFocusedSymbol(opt.symbol)} />
              </div>
            </div>
          )
        }
        ticket={
          // Charting Workbench (W2) — ticket single-mount rule: while the
          // workbench is open, the SAME element instance renders inside it
          // instead (see below), and this slot goes empty — never two
          // mounted DockedOrderTickets for one account at once.
          workbenchOpen ? null : ticketElement
        }
      />

      {workbenchOpen && focusedSymbol && (
        <DynamicChartWorkbench
          feed={{ kind: "equity", symbol: focusedSymbol }}
          chartKey={`EQ:${focusedSymbol}`}
          title={focusedSymbol}
          onClose={() => setWorkbenchOpen(false)}
          orderLines={orderLines}
          onOrderIntentConfirm={handleOrderIntentConfirm}
          onOrderLineDrag={handleOrderLineDrag}
          onOrderLineCancel={handleOrderLineCancel}
          onQuoteChange={(q) => setChartQuote(q ? { price: q.price } : null)}
          ticket={ticketElement}
        />
      )}

      {lastOrder && <OrderConfirmation order={lastOrder} onDismiss={() => setLastOrder(null)} />}
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

      <PendingOrdersPanel orders={account.pendingOrders} onCancelled={loadAccount} />

      <Card>
        <CardHeader>
          <CardTitle>Delivery holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <PositionsTable rows={account.deliveryHoldings} emptyLabel="No open delivery holdings." productType="DELIVERY" />
        </CardContent>
      </Card>

      {account.openIntradayPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open intraday positions (today)</CardTitle>
            <CardDescription>Auto-squared-off near market close if still open.</CardDescription>
          </CardHeader>
          <CardContent>
            <PositionsTable rows={account.openIntradayPositions} emptyLabel="No open intraday positions." productType="INTRADAY" />
          </CardContent>
        </Card>
      )}

      {account.optionPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Option positions</CardTitle>
            <CardDescription>
              Index options (NIFTY/BANKNIFTY) settle automatically at intrinsic value on expiry day. Stock options are
              physically settled at expiry — like most discount brokers, we close open positions before expiry rather
              than take delivery into a demat account we don&apos;t model.{" "}
              <Link href="/paper-trading/options" className="underline">
                Trade options
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OptionPositionsTable rows={account.optionPositions} />
          </CardContent>
        </Card>
      )}

      {account.futuresPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Futures positions</CardTitle>
            <CardDescription>
              Index futures — marked to market daily against the real NSE settlement price; margin required is a
              conservative simulator estimate, not a live SPAN calculation.{" "}
              <Link href="/paper-trading/futures" className="underline">
                Trade futures
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FuturesPositionsTable rows={account.futuresPositions} totalMarginRequired={account.totalFuturesMarginRequired} cash={account.cash} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Order history</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderHistoryTable orders={account.recentOrders} />
        </CardContent>
      </Card>

      <PaperTradingDisclaimerFooter />
    </div>
  );
}

/**
 * Delivery-holdings Sell button (2026-08-04) — why a row is un-sellable, or
 * `null` when it's fine. `quantity < 0` only ever fires for an INTRADAY short
 * (delivery short-selling isn't offered — see new-trade-form.tsx — so
 * Delivery rows never hit that branch); closing a short is a BUY, which is a
 * distinct feature this ticket doesn't build (see the report's intraday-
 * sibling note) — surfaced here as a disabled state, not a wrong-side Sell
 * link. `quantity === 0` is dead in practice (queries.ts already filters
 * zero-quantity positions out of both arrays) but kept as a defensive floor
 * per the founder's own disable spec. `latestLtp === null` reuses the same
 * "delayed price unavailable" signal the row itself already renders — this
 * codebase has no separate halted/tradability flag to check instead.
 */
function sellDisabledReason(row: PositionRow): string | null {
  if (row.quantity < 0) return "Short position — close it with a Buy order in the ticket, not Sell.";
  if (row.quantity === 0) return "No sellable quantity.";
  if (row.latestLtp === null) return "Live price unavailable for this instrument right now.";
  return null;
}

function PositionSellAction({ row, productType }: { row: PositionRow; productType: "DELIVERY" | "INTRADAY" }) {
  const disabledReason = sellDisabledReason(row);
  if (disabledReason) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        className="cursor-not-allowed rounded-lg border border-ink-100 px-3 py-1 text-xs font-semibold text-ink-300"
      >
        Sell
      </button>
    );
  }
  return (
    <Link
      href={`/paper-trading?symbol=${encodeURIComponent(row.symbol)}&side=SELL&productType=${productType}&quantity=${row.quantity}`}
      className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
    >
      Sell
    </Link>
  );
}

function PositionsTable({ rows, emptyLabel, productType }: { rows: PositionRow[]; emptyLabel: string; productType: "DELIVERY" | "INTRADAY" }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-400">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Symbol</TableHeaderCell>
            <TableHeaderCell>Qty</TableHeaderCell>
            <TableHeaderCell>Avg cost</TableHeaderCell>
            <TableHeaderCell>Delayed LTP</TableHeaderCell>
            <TableHeaderCell>Unrealized gross</TableHeaderCell>
            <TableHeaderCell>Net P&L</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.symbol}>
              <TableCell className="font-medium text-ink-900">{row.symbol}</TableCell>
              <TableCell className={row.quantity < 0 ? "text-rose-600" : undefined}>
                {row.quantity} {row.quantity < 0 ? "(short)" : ""}
              </TableCell>
              <TableCell>{formatRupees(row.avgCost)}</TableCell>
              <TableCell>{row.latestLtp != null ? formatRupees(row.latestLtp) : "— (delayed price unavailable)"}</TableCell>
              <TableCell className={row.unrealizedGrossPnl != null ? (pnlTone(row.unrealizedGrossPnl) === "up" ? "text-emerald-600" : row.unrealizedGrossPnl < 0 ? "text-rose-600" : undefined) : undefined}>
                {row.unrealizedGrossPnl != null ? formatSignedRupees(row.unrealizedGrossPnl) : "—"}
              </TableCell>
              <TableCell className={row.netPnl != null ? (row.netPnl >= 0 ? "text-emerald-600" : "text-rose-600") : undefined}>
                {row.netPnl != null ? formatSignedRupees(row.netPnl) : "—"}
              </TableCell>
              <TableCell>
                <PositionSellAction row={row} productType={productType} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatExpiryLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit" });
}

/** Phase 2/3 — renders open option positions (index OR stock) distinctly from equity holdings: contract label, a settlement-type badge, lots, avg/live premium, unrealized P&L, and a days-to-expiry chip (per the brief's positions-view spec). */
function OptionPositionsTable({ rows }: { rows: OptionPositionRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Contract</TableHeaderCell>
            <TableHeaderCell>Settlement</TableHeaderCell>
            <TableHeaderCell>Lots</TableHeaderCell>
            <TableHeaderCell>Avg premium</TableHeaderCell>
            <TableHeaderCell>Live premium</TableHeaderCell>
            <TableHeaderCell>Unrealized</TableHeaderCell>
            <TableHeaderCell>Net P&L</TableHeaderCell>
            <TableHeaderCell>Expiry</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const key = `${row.underlyingSymbol}-${row.strikePrice}-${row.optionType}-${row.expiryDate}`;
            const expiringSoon = row.daysToExpiry <= 2;
            const isStockOption = row.instrumentKind === "STOCK_OPTION";
            return (
              <TableRow key={key}>
                <TableCell className="font-medium text-ink-900">
                  {row.underlyingSymbol} {row.strikePrice.toLocaleString("en-IN")} {row.optionType}
                </TableCell>
                <TableCell>
                  <Badge variant={isStockOption ? "warning" : "default"} className="whitespace-nowrap">
                    {isStockOption ? "Squares off before expiry" : "Cash-settled at expiry"}
                  </Badge>
                </TableCell>
                <TableCell>{row.lots}</TableCell>
                <TableCell>{formatRupees(row.avgCost)}</TableCell>
                <TableCell>{row.latestPremium != null ? formatRupees(row.latestPremium) : "— (delayed price unavailable)"}</TableCell>
                <TableCell
                  className={
                    row.unrealizedGrossPnl != null
                      ? pnlTone(row.unrealizedGrossPnl) === "up"
                        ? "text-emerald-600"
                        : row.unrealizedGrossPnl < 0
                          ? "text-rose-600"
                          : undefined
                      : undefined
                  }
                >
                  {row.unrealizedGrossPnl != null ? formatSignedRupees(row.unrealizedGrossPnl) : "—"}
                </TableCell>
                <TableCell className={row.netPnl != null ? (row.netPnl >= 0 ? "text-emerald-600" : "text-rose-600") : undefined}>
                  {row.netPnl != null ? formatSignedRupees(row.netPnl) : "—"}
                </TableCell>
                <TableCell>
                  <span className={expiringSoon ? "font-medium text-amber-700" : "text-ink-500"}>
                    {row.daysToExpiry === 0 ? "Today" : `${row.daysToExpiry}d`}
                  </span>{" "}
                  <span className="text-ink-400">({formatExpiryLabel(row.expiryDate)})</span>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/paper-trading/options?underlying=${encodeURIComponent(row.underlyingSymbol)}&expiry=${encodeURIComponent(formatNseExpiryDate(new Date(row.expiryDate)))}&strike=${row.strikePrice}&optionType=${row.optionType}&side=SELL`}
                    className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Sell
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Phase 4 (Sprint 2, T10) — open index-futures positions: contract, side, lots, margin/leverage, today's MTM (live estimate, NOT unrealized-since-entry — see the queries.ts doc on todayMtmPnl), lifetime realized, and a days-to-expiry chip. */
function FuturesPositionsTable({
  rows,
  totalMarginRequired,
  cash
}: {
  rows: FuturesPositionRow[];
  totalMarginRequired: number;
  cash: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Total margin in use: <span className="font-medium text-ink-900">{formatRupees(totalMarginRequired)}</span> of{" "}
        {formatRupees(cash)} cash — margin shown is an approximate, conservative simulator estimate; real SPAN margin
        changes daily and may be lower. Never size a real trade off this number.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Contract</TableHeaderCell>
              <TableHeaderCell>Side</TableHeaderCell>
              <TableHeaderCell>Lots</TableHeaderCell>
              <TableHeaderCell>Reference price</TableHeaderCell>
              <TableHeaderCell>Live price</TableHeaderCell>
              <TableHeaderCell>Margin / leverage</TableHeaderCell>
              <TableHeaderCell>Today&apos;s MTM (live est.)</TableHeaderCell>
              <TableHeaderCell>Lifetime realized</TableHeaderCell>
              <TableHeaderCell>Expiry</TableHeaderCell>
              <TableHeaderCell>
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const key = `${row.underlyingSymbol}-${row.expiryDate}`;
              const expiringSoon = row.daysToExpiry <= 2;
              return (
                <TableRow key={key}>
                  <TableCell className="font-medium text-ink-900">
                    {row.underlyingSymbol} FUT
                    {row.quoteSource === "PCP_DERIVED" && (
                      <Badge variant="warning" className="ml-1.5">
                        derived from option prices
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.side === "LONG" ? "success" : "danger"}>{row.side}</Badge>
                  </TableCell>
                  <TableCell>{row.lots}</TableCell>
                  <TableCell>{formatRupees(row.referencePrice)}</TableCell>
                  <TableCell>{row.latestPrice != null ? formatRupees(row.latestPrice) : "— (price unavailable)"}</TableCell>
                  <TableCell>
                    {row.marginRequired != null ? `${formatRupees(row.marginRequired)} (${row.impliedLeverage.toFixed(1)}x)` : "—"}
                  </TableCell>
                  <TableCell className={row.todayMtmPnl != null ? (row.todayMtmPnl >= 0 ? "text-emerald-600" : "text-rose-600") : undefined}>
                    {row.todayMtmPnl != null ? formatSignedRupees(row.todayMtmPnl) : "—"}
                  </TableCell>
                  <TableCell className={row.realizedGrossPnl >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    {formatSignedRupees(row.realizedGrossPnl)}
                  </TableCell>
                  <TableCell>
                    <span className={expiringSoon ? "font-medium text-amber-700" : "text-ink-500"}>
                      {row.daysToExpiry === 0 ? "Today" : `${row.daysToExpiry}d`}
                    </span>{" "}
                    <span className="text-ink-400">({formatExpiryLabel(row.expiryDate)})</span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/paper-trading/futures?underlying=${encodeURIComponent(row.underlyingSymbol)}&expiry=${encodeURIComponent(formatNseExpiryDate(new Date(row.expiryDate)))}&side=${row.side === "LONG" ? "SELL" : "BUY"}`}
                      className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Close
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
