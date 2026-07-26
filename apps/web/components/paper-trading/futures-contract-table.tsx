"use client";

/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T10) — futures contract
 * table: an underlying selector (all 5 registry indices) and a compact
 * near/next/far contract ladder (live price, day change, basis vs spot),
 * each row with [B]/[S] chips that pre-fill the docked ticket for one
 * explicit Confirm — same "tap to pre-fill, never instant-fill" convention
 * option-chain-browser.tsx already established (Express mode was cut
 * 2026-07-25, not reintroduced here).
 *
 * Deliberately simpler than option-chain-browser.tsx: no per-cell tick-flash
 * animation (that's the "T10 polish" piece the Phase 4 brief explicitly
 * flags as trimmable first under calendar pressure) — still polls every 30s
 * like every other Paper Trading quote surface, just re-renders plainly.
 *
 * Hits GET /api/paper-trading/futures/quote — a public loopback proxy to
 * apps/api (see that route file) that never throws; a failed/empty response
 * renders an honest "temporarily unavailable" state here, never a crash or
 * an infinite spinner.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { INDEX_OPTION_UNDERLYINGS } from "@predict-future/business-rules/papertrading/optionContract";

import { useVisiblePolling } from "./use-visible-polling";

export interface FuturesContractQuote {
  expiry: string;
  price: number;
  openInterest: number | null;
  changePercent: number | null;
  lotSize: number | null;
}

export interface FuturesQuoteSnapshot {
  underlying: string;
  price: number;
  expiry: string;
  asOf: string;
  source: "LIVE" | "PCP_DERIVED";
  openInterest: number | null;
  changePercent: number | null;
  lotSize: number | null;
  allContracts: FuturesContractQuote[];
}

export interface SelectedFuturesContract {
  underlying: string;
  expiry: string;
  price: number;
  lotSize: number;
  source: "LIVE" | "PCP_DERIVED";
  spot: number | null;
}

const INDEX_DISPLAY_NAMES: Record<string, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Nifty Bank",
  FINNIFTY: "Nifty Financial Services",
  MIDCPNIFTY: "Nifty Midcap Select",
  NIFTYNXT50: "Nifty Next 50"
};

const QUOTE_POLL_MS = 30_000;

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function FuturesContractTable({
  underlying,
  onUnderlyingChange,
  onSelectContract,
  onQuoteData,
  spot,
  getHeldLots
}: {
  underlying: string;
  onUnderlyingChange: (underlying: string) => void;
  onSelectContract: (contract: SelectedFuturesContract, side: "BUY" | "SELL") => void;
  /** Fires on every successful quote load, initial and polled — lets the page keep a selected contract's price live and derive the spot for the underlying chart. */
  onQuoteData?: (quote: FuturesQuoteSnapshot) => void;
  /** Current underlying spot (from the chart's own live feed) — used only for the "basis vs spot" column; null renders that column as "—". */
  spot: number | null;
  /** How many lots of a given contract the account currently holds and in which direction — lets a chip render as "close" rather than "open" (informational only, both chips stay enabled: both BUY and SELL can validly open OR close a futures position, unlike options' long-only guard). */
  getHeldLots?: (underlying: string, expiry: string) => { lots: number; side: "LONG" | "SHORT" } | null;
}) {
  const [quote, setQuote] = useState<FuturesQuoteSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const onQuoteDataRef = useRef(onQuoteData);
  onQuoteDataRef.current = onQuoteData;

  const loadQuote = useCallback(
    async (opts: { silent: boolean }) => {
      if (!opts.silent) {
        setLoading(true);
        setError("");
      }
      try {
        const r = await fetch(`/api/paper-trading/futures/quote?underlying=${underlying}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as FuturesQuoteSnapshot;
        if (typeof data?.price !== "number") throw new Error("malformed quote");
        setQuote(data);
        onQuoteDataRef.current?.(data);
        setError("");
      } catch {
        if (!opts.silent) setError("Couldn't load a futures quote right now — try again shortly.");
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [underlying]
  );

  useEffect(() => {
    setQuote(null);
    void loadQuote({ silent: false });
  }, [loadQuote]);

  useVisiblePolling(() => void loadQuote({ silent: true }), QUOTE_POLL_MS, true);

  const contracts: FuturesContractQuote[] =
    quote?.allContracts && quote.allContracts.length > 0
      ? quote.allContracts
      : quote
        ? [{ expiry: quote.expiry, price: quote.price, openInterest: quote.openInterest, changePercent: quote.changePercent, lotSize: quote.lotSize }]
        : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {INDEX_OPTION_UNDERLYINGS.map((sym) => (
          <button
            key={sym}
            type="button"
            onClick={() => onUnderlyingChange(sym)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
              underlying === sym
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-ink-200 bg-white text-ink-600 hover:border-ink-400"
            }`}
            title={INDEX_DISPLAY_NAMES[sym]}
          >
            {sym}
          </button>
        ))}
      </div>

      {loading && !quote && <p className="text-sm text-ink-400">Loading futures quotes…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {quote && (
        <>
          {quote.source === "PCP_DERIVED" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No live futures feed for {underlying} right now — prices below are <strong>derived from option prices</strong> (put-call
              parity) on the nearest expiry only. Other contract months aren&apos;t priceable until the live feed returns.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-400">
                  <th className="pb-2 font-medium">Contract</th>
                  <th className="pb-2 font-medium">Price</th>
                  <th className="pb-2 font-medium">Day change</th>
                  <th className="pb-2 font-medium">Basis vs spot</th>
                  <th className="pb-2 font-medium">Held</th>
                  <th className="pb-2 text-right font-medium">Trade</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const basis = spot != null ? c.price - spot : null;
                  const held = getHeldLots?.(underlying, c.expiry) ?? null;
                  const selected: SelectedFuturesContract | null =
                    c.lotSize != null
                      ? { underlying, expiry: c.expiry, price: c.price, lotSize: c.lotSize, source: quote.source, spot }
                      : null;
                  return (
                    <tr key={c.expiry} className="border-t border-ink-100">
                      <td className="py-2.5 font-medium text-ink-900">{c.expiry}</td>
                      <td className="py-2.5 text-ink-900">{formatRupees(c.price)}</td>
                      <td className={`py-2.5 ${c.changePercent == null ? "text-ink-400" : c.changePercent >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {c.changePercent != null ? formatSignedPercent(c.changePercent) : "—"}
                      </td>
                      <td className={`py-2.5 ${basis == null ? "text-ink-400" : basis >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {basis != null ? `${basis >= 0 ? "+" : ""}${basis.toFixed(2)} (${basis >= 0 ? "contango" : "backwardation"})` : "—"}
                      </td>
                      <td className="py-2.5 text-ink-500">{held ? `${held.lots} lot(s) ${held.side}` : "—"}</td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            disabled={!selected}
                            onClick={() => selected && onSelectContract(selected, "BUY")}
                            className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            B
                          </button>
                          <button
                            type="button"
                            disabled={!selected}
                            onClick={() => selected && onSelectContract(selected, "SELL")}
                            className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            S
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-400">
            Quoted {new Date(quote.asOf).toLocaleTimeString("en-IN")} · {quote.source === "LIVE" ? "live NSE feed" : "derived from option prices"}
          </p>
        </>
      )}
    </div>
  );
}
