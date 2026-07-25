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
 * Trading Terminal UI Overhaul (Sprint A, T5) — the top section is now a
 * TerminalShell: sticky header (spot + day/total P&L + cash), the focused
 * symbol's PriceChart, and a DockedOrderTicket delegating to the EXISTING,
 * UNMODIFIED NewTradeForm (equity needed no new submit logic — "chart +
 * simple buy/sell ticket, no ladder" per the brief). Everything from
 * "Delivery holdings" down keeps the full tables (with Sell actions) — the
 * chips strip was removed 2026-07-25 as pure duplication of those tables.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { PriceChart } from "@/components/finance/price-chart";
import { PaperTradingSymbolSearchInput, type PaperSymbolOption } from "@/components/paper-trading/symbol-search-input";
import { type PlacedOrderPayload } from "@/components/paper-trading/new-trade-form";
import { InstrumentContextCard } from "@/components/paper-trading/instrument-context-card";
import { OrderConfirmation } from "@/components/paper-trading/order-confirmation";
import { OrderHistoryTable, type OrderHistoryEntry } from "@/components/paper-trading/order-history-table";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import { DockedOrderTicket } from "@/components/paper-trading/terminal/docked-order-ticket";
import { TerminalHeader } from "@/components/paper-trading/terminal/terminal-header";
import { TerminalShell } from "@/components/paper-trading/terminal/terminal-shell";
import { useEodSeries } from "@/components/paper-trading/terminal/use-eod-series";
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

interface AccountDetail {
  account: { id: string; generation: number; startingCapital: number; createdAt: string; status: "ACTIVE" | "ARCHIVED" };
  cash: number;
  deliveryHoldings: PositionRow[];
  openIntradayPositions: PositionRow[];
  optionPositions: OptionPositionRow[];
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
  const [resetting, setResetting] = useState(false);

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

  async function handleReset() {
    if (!account || resetting) return;
    const confirmed = window.confirm(
      "Reset your Paper Trading account? This archives your current account (its order history stays viewable) and starts a fresh one with the same starting capital."
    );
    if (!confirmed) return;
    setResetting(true);
    try {
      const res = await fetch("/api/paper-trading/account/reset", { method: "POST" });
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
              <PriceChart key={focusedSymbol} symbol={focusedSymbol} series={eodSeries} />
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
          <DockedOrderTicket
            key={`${initialSymbol ?? focusedSymbol ?? ""}-${initialSide}-${initialProductType}`}
            kind="equity"
            cash={account.cash}
            heldDeliveryQtyBySymbol={heldDeliveryQtyBySymbol}
            hasSoldDeliveryTodayBySymbol={hasSoldDeliveryTodayBySymbol}
            initialSymbol={initialSymbol ?? focusedSymbol}
            initialSide={initialSide}
            initialProductType={initialProductType}
            linkedOpinionId={linkedOpinionId}
            onOrderPlaced={(order) => {
              setLastOrder(order);
              setFocusedSymbol(order.symbol);
              loadAccount();
            }}
          />
        }
      />

      {lastOrder && <OrderConfirmation order={lastOrder} onDismiss={() => setLastOrder(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Delivery holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <PositionsTable rows={account.deliveryHoldings} emptyLabel="No open delivery holdings." />
        </CardContent>
      </Card>

      {account.openIntradayPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open intraday positions (today)</CardTitle>
            <CardDescription>Auto-squared-off near market close if still open.</CardDescription>
          </CardHeader>
          <CardContent>
            <PositionsTable rows={account.openIntradayPositions} emptyLabel="No open intraday positions." />
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

function PositionsTable({ rows, emptyLabel }: { rows: PositionRow[]; emptyLabel: string }) {
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
