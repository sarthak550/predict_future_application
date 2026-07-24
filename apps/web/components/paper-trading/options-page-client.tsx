"use client";

/**
 * Paper Trading Phase 2 (index options) + Phase 3 (stock options) —
 * /paper-trading/options page composition (T7 + T8). Same session-aware
 * client-side pattern as PaperTradingDashboard (T5/T6/T9, Phase 1) —
 * signed-in personal utility page, never indexed.
 *
 * Composes OptionChainBrowser (the strike ladder) with OptionTradePanel (the
 * trade form) — selecting a CE/PE cell in the chain opens the trade panel
 * pre-filled with that exact contract. `heldLots` for the SELL long-only UX
 * hint comes from the account's own option positions (already computed
 * server-side by lib/paperTrading/queries.ts's getAccountDetail).
 *
 * Phase 3 (T7): reads `?underlying=&optionType=` (from PaperTradeCta's "Trade
 * options on this call" secondary link, or any other future deep-link source)
 * and passes it through to OptionChainBrowser, which opens directly in Stock
 * mode with that underlying pre-selected and that option-type column
 * highlighted. Mirrors the main dashboard page's existing CTA-deep-link
 * pattern (?symbol=&side=&productType=&linkedOpinionId=) rather than
 * inventing a new one. `linkedOpinionId` from the same deep-link is threaded
 * through to the trade panel's order submission (T8).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { OptionChainBrowser, type OptionChainSnapshot, type SelectedContract } from "@/components/paper-trading/option-chain-browser";
import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import { OptionTradePanel, type PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";
import { PaperTradingDisclaimerFooter } from "@/components/paper-trading/paper-trading-disclaimer-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LoadState = "loading" | "signed-out" | "ready";

interface OptionPositionSummary {
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  lots: number;
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function OptionsPageClient() {
  const searchParams = useSearchParams();
  const deepLinkUnderlying = searchParams.get("underlying");
  const deepLinkOptionTypeRaw = searchParams.get("optionType");
  const deepLinkOptionType = deepLinkOptionTypeRaw === "CE" || deepLinkOptionTypeRaw === "PE" ? deepLinkOptionTypeRaw : null;
  const deepLinkOpinionId = searchParams.get("linkedOpinionId");
  // Positions-table "Sell" deep-link: fully specifies a held contract so the
  // trade panel opens pre-selected on the SELL side without hunting the ladder.
  const deepLinkExpiry = searchParams.get("expiry");
  const deepLinkStrikeRaw = searchParams.get("strike");
  const deepLinkStrike = deepLinkStrikeRaw != null && deepLinkStrikeRaw !== "" ? Number(deepLinkStrikeRaw) : null;
  const deepLinkSide = searchParams.get("side") === "SELL" ? ("SELL" as const) : null;

  const [state, setState] = useState<LoadState>("loading");
  const [cash, setCash] = useState(0);
  const [optionPositions, setOptionPositions] = useState<OptionPositionSummary[]>([]);
  const [error, setError] = useState("");
  const [selectedContract, setSelectedContract] = useState<SelectedContract | null>(null);
  const [lastOrder, setLastOrder] = useState<PlacedOptionOrderPayload | null>(null);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-trading/account");
      if (!res.ok) {
        setError("Couldn't load your Paper Trading account.");
        return;
      }
      const data = await res.json();
      setCash(data.account?.cash ?? 0);
      setOptionPositions(data.account?.optionPositions ?? []);
    } catch {
      setError("Couldn't load your Paper Trading account — check your connection.");
    }
  }, []);

  // Positions/cash tick along with the chain instead of freezing until a manual
  // refresh — paused while the tab is hidden.
  useVisiblePolling(() => void loadAccount(), 60_000, state === "ready");

  // One-shot guard: the Sell deep-link auto-opens its contract on the FIRST
  // matching chain snapshot only — after that the user owns the selection.
  const autoSelectedRef = useRef(false);

  // Every chain load (initial + 30s polls) flows through here: if the user has
  // a contract selected, keep its premium (and the spot) live so the trade
  // panel's cost estimate tracks what the fill will actually use. Also fulfils
  // the positions-table Sell deep-link by auto-selecting the specified contract.
  const handleChainData = useCallback(
    (chain: OptionChainSnapshot) => {
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
    [deepLinkUnderlying, deepLinkExpiry, deepLinkStrike, deepLinkOptionType]
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

  const heldLotsForSelected = selectedContract
    ? (optionPositions.find(
        (p) =>
          p.underlyingSymbol === selectedContract.underlying &&
          p.strikePrice === selectedContract.strikePrice &&
          p.optionType === selectedContract.optionType &&
          formatExpiryFromIso(p.expiryDate) === selectedContract.expiry
      )?.lots ?? 0)
    : 0;

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

      <Card>
        <CardHeader>
          <CardTitle>Option chain</CardTitle>
          <CardDescription>
            NIFTY/BANKNIFTY index options or F&amp;O-eligible single-stock options — buy CE or PE only. Tap a
            premium to open the trade panel. Cash available:{" "}
            <span className="font-medium text-ink-900">{formatRupees(cash)}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OptionChainBrowser
            onSelectContract={setSelectedContract}
            onChainData={handleChainData}
            initialUnderlying={deepLinkUnderlying}
            initialOptionType={deepLinkOptionType}
            initialExpiry={deepLinkExpiry}
          />
        </CardContent>
      </Card>

      {selectedContract && (
        <OptionTradePanel
          contract={selectedContract}
          cash={cash}
          heldLots={heldLotsForSelected}
          linkedOpinionId={deepLinkOpinionId}
          initialSide={deepLinkSide ?? undefined}
          onOrderPlaced={(order) => {
            setLastOrder(order);
            setSelectedContract(null);
            loadAccount();
          }}
          onClose={() => setSelectedContract(null)}
        />
      )}

      <PaperTradingDisclaimerFooter />
    </div>
  );
}

/** ISO expiryDate string (from the JSON API response) -> NSE "DD-MMM-YYYY" format, to compare against SelectedContract.expiry (which is already in NSE format from the chain browser). */
function formatExpiryFromIso(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = months[d.getUTCMonth()];
  return `${dd}-${mon}-${d.getUTCFullYear()}`;
}
