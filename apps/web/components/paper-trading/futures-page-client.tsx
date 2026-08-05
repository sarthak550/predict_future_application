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
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, B3) — the underlying spot
 * chart now wires pending-order + position lines (all explicitly "FUT"-
 * tagged, per the Sprint B brief's decision 5 honesty requirement — this
 * chart shows INDEX SPOT, but every line on it is a CONTRACT price, and basis
 * is not zero), click-to-prefill a LIMIT order, cancel-from-chart, and an
 * opt-in 60s 1D poll.
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint C) — the click prefill above
 * is now the order-intent popover (C2), and pending-order lines are now
 * draggable (C1) — see paper-trading-dashboard.tsx's identical Sprint C doc
 * for the full optimistic-UI/anti-snap-back contract, mirrored here.
 *
 * Founder feature (Contract table in maximized workbench, 2026-08-09) — a
 * follow-up to options-page-client.tsx's option-chain-in-workbench feature
 * (2026-08-04): `contractTableElement` (below) is the SAME single-mount
 * `FuturesContractTable` instance whether it renders in `TerminalShell`'s
 * ladder slot or inside the maximized workbench's new "Contracts" tab
 * (`chain`/`chainLabel` props on `ChartWorkbench` — see that file's own
 * doc). Unlike options, futures has only ONE chart (the underlying index
 * spot — there's no separate "contract premium" view), so there's no
 * `chartModeSwitcher` pill here: switching CONTRACTS (near/next/far, same
 * underlying) is ticket-only and never touches the chart, exactly as
 * before. Switching the UNDERLYING itself (e.g. NIFTY -> BANKNIFTY) from
 * inside the embedded table DOES change the workbench's `feed`/`chartKey`
 * live on the same still-mounted `ChartWorkbench` instance — see the
 * `useWorkbenchAutoRestore` no-op below for why that's now a deliberate
 * in-workbench browse rather than a "stale workbench, close it" case.
 *
 * Founder bug fix (2026-08-04b) — sibling of the equity dashboard's
 * "focused symbol lost on refresh" fix. `underlying` now persists across a
 * refresh via `?focus=` (`useFocusUrlParam` — see that hook's own doc for
 * why it's a SEPARATE param from `?underlying=`, not a reuse of it: this
 * page's `remountKey` wrapper below treats `?underlying=` changing as "a
 * new deep link arrived, give this page a fresh instance," and continuously
 * writing in-page browsing back into that same param would make every
 * ordinary underlying switch look like a fresh deep link and blow away the
 * loaded account/selected-contract state). `?side=` is genuinely one-shot
 * (a Sell/Close chip's side, always derived from the position being closed
 * — see positions-strip.tsx) — `useFrozenSearchParams`/
 * `useStripOneShotParams` give it the same "seed once, strip after" fix the
 * equity ticket got, so refreshing after a Close tap never re-arms it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { PriceChart, type ChartOrderLine, type PricePoint } from "@/components/finance/price-chart";
import {
  FuturesContractTable,
  type FuturesQuoteSnapshot,
  type SelectedFuturesContract
} from "@/components/paper-trading/futures-contract-table";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { PendingOrdersPanel } from "@/components/paper-trading/pending-orders-panel";
import { DockedOrderTicket } from "@/components/paper-trading/terminal/docked-order-ticket";
import { PositionsStrip, type PositionChip } from "@/components/paper-trading/terminal/positions-strip";
import { TerminalHeader } from "@/components/paper-trading/terminal/terminal-header";
import { TerminalShell } from "@/components/paper-trading/terminal/terminal-shell";
import { DynamicChartWorkbench, WorkbenchMaximizeButton } from "@/components/paper-trading/workbench/workbench-maximize-button";
import type { PlacedFuturesOrderPayload } from "@/lib/paperTrading/futuresOrdersClient";
import { cancelPendingOrder, repricePendingOrder, type PendingOrderPayload } from "@/lib/paperTrading/pendingOrdersClient";
import { usePriceOverrides } from "@/components/paper-trading/use-price-overrides";
import {
  useFocusUrlParam,
  useFrozenSearchParams,
  useStripOneShotParams,
  useWorkbenchAutoRestore,
  useWorkbenchUrlParam
} from "@/components/paper-trading/use-workbench-url-param";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LoadState = "loading" | "signed-out" | "ready";

interface FuturesPositionSummary {
  underlyingSymbol: string;
  expiryDate: string;
  side: "LONG" | "SHORT";
  lots: number;
  /** Chart Trading + SL/TP (Sprint B) — the position line's price and the "ref ₹X (daily MTM)" label both need this; telescopes daily via the MTM cron, never a static entry price (see queries.ts's FuturesPositionRow doc). */
  referencePrice: number;
  todayMtmPnl: number | null;
}

interface AccountSummary {
  cash: number;
  totalValue: number;
  todayNetPnl: number;
  lifetimeNetPnl: number;
  futuresPositions: FuturesPositionSummary[];
  totalFuturesMarginRequired: number;
  /** Chart Trading + SL/TP (Sprint B) — this account's resting pending futures orders, for the chart's order-line overlay. */
  pendingOrders: PendingOrderPayload[];
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Compact signed rupee format for order-line labels (0dp — the chart has no room for paise). */
function formatSignedRupeesShort(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const EMPTY_SERIES: PricePoint[] = [];

export function FuturesPageClient() {
  const searchParams = useSearchParams();
  // Founder bug fix (2026-08-06) — the `?workbench=` param (see
  // use-workbench-url-param.ts) must NOT be part of this remount key: this
  // wrapper deliberately gives FuturesPageClientInner a fresh instance
  // whenever the query string changes (a new deep-link navigation resets
  // deep-link-derived state cleanly — see the doc above), but toggling the
  // workbench open/closed does its OWN router.replace and must not blow
  // away the selected contract / loaded account / everything else just to
  // persist one flag.
  //
  // Founder bug fix (2026-08-04b) — `?focus=` (the persisted-underlying
  // channel) and `?side=` (one-shot, stripped after consumption) get the
  // SAME exclusion, for the same reason: both are written by
  // FuturesPageClientInner's OWN bookkeeping after it's already mounted, so
  // letting either changing count as "a new deep link arrived" would force
  // an immediate, unwanted second remount right after mount (undoing the
  // very persistence/one-shot-strip this fix exists to add). A REAL new
  // deep link always still differs in `underlying`/`expiry` too (the
  // combination that actually identifies a different contract), so this
  // exclusion doesn't weaken the "fresh instance per genuinely new deep
  // link" guarantee documented above.
  const remountKey = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workbench");
    params.delete("focus");
    params.delete("side");
    return params.toString();
  }, [searchParams]);
  return <FuturesPageClientInner key={remountKey} />;
}

function FuturesPageClientInner() {
  // Founder bug fix (2026-08-04b) — `deepLinkSide` is genuinely one-shot
  // (see this file's own module doc) and gets stripped from the live URL
  // shortly after mount; reading it from the FROZEN snapshot instead of the
  // live `searchParams` means the async auto-select below (`handleQuoteData`)
  // still sees it correctly even if that strip has already landed by the
  // time a matching quote arrives. `deepLinkUnderlying`/`deepLinkExpiry`
  // read from the same frozen snapshot purely for consistency — neither is
  // ever stripped, so this is behavior-neutral for them.
  const frozenParams = useFrozenSearchParams();
  useStripOneShotParams(["side"]);
  const deepLinkUnderlying = frozenParams.get("underlying");
  const deepLinkExpiry = frozenParams.get("expiry");
  const deepLinkSide = frozenParams.get("side") === "SELL" ? ("SELL" as const) : frozenParams.get("side") === "BUY" ? ("BUY" as const) : null;
  const [focusParam, setFocusParam] = useFocusUrlParam();

  const [state, setState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState("");

  const [underlying, setUnderlying] = useState<string>(deepLinkUnderlying ?? focusParam ?? "NIFTY");
  // Founder bug fix (2026-08-04b) — every path that changes `underlying`
  // (the contract table's own selector, the deep-link auto-select below)
  // funnels through this ONE setState, so a single effect here is enough to
  // keep `?focus=` mirroring it — no need to touch each call site
  // individually. Guarded on inequality so it can never loop (see
  // paper-trading-dashboard.tsx's identical guard on its own `?symbol=` sync).
  useEffect(() => {
    if (underlying && underlying !== focusParam) setFocusParam(underlying);
  }, [underlying, focusParam, setFocusParam]);
  const [selectedContract, setSelectedContract] = useState<SelectedFuturesContract | null>(null);
  const [presetSide, setPresetSide] = useState<"BUY" | "SELL">(deepLinkSide ?? "BUY");
  const [presetLots, setPresetLots] = useState(1);
  const [selectionNonce, setSelectionNonce] = useState(0);
  const [spot, setSpot] = useState<number | null>(null);

  // Charting Workbench (W2) — see paper-trading-dashboard.tsx's identical
  // doc for the ticket single-mount reasoning.
  //
  // Founder bug fix (2026-08-06) — refresh-persistence via `?workbench=1`,
  // same `useWorkbenchAutoRestore` mechanism as paper-trading-dashboard.tsx
  // (see that file's doc + use-workbench-url-param.ts for the full
  // restore-vs-real-change race it avoids). `underlying` here is resolved
  // SYNCHRONOUSLY on the very first render (`deepLinkUnderlying ?? "NIFTY"`,
  // never null) — the hook still works unmodified: its "first resolution"
  // just happens on the initial effect run instead of a later one.
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
    underlying,
    workbenchParam === "1",
    () => setWorkbenchOpenState(true),
    () => {
      // Founder feature (Contract table in maximized workbench, 2026-08-09) —
      // mirrors options-page-client.tsx's identical no-op (see that file's
      // doc for the full reasoning). `FuturesContractTable` is null'd out of
      // `TerminalShell`'s ladder slot while the workbench is open (see
      // `contractTableElement` below) and reappears ONLY inside the
      // workbench's own Contracts tab — so the only way `underlying` can
      // still change while this workbench is open is the embedded table's
      // own underlying-selector buttons, a deliberate in-workbench browse,
      // never a reason to auto-close. A real page-level navigation away from
      // this terminal unmounts `FuturesPageClientInner` entirely (see
      // `remountKey` above), so this no-op can never mask a genuinely stale
      // workbench. (Before this feature, switching `underlying` while the
      // workbench was open could ONLY happen via the still-visible-behind-
      // the-modal ladder outside the workbench, which really was a "stale
      // workbench for the previous underlying" case — that path no longer
      // exists now that the ladder is null'd out instead.)
    }
  );

  const [lastOrder, setLastOrder] = useState<PlacedFuturesOrderPayload | null>(null);
  const [pendingOrderNotice, setPendingOrderNotice] = useState<string | null>(null);

  // Chart Trading + SL/TP (Sprint B, B3 / Sprint C, C2) — chart-click preset
  // channel, reused via the SAME `selectionNonce` the ladder [B]/[S] taps
  // already bump (see handleSelectContract's own doc comment). Sprint B's
  // click was LIMIT-only and never touched side; Sprint C's popover
  // confirms an explicit side AND variant (LIMIT or STOP), so `presetSide`
  // is now also SET by a click (not just read), and `presetOrderType`
  // widens to include "STOP" with its own `presetTriggerPrice` field.
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
        totalValue: a?.totalValue ?? a?.cash ?? 0,
        todayNetPnl: a?.todayNetPnl ?? 0,
        lifetimeNetPnl: a?.lifetimeNetPnl ?? 0,
        futuresPositions: (a?.futuresPositions ?? []).map(
          (p: {
            underlyingSymbol: string;
            expiryDate: string;
            side: "LONG" | "SHORT";
            lots: number;
            referencePrice: number;
            todayMtmPnl: number | null;
          }) => ({
            underlyingSymbol: p.underlyingSymbol,
            expiryDate: p.expiryDate,
            side: p.side,
            lots: p.lots,
            referencePrice: p.referencePrice,
            todayMtmPnl: p.todayMtmPnl
          })
        ),
        totalFuturesMarginRequired: a?.totalFuturesMarginRequired ?? 0,
        pendingOrders: a?.pendingOrders ?? []
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
    // A fresh ladder tap always starts from a clean order type (MARKET) —
    // never carries a stale chart-click preset from a PREVIOUS contract/click
    // forward into this new selection.
    setPresetOrderType(undefined);
    setPresetLimitPrice(undefined);
    setPresetTriggerPrice(undefined);
    setSelectionNonce((n) => n + 1);
  }

  // Chart Trading + SL/TP (Sprint C, C2) — clicking the underlying spot chart
  // opens the order-intent popover, and confirming a choice prefills the
  // ticket on the CURRENTLY selected contract via the SAME `selectionNonce`
  // channel ladder taps use (decision 3 of the Sprint C brief). Guarded on
  // `selectedContract` — with nothing selected yet there is no contract to
  // attach a price to, and no ticket visible to prefill.
  function handleOrderIntentConfirm(input: { price: number; side: "BUY" | "SELL"; variant: "LIMIT" | "STOP" }) {
    if (!selectedContract) return;
    setPresetSide(input.side);
    setPresetOrderType(input.variant);
    setPresetLimitPrice(input.variant === "LIMIT" ? input.price : undefined);
    setPresetTriggerPrice(input.variant === "STOP" ? input.price : undefined);
    setSelectionNonce((n) => n + 1);
  }

  function handleOrderLineCancel(id: string) {
    if (id.startsWith("position-")) return;
    void cancelPendingOrder(id).then((result) => {
      if (result.ok) void loadAccount();
    });
  }

  // Chart Trading + SL/TP (Sprint C, C1) — drag-to-reprice optimistic-UI
  // wiring, identical contract to paper-trading-dashboard.tsx's (see
  // use-price-overrides.ts's own doc for the anti-snap-back reasoning).
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
      clearPriceOverride(id);
      setRepriceError(result.error);
      return;
    }
    await loadAccount();
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
  // Quote-driven intrabar ticks (2026-08-04) — the index quote sibling of
  // indexIntradaySource, required for PriceChart to enable its fast poll at
  // all (it never guesses a quote URL for a non-default `intradaySource`).
  const indexQuoteSource = { url: `/api/instruments/index/${underlying}/quote` };

  // Chart Trading + SL/TP (Sprint B, B3) — order lines for the CURRENTLY
  // charted underlying's pending orders (any expiry — the underlying's spot
  // chart is shared across all its contract months) and held positions.
  // Decision 5 of the Sprint B brief (honesty requirement): every line here
  // carries an explicit "FUT {expiry}" tag distinguishing it from a spot-price
  // reading, and a held position is labeled "ref ₹X (daily MTM)" — never
  // implying it's a live entry average, since referencePrice telescopes
  // daily via the MTM cron.
  const orderLines: ChartOrderLine[] = [
    ...account.pendingOrders
      .filter((o) => o.instrumentKind === "INDEX_FUTURE" && o.underlyingSymbol === underlying)
      .map((o): ChartOrderLine => {
        // Sprint C, C1 — an active optimistic drag override wins over the
        // account payload's own price (see use-price-overrides.ts).
        const price = priceOverrides[o.id] ?? (o.variant === "STOP" ? (o.triggerPrice ?? o.limitPrice) : o.limitPrice);
        const expiryLabel = o.expiryDate ? formatNseExpiryDate(new Date(o.expiryDate)) : "";
        return {
          id: o.id,
          price,
          kind: o.variant === "STOP" ? "pending-stop" : "pending-limit",
          side: o.side,
          label: `FUT ${expiryLabel} ${o.variant} ${o.side} ${o.lots ?? 0} lot(s) @ ${formatRupees(price)}`,
          cancellable: true,
          draggable: true
        };
      }),
    ...account.futuresPositions
      .filter((p) => p.underlyingSymbol === underlying)
      .map(
        (p): ChartOrderLine => ({
          id: `position-${p.underlyingSymbol}-${p.expiryDate}`,
          price: p.referencePrice,
          kind: "position",
          side: p.side === "SHORT" ? "SELL" : "BUY",
          label:
            `FUT ${formatNseExpiryDate(new Date(p.expiryDate))} ref ${formatRupees(p.referencePrice)} (daily MTM)` +
            (p.todayMtmPnl != null ? ` · ${formatSignedRupeesShort(p.todayMtmPnl)}` : ""),
          cancellable: false
        })
      )
  ];

  // Charting Workbench (W2) — ONE ticket element instance, reused verbatim
  // whether it renders in TerminalShell's own slot or inside the maximized
  // workbench (ticket single-mount rule — see paper-trading-dashboard.tsx's
  // identical doc).
  const ticketElement = (
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

  // Founder feature (Contract table in maximized workbench, 2026-08-09) —
  // ONE `FuturesContractTable` element instance, reused verbatim whether it
  // renders in `TerminalShell`'s own ladder slot or inside a maximized
  // workbench's new Contracts tab (the exact single-mount conditional-swap
  // idiom `ticketElement` above already uses, and the same idiom options-
  // page-client.tsx's `chainElement` established). Same props the ladder
  // slot always passed — `onUnderlyingChange`/`onSelectContract`/
  // `onQuoteData` work identically from inside the workbench, since none of
  // those callbacks are aware of WHERE the table is currently mounted.
  const contractTableElement = (
    <FuturesContractTable
      underlying={underlying}
      onUnderlyingChange={(u) => {
        setUnderlying(u);
        setSelectedContract(null);
        setPresetOrderType(undefined);
        setPresetLimitPrice(undefined);
        setPresetTriggerPrice(undefined);
      }}
      onSelectContract={handleSelectContract}
      onQuoteData={handleQuoteData}
      spot={spot}
      getHeldLots={(u, expiry) => getHeldPosition(u, expiry)}
    />
  );

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
            <div className="relative">
              <WorkbenchMaximizeButton onClick={() => setWorkbenchOpen(true)} />
              <PriceChart
                key={underlying}
                symbol={underlying}
                series={EMPTY_SERIES}
                defaultTimeframe="1D"
                intradaySource={indexIntradaySource}
                quoteSource={indexQuoteSource}
                orderLines={orderLines}
                onOrderIntentConfirm={handleOrderIntentConfirm}
                onOrderLineDrag={handleOrderLineDrag}
                onOrderLineCancel={handleOrderLineCancel}
                pollIntervalMs={60_000}
              />
            </div>
          </div>
        }
        ladder={workbenchOpen ? null : contractTableElement}
        ticket={workbenchOpen ? null : ticketElement}
        positions={<PositionsStrip positions={positionChips} />}
      />

      {workbenchOpen && (
        <DynamicChartWorkbench
          feed={{ kind: "index", symbol: underlying }}
          chartKey={`INDEX:${underlying}`}
          title={`${underlying} (Futures — index spot)`}
          onClose={() => setWorkbenchOpen(false)}
          orderLines={orderLines}
          onOrderIntentConfirm={handleOrderIntentConfirm}
          onOrderLineDrag={handleOrderLineDrag}
          onOrderLineCancel={handleOrderLineCancel}
          ticket={ticketElement}
          chain={contractTableElement}
          chainLabel="Contracts"
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
