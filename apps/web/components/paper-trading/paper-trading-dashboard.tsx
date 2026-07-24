"use client";

/**
 * Paper Trading Phase 1 — main dashboard (T5/T6/T9). Session-aware client-side
 * (same fetch("/api/auth/session") pattern as ManageDashboard/SessionChip) since
 * this whole surface is a signed-in personal utility page, never indexed.
 *
 * Reads ?symbol=&side=&productType=&linkedOpinionId= from the URL to pre-fill the
 * New Trade form — this is how "Paper trade this call" (T7) hands off into this
 * page without any prop-drilling across the navigation boundary.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { NewTradeForm, type PlacedOrderPayload } from "@/components/paper-trading/new-trade-form";
import { OrderConfirmation } from "@/components/paper-trading/order-confirmation";
import { OrderHistoryTable, type OrderHistoryEntry } from "@/components/paper-trading/order-history-table";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

type LoadState = "loading" | "signed-out" | "ready";

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

/** Phase 2 — mirrors lib/paperTrading/queries.ts's OptionPositionRow, JSON-serialized (Date -> ISO string). */
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

  const initialSymbol = searchParams.get("symbol");
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

      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Stat label="Cash" value={formatRupees(account.cash)} dark />
          <Stat label="Total value" value={formatRupees(account.totalValue)} dark />
          <Stat
            label="Lifetime net P&L"
            value={formatSignedRupees(account.lifetimeNetPnl)}
            tone={pnlTone(account.lifetimeNetPnl)}
            dark
          />
          <Stat
            label="Lifetime costs paid"
            value={formatRupees(account.lifetimeCostsPaid)}
            dark
            hint="This is what real trading would have cost you."
          />
        </CardContent>
      </Card>

      {lastOrder && <OrderConfirmation order={lastOrder} onDismiss={() => setLastOrder(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>New trade</CardTitle>
          <CardDescription>
            Fills immediately at the latest delayed price. DELIVERY sells require an existing holding — no
            delivery short-selling. INTRADAY positions must be squared off the same day (auto-closed near session
            close if you don&apos;t close them yourself).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewTradeForm
            cash={account.cash}
            heldDeliveryQtyBySymbol={heldDeliveryQtyBySymbol}
            hasSoldDeliveryTodayBySymbol={hasSoldDeliveryTodayBySymbol}
            initialSymbol={initialSymbol}
            initialSide={initialSide}
            initialProductType={initialProductType}
            linkedOpinionId={linkedOpinionId}
            onOrderPlaced={(order) => {
              setLastOrder(order);
              loadAccount();
            }}
          />
        </CardContent>
      </Card>

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
              Held to expiry unless you close manually — settles automatically at intrinsic value on expiry day.{" "}
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

/** Phase 2 — renders open option positions distinctly from equity holdings: contract label, lots, avg/live premium, unrealized P&L, and a days-to-expiry chip (per the brief's positions-view spec). */
function OptionPositionsTable({ rows }: { rows: OptionPositionRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Contract</TableHeaderCell>
            <TableHeaderCell>Lots</TableHeaderCell>
            <TableHeaderCell>Avg premium</TableHeaderCell>
            <TableHeaderCell>Live premium</TableHeaderCell>
            <TableHeaderCell>Unrealized</TableHeaderCell>
            <TableHeaderCell>Net P&L</TableHeaderCell>
            <TableHeaderCell>Expiry</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const key = `${row.underlyingSymbol}-${row.strikePrice}-${row.optionType}-${row.expiryDate}`;
            const expiringSoon = row.daysToExpiry <= 2;
            return (
              <TableRow key={key}>
                <TableCell className="font-medium text-ink-900">
                  {row.underlyingSymbol} {row.strikePrice.toLocaleString("en-IN")} {row.optionType}
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  dark,
  hint
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  dark?: boolean;
  hint?: string;
}) {
  return (
    <div className={dark ? "rounded-[24px] bg-white/10 p-4" : undefined}>
      <p className={dark ? "text-sm text-white/60" : "text-xs text-ink-400"}>{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold ${
          tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : dark ? "text-white" : "text-ink-900"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-white/50">{hint}</p>}
    </div>
  );
}
