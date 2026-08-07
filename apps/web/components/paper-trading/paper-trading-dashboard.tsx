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
 * Founder bug fix (2026-08-04b) — "whenever I refresh, [a different holding]
 * is shown instead of what I was looking at": `?symbol=` is now BOTH the
 * one-shot deep-link entry point above AND the live focus-persistence
 * channel — every focus change (search select, a holdings-row tap, the
 * Sell-button navigation) keeps it in sync via `useSymbolUrlParam`
 * (use-workbench-url-param.ts), and a refresh restores from it instead of
 * falling through to `largestHoldingSymbol` (the actual root cause of the
 * report: that fallback sat ABOVE the localStorage-remembered symbol in the
 * old priority chain, so a refresh silently re-focused the biggest holding
 * by value — e.g. INDIGO — over whatever smaller position, e.g. SHRIRAM
 * FINANCE, the founder had actually navigated to). `side`/`productType`/
 * `quantity` stay genuinely ONE-SHOT: `useFrozenSearchParams` captures them
 * before `useStripOneShotParams` removes them from the live URL shortly
 * after mount, so a later refresh of the SAME address-bar entry (e.g. after
 * following a Sell deep-link) never re-arms a stale ticket — see both
 * hooks' own docs for the exact race this closes.
 *
 * QA fix (2026-08-05) — two regressions the 2026-08-04b fix above shipped
 * with. (1) `focusedSymbol` used to be a `??` PRIORITY CHAIN
 * (`symbolParam ?? manualFocus ?? largestHoldingSymbol ?? restoredLastFocus`)
 * with an echo effect writing the resolved value back into `?symbol=`. Once
 * that echo landed once, `symbolParam` was non-null on every later render
 * and PERMANENTLY outranked `manualFocus` — so search-select and
 * holdings-row clicks became silent no-ops after the first change. (2) This
 * page had no `remountKey` wrapper (unlike futures-page-client.tsx/
 * options-page-client.tsx), so an in-app, query-only navigation to this
 * same route (a holdings-row Sell tap while already here) re-rendered the
 * SAME component instance, and a mount-frozen params snapshot never saw the
 * new `side`/`productType`/`quantity` — the ticket silently failed to
 * re-arm.
 *
 * QA fix, ROUND 3 (2026-08-05) — the round-2 fix for both bugs above
 * shipped with two NEW, more severe regressions, both traced live via
 * `history.replaceState`/`pushState` instrumentation:
 * (B1) round 2 made `?symbol=` a live, continuously-synced persistence
 * channel (mirrored one-directionally out of `focusedSymbol`) AND kept it
 * readable by `useWorkbenchAutoRestore`'s own `router.replace` in the same
 * commit — `router.replace` does not apply synchronously, so whichever
 * effect's replace landed SECOND silently clobbered the first's write,
 * and every focus change after the account's initial bootstrap failed to
 * persist. (B2) round 2's `remountKey` wrapper decided "is this a new deep
 * link" from whether `side`/`productType`/`quantity`/`linkedOpinionId` were
 * CURRENTLY present in the live URL — but the freshly-remounted instance's
 * OWN `useStripOneShotParams` removed those same params ~114ms later (its
 * documented job), which ALSO changed `useSearchParams()` the outer
 * wrapper's key depended on, triggering a SECOND spurious remount whose own
 * frozen-params snapshot captured the ALREADY-STRIPPED url — losing the
 * one-shot values entirely, so a same-page Sell click never armed the
 * ticket. See `feedback_remountkey_self_defeating_strip_cascade.md` and
 * `feedback_strictmode_double_invoke_defeats_ref_guard.md`'s sibling entry
 * for the full traces.
 *
 * Round 3's fix is architectural, not another patch on top: the URL is no
 * longer BOTH a persistence store and a one-shot input for this page.
 * (1) `?symbol=` is GONE — the focused symbol persists to
 * `window.localStorage` (`LAST_FOCUSED_SYMBOL_KEY`) ONLY, written by every
 * changer (`setFocusedSymbol`); a refresh restores from localStorage, never
 * from the URL, so there is no second writer left to race B1 against.
 * (2) There is no more page-level `remountKey` wrapper at all. A single
 * effect, keyed on the live search-params string, is the ONLY consumer of
 * one-shot deep-link fields (`side`/`productType`/`quantity`/`symbol`/
 * `linkedOpinionId`): it applies them imperatively to state (focused
 * symbol + `armedSide`/`armedProductType`/`armedQuantity`/
 * `armedLinkedOpinionId`), bumps a monotonic `armToken` counter, and THEN
 * strips those keys from the URL — folded into the SAME effect rather than
 * a separate one-shot hook, specifically so it can run again for a SECOND
 * (or Nth) deep link that arrives later in this page's single lifetime,
 * not just once ever. `armToken` (not the frozen params) is what forces the
 * ticket to re-arm on every new deep link — the ticket already remounts off
 * its own `key` prop, this just gives it a fresh reason to on every arm
 * instead of relying on the PAGE remounting. Cold-load deep links
 * (a shared link landing directly on `?symbol=...&side=SELL...`) flow
 * through this exact same effect on its first run.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
import type { SymbolPick } from "@/components/paper-trading/workbench/use-symbol-search";
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

/**
 * Round 3 (2026-08-05) — no more outer `remountKey` wrapper (see this
 * file's own module doc for why that mechanism was self-defeating). This
 * component reads `useSearchParams()` directly, which is why
 * `app/paper-trading/page.tsx` still wraps it in a `<Suspense>` boundary —
 * that requirement is independent of any remount mechanism.
 */
export function PaperTradingDashboard() {
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const router = useRouter();
  const pathname = usePathname();
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

  // ── Focused symbol (round 3, 2026-08-05): a PLAIN useState set DIRECTLY
  // by every changer (search-select, a holdings-row click, the deep-link
  // effect below, the Sell-button/CTA deep-link via `onOrderPlaced`) — the
  // exact pattern futures-page-client.tsx's `underlying` state already
  // uses. NOT initialized from the URL — this page carries no persisted
  // `?symbol=` param at all anymore (see this file's own module doc on why
  // that mirror was dropped). It resolves via effect, shortly after mount:
  // a one-shot `?symbol=` deep link wins immediately; otherwise the
  // bootstrap fallback below fills in "largest holding by value > last
  // focused (localStorage) > null (search prompt)".
  const [focusedSymbol, setFocusedSymbolState] = useState<string | null>(null);
  const [restoredLastFocus, setRestoredLastFocus] = useState<string | null | undefined>(undefined); // undefined = not yet read from storage

  useEffect(() => {
    try {
      setRestoredLastFocus(window.localStorage.getItem(LAST_FOCUSED_SYMBOL_KEY));
    } catch {
      setRestoredLastFocus(null);
    }
  }, []);

  // One-shot ticket-arm fields — what a deep link (Sell-button/opinion-CTA)
  // wants the docked ticket seeded with. Plain defaults (BUY/DELIVERY/no
  // quantity/no linked opinion) until the deep-link effect below applies a
  // real one. `armToken` is a monotonically-increasing counter, folded into
  // the ticket's own `key` in the render below, so every NEW deep link
  // forces a fresh ticket instance even when every other field happens to
  // coincide with the previous arm (e.g. two Sell taps on different rows
  // with the same quantity) — see this file's own module doc.
  const [armedSide, setArmedSide] = useState<"BUY" | "SELL">("BUY");
  const [armedProductType, setArmedProductType] = useState<"DELIVERY" | "INTRADAY">("DELIVERY");
  const [armedQuantity, setArmedQuantity] = useState<number | undefined>(undefined);
  const [armedLinkedOpinionId, setArmedLinkedOpinionId] = useState<string | null>(null);
  const [armToken, setArmToken] = useState(0);

  // Shared between the deep-link effect and the bootstrap-fallback effect
  // below — set the instant EITHER has resolved a focused symbol, so
  // whichever runs second (same commit) never races to also set one. A ref
  // mutated synchronously inside an earlier-declared effect is visible to a
  // later effect in the SAME commit even though React state closures are
  // not (same technique script-editor-drawer.tsx's merged restore/sync
  // effect uses for the identical class of same-commit staleness).
  const bootstrappedRef = useRef(false);

  // Writes `focusedSymbol` + localStorage ONLY — no ticket-arm side
  // effects. Used by the deep-link effect below (which sets the arm fields
  // itself, in the SAME breath, from the URL) so it doesn't clobber its own
  // work by routing through `setFocusedSymbol`'s unconditional arm-reset.
  const applyFocusedSymbol = useCallback((symbol: string) => {
    setFocusedSymbolState(symbol);
    try {
      window.localStorage.setItem(LAST_FOCUSED_SYMBOL_KEY, symbol);
    } catch {
      // Preference just won't persist.
    }
  }, []);

  // The general "user manually focused this symbol" entry point —
  // search-select, a holdings-row click, and the post-order callback all go
  // through this. Always resets the ticket-arm fields to defaults: a manual
  // focus switch is never itself an armed deep link, and without this reset
  // a stale SELL/quantity from a PREVIOUS deep link could leak onto the
  // newly-focused symbol's ticket. Inert when the ticket doesn't actually
  // remount (e.g. `onOrderPlaced` re-focusing the symbol that's already
  // focused) since it never rereads these props without a key change.
  const setFocusedSymbol = useCallback(
    (symbol: string) => {
      bootstrappedRef.current = true; // an explicit pick always wins outright — see applyFocusedSymbol's own callers for why this guard matters.
      applyFocusedSymbol(symbol);
      setArmedSide("BUY");
      setArmedProductType("DELIVERY");
      setArmedQuantity(undefined);
      setArmedLinkedOpinionId(null);
    },
    [applyFocusedSymbol]
  );

  const largestHoldingSymbol = useMemo(() => {
    if (!account || account.deliveryHoldings.length === 0) return null;
    const byValue = [...account.deliveryHoldings].sort(
      (a, b) => Math.abs(b.quantity * (b.latestLtp ?? b.avgCost)) - Math.abs(a.quantity * (a.latestLtp ?? a.avgCost))
    );
    return byValue[0]?.symbol ?? null;
  }, [account]);

  // ── One-shot deep-link consumption (round 3, 2026-08-05) — replaces the
  // OLD `remountKey` wrapper + frozen/strip hook combo entirely (see this
  // file's own module doc — that combo was self-defeating: the wrapper's
  // key depended on whether one-shot params were STILL present, but the
  // freshly-mounted instance's own strip removed them ~114ms later,
  // triggering a second spurious remount that froze the already-stripped
  // URL). This page never remounts for a deep link now. ONE effect, keyed
  // on the live search-params string, is the sole consumer of
  // `side`/`productType`/`quantity`/`symbol`/`linkedOpinionId`: it applies
  // them to state, bumps `armToken`, then strips those keys from the URL —
  // all in the SAME effect, so it can fire again for a SECOND (or Nth) deep
  // link that arrives later in this page's single lifetime, not just once.
  // The post-strip URL change re-triggers this same effect; the
  // `hasOneShot` guard below makes that rerun (and any unrelated param
  // change, e.g. `?workbench=`) an immediate no-op — no loop, no
  // double-apply. Declared BEFORE the bootstrap-fallback effect so it
  // always runs first within a shared commit and can set `bootstrappedRef`
  // before bootstrap gets a chance to race it (see that ref's own doc).
  // Cold-load deep links flow through this exact same effect on its first
  // run — there is no separate one-time/lazy-init path for them.
  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : searchParamsString);
    const oneShotKeys = ["side", "productType", "quantity", "symbol", "linkedOpinionId"] as const;
    const hasOneShot = oneShotKeys.some((k) => params.has(k));
    if (!hasOneShot) return;

    const symbol = params.get("symbol");
    const side = params.get("side") === "SELL" ? "SELL" : "BUY";
    const productType = params.get("productType") === "INTRADAY" ? "INTRADAY" : "DELIVERY";
    const rawQuantity = params.get("quantity");
    const parsedQuantity = rawQuantity != null ? Number(rawQuantity) : NaN;
    const quantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : undefined;
    const linkedOpinionId = params.get("linkedOpinionId");

    bootstrappedRef.current = true; // a deep link always wins outright — nothing left to bootstrap.
    if (symbol) applyFocusedSymbol(symbol);
    setArmedSide(side);
    setArmedProductType(productType);
    setArmedQuantity(quantity);
    setArmedLinkedOpinionId(linkedOpinionId);
    setArmToken((t) => t + 1);

    for (const k of oneShotKeys) params.delete(k);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsString]);

  // Bootstrap fallback — fires at most once (`bootstrappedRef`, shared with
  // the deep-link effect above), and only when no deep link resolved
  // anything. Gated on `state === "ready"` (not just `account` truthy) so
  // this doesn't fire a tick before the account's holdings are actually
  // available.
  //
  // Round 3 (2026-08-05) — `restoredLastFocus` (localStorage) now OUTRANKS
  // `largestHoldingSymbol`, reversed from the priority order this fallback
  // used to have. That old order (largest-holding-first) was the ORIGINAL
  // founder bug (INDIGO shown instead of the smaller SHRIRAM FINANCE
  // position the founder had actually navigated to) — it was merely masked
  // in round 2 because `?symbol=` (once written) permanently dominated this
  // bootstrap fallback on every later visit, so the fallback's OWN internal
  // ordering was only ever exercised on a session's truest-first-ever
  // resolution. Now that `?symbol=` is gone and localStorage is the ONLY
  // persistence channel, this fallback runs the SAME comparison on every
  // cold load — leaving largest-holding-first would silently revert every
  // refresh back to the biggest position, defeating the very persistence
  // guarantee this round exists to deliver. A real, explicit focus (search-
  // select, a holdings-row click, a Sell tap) always wins over an automatic
  // "biggest position" guess; "largest holding" now only applies on a
  // genuinely fresh device/browser with no remembered focus at all.
  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (focusedSymbol) {
      bootstrappedRef.current = true; // resolved by the deep-link effect above in this same commit — nothing to bootstrap.
      return;
    }
    if (state !== "ready" || restoredLastFocus === undefined) return; // wait for both to resolve
    bootstrappedRef.current = true;
    const fallback = restoredLastFocus ?? largestHoldingSymbol ?? null;
    if (fallback) setFocusedSymbolState(fallback);
  }, [focusedSymbol, state, restoredLastFocus, largestHoldingSymbol]);

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
  // Round 3 (2026-08-05) — only write `?workbench=` when the target value
  // actually DIFFERS from the current one. `useWorkbenchAutoRestore`'s own
  // "close on every real focus change" call site below invokes this
  // unconditionally on EVERY focus change, including the overwhelmingly
  // common case where the workbench was never open to begin with (nothing
  // to close, nothing to write) — that redundant `router.replace` used to
  // fire regardless, and its async `window.location.search` read raced the
  // deep-link effect's own strip above: whichever landed last won, and a
  // no-op "close" write that happened to read a not-yet-visible strip would
  // silently restore the just-stripped one-shot params right back onto the
  // URL. Skipping the write entirely when there's nothing to change removes
  // that race at its source rather than trying to out-order it.
  const setWorkbenchOpen = useCallback(
    (open: boolean) => {
      setWorkbenchOpenState(open);
      const nextParam = open ? "1" : null;
      if (nextParam !== workbenchParam) setWorkbenchParam(nextParam);
    },
    [setWorkbenchParam, workbenchParam]
  );
  useWorkbenchAutoRestore(
    focusedSymbol,
    workbenchParam === "1",
    () => setWorkbenchOpenState(true),
    () => {
      // Founder feature (2026-08-07) — live-verified regression: before the
      // workbench's own symbol switcher existed, `focusedSymbol` could ONLY
      // change via the small (non-maximized) search input/holdings-row
      // clicks — both live in `TerminalShell`'s `chart` slot, which sits
      // BEHIND the workbench's opaque `fixed inset-0 z-50` overlay while
      // it's open and is therefore genuinely unreachable then; this
      // no-op's PREVIOUS unconditional `setWorkbenchOpen(false)` was
      // consequently dead code in that state (it could only ever fire while
      // the workbench was already closed, where "closing" it is itself a
      // no-op) — never actually observed until now. `chart-workbench.tsx`'s
      // new header symbol-search popover is the first, and only, way
      // `focusedSymbol` can change WHILE this workbench is open — a
      // deliberate in-workbench browse, the exact same "new feed/chartKey
      // props on the same still-mounted ChartWorkbench instance, no
      // remount" case futures-page-client.tsx's/options-page-client.tsx's
      // own identical no-op already documents for their embedded Chain/
      // Contracts tabs. Verified live: the unconditional close version of
      // this callback silently closed the workbench and stripped
      // `?workbench=1` on every equity-to-equity in-place pick.
    }
  );

  const eodSeries = useEodSeries(focusedSymbol);

  /**
   * Founder feature (2026-08-07) — the maximized workbench's symbol
   * switcher (`chart-workbench.tsx`'s clickable header title). This
   * terminal's workbench only ever charts `feed:{kind:"equity"}` (see the
   * mount below) — an EQUITY pick switches it IN PLACE via the exact same
   * `setFocusedSymbol` every other "focus this symbol" entry point already
   * uses (search-select, a holdings-row click — see that function's own
   * doc), so `focusedSymbol` changing is what drives the still-mounted
   * `ChartWorkbench` instance's `feed`/`chartKey`/`title` props to the new
   * symbol with no remount. An INDEX pick (one of the 5 F&O underlyings)
   * has no in-place home here — this terminal has no index feed wiring at
   * all — so it NAVIGATES to the futures terminal instead, with
   * `?workbench=1` auto-maximizing that terminal's own workbench on
   * arrival (see `use-workbench-url-param.ts`'s `useWorkbenchAutoRestore`
   * for the mechanics: `underlying` resolves synchronously there, so the
   * restore fires on the very first render). Never fakes an in-place
   * switch with the wrong feed kind.
   *
   * Founder bug fix (2026-08-07b) — action-chip targets. "Chart" on an
   * equity row here is a plain in-place switch (already this terminal's own
   * default equity behavior — the chip is only reachable on an equity row
   * to begin with). "Option chain"/"Futures" ALWAYS navigate, even though
   * `pick.symbol` could in principle already be `focusedSymbol` — this is a
   * genuine cross-terminal jump, never something this page can satisfy
   * in-place (no option-chain or futures-contract UI lives on the equity
   * dashboard). See symbol-search-popover.tsx's own doc for which chips a
   * row actually gets.
   */
  function handleWorkbenchSymbolPick(pick: SymbolPick) {
    if (pick.target === "optionChain") {
      router.push(`/paper-trading/options?underlying=${encodeURIComponent(pick.symbol)}&workbench=underlying`);
      return;
    }
    if (pick.target === "futures") {
      router.push(`/paper-trading/futures?underlying=${encodeURIComponent(pick.symbol)}&workbench=1`);
      return;
    }
    if (pick.kind === "equity") {
      setFocusedSymbol(pick.symbol);
    } else {
      router.push(`/paper-trading/futures?underlying=${encodeURIComponent(pick.symbol)}&workbench=1`);
    }
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

  // Round 3 (2026-08-05) — the ticket's seed values now come straight from
  // the `armed*` state the deep-link effect (above) populated, not a frozen
  // URL snapshot — there is no more URL snapshot to freeze, one-shot fields
  // live in state from the moment they're consumed. `armToken` (folded into
  // `ticketElement`'s `key` below) is what forces a fresh ticket instance
  // per deep link now, so these can be read directly without any risk of a
  // later strip flipping them back to defaults out from under an
  // already-rendered ticket.
  const initialSide = armedSide;
  const initialProductType = armedProductType;
  const initialQuantity = armedQuantity;
  const linkedOpinionId = armedLinkedOpinionId;

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
      key={`${focusedSymbol ?? ""}-${armToken}`}
      kind="equity"
      cash={account.availableCash}
      heldDeliveryQtyBySymbol={heldDeliveryQtyBySymbol}
      hasSoldDeliveryTodayBySymbol={hasSoldDeliveryTodayBySymbol}
      initialSymbol={focusedSymbol}
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
      liveLtp={chartQuote?.price ?? null}
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
          onSymbolPick={handleWorkbenchSymbolPick}
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
          <PositionsTable
            rows={account.deliveryHoldings}
            emptyLabel="No open delivery holdings."
            productType="DELIVERY"
            focusedSymbol={focusedSymbol}
            liveLtp={chartQuote?.price ?? null}
            onFocusSymbol={setFocusedSymbol}
          />
        </CardContent>
      </Card>

      {account.openIntradayPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open intraday positions (today)</CardTitle>
            <CardDescription>Auto-squared-off near market close if still open.</CardDescription>
          </CardHeader>
          <CardContent>
            <PositionsTable
              rows={account.openIntradayPositions}
              emptyLabel="No open intraday positions."
              productType="INTRADAY"
              focusedSymbol={focusedSymbol}
              liveLtp={chartQuote?.price ?? null}
              onFocusSymbol={setFocusedSymbol}
            />
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

function PositionsTable({
  rows,
  emptyLabel,
  productType,
  focusedSymbol,
  liveLtp,
  onFocusSymbol
}: {
  rows: PositionRow[];
  emptyLabel: string;
  productType: "DELIVERY" | "INTRADAY";
  /** Founder bug fix (2026-08-04b) — which symbol (if any) the terminal chart above is currently focused on, so this table can show a LIVE LTP for that one row (see `liveLtp`'s own doc) and highlight it. */
  focusedSymbol?: string | null;
  /** The chart's own live quote-tick price for `focusedSymbol` (shared with price-chart.tsx's `useLiveQuoteTick` poll via the dashboard's `onQuoteChange` — never a second poll). Only ever applied to the row matching `focusedSymbol`; every other row stays on the account payload's own 60s-refreshed `latestLtp` — polling a live tick per holding would hammer the quote endpoint for zero benefit on rows the user isn't even looking at. */
  liveLtp?: number | null;
  /** Founder bug fix (2026-08-04b) — clicking a row's symbol focuses the terminal chart on it, the same "selecting a stock" action search/Sell already trigger — wired to `setFocusedSymbol`, which also keeps `?symbol=` in sync for refresh-persistence. */
  onFocusSymbol?: (symbol: string) => void;
}) {
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
          {rows.map((row) => {
            const isFocused = focusedSymbol != null && row.symbol === focusedSymbol;
            // Founder bug fix (2026-08-04b) — the focused row's LTP ticks
            // live with the chart; every other row stays on the account
            // payload's own load-time/60s-poll snapshot (see this
            // component's own prop doc on why that boundary is deliberate).
            const displayLtp = isFocused && liveLtp != null ? liveLtp : row.latestLtp;
            return (
              <TableRow key={row.symbol}>
                <TableCell className="font-medium text-ink-900">
                  {onFocusSymbol ? (
                    <button
                      type="button"
                      onClick={() => onFocusSymbol(row.symbol)}
                      className={`underline-offset-2 hover:underline ${isFocused ? "text-signal-sky" : ""}`}
                      title={`Show ${row.symbol} on the terminal chart`}
                    >
                      {row.symbol}
                    </button>
                  ) : (
                    row.symbol
                  )}
                </TableCell>
                <TableCell className={row.quantity < 0 ? "text-rose-600" : undefined}>
                  {row.quantity} {row.quantity < 0 ? "(short)" : ""}
                </TableCell>
                <TableCell>{formatRupees(row.avgCost)}</TableCell>
                <TableCell>{displayLtp != null ? formatRupees(displayLtp) : "— (delayed price unavailable)"}</TableCell>
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
            );
          })}
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
