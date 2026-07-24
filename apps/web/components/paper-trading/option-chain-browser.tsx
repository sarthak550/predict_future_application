"use client";

/**
 * Paper Trading Phase 2 — option-chain browser (T7): underlying selector,
 * expiry picker (populated from the live expiry list — never assumes weekly
 * vs. monthly cadence), and a strike ladder (CE premium | strike | PE premium)
 * with the ATM strike visually highlighted against the live underlyingValue.
 * Tapping a CE/PE cell calls onSelectContract, which the page composes with
 * OptionTradePanel (T8) to open the trade panel pre-filled with that exact
 * contract.
 *
 * Hits GET /api/paper-trading/options/expiries and
 * GET /api/paper-trading/options/chain — both public loopback proxies to
 * apps/api (see those route files) that never throw; a failed/empty response
 * renders an honest "temporarily unavailable" state here, never a crash or an
 * infinite spinner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Select } from "@/components/ui/select";

import { useVisiblePolling } from "./use-visible-polling";

export interface OptionQuote {
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
}

interface OptionStrikeRow {
  strikePrice: number;
  CE: OptionQuote | null;
  PE: OptionQuote | null;
}

export interface OptionChainSnapshot {
  underlying: "NIFTY" | "BANKNIFTY";
  expiry: string;
  underlyingValue: number;
  asOf: string | null;
  lotSize: number | null;
  strikes: OptionStrikeRow[];
}

export interface SelectedContract {
  underlying: "NIFTY" | "BANKNIFTY";
  expiry: string;
  strikePrice: number;
  optionType: "CE" | "PE";
  premium: number;
  lotSize: number;
  underlyingValue: number;
}

const UNDERLYINGS: Array<"NIFTY" | "BANKNIFTY"> = ["NIFTY", "BANKNIFTY"];
const STRIKES_AROUND_ATM = 10; // shown each side of the ATM strike — a full chain can run 100+ strikes deep, most of them illiquid tails no retail user is trading

// Auto-refresh cadence. The upstream chain is cached ~60s server-side, so 30s
// polling picks a fresh snapshot up within ~30s of it landing — premiums tick
// on their own like a real terminal, just on a delayed feed.
const CHAIN_POLL_MS = 30_000;
const FLASH_CLEAR_MS = 1500;

type FlashDirection = "up" | "down";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function OptionChainBrowser({
  onSelectContract,
  onChainData
}: {
  onSelectContract: (contract: SelectedContract) => void;
  /** Fires on EVERY successful chain load, initial and polled — lets the page keep a selected contract's premium live. */
  onChainData?: (chain: OptionChainSnapshot) => void;
}) {
  const [underlying, setUnderlying] = useState<"NIFTY" | "BANKNIFTY">("NIFTY");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("");
  const [chain, setChain] = useState<OptionChainSnapshot | null>(null);
  const [loadingExpiries, setLoadingExpiries] = useState(true);
  const [loadingChain, setLoadingChain] = useState(false);
  const [expiriesError, setExpiriesError] = useState("");
  const [chainError, setChainError] = useState("");
  const [showFullLadder, setShowFullLadder] = useState(false);
  /** "<strike>-CE" / "<strike>-PE" → tick direction, cleared FLASH_CLEAR_MS after each polled change. */
  const [flashes, setFlashes] = useState<ReadonlyMap<string, FlashDirection>>(new Map());
  const [spotFlash, setSpotFlash] = useState<FlashDirection | null>(null);

  // Refs so the polled loader never has to be re-created on data/parent renders
  // (a fresh callback identity would re-arm effects — the price-chart lesson).
  const chainRef = useRef<OptionChainSnapshot | null>(null);
  const onChainDataRef = useRef(onChainData);
  onChainDataRef.current = onChainData;
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingExpiries(true);
    setExpiriesError("");
    setShowFullLadder(false);
    fetch(`/api/paper-trading/options/expiries?underlying=${underlying}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const list: string[] = Array.isArray(data?.expiries) ? data.expiries : [];
        setExpiries(list);
        setExpiry(list[0] ?? "");
        if (list.length === 0) setExpiriesError("No expiries available right now — try again shortly.");
      })
      .catch(() => {
        if (cancelled) return;
        setExpiries([]);
        setExpiry("");
        setExpiriesError("Couldn't load expiries — try again shortly.");
      })
      .finally(() => {
        if (!cancelled) setLoadingExpiries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [underlying]);

  const loadChain = useCallback(
    async (opts: { silent: boolean }) => {
      if (!expiry) return;
      if (!opts.silent) {
        setLoadingChain(true);
        setChainError("");
      }
      try {
        const r = await fetch(`/api/paper-trading/options/chain?underlying=${underlying}&expiry=${encodeURIComponent(expiry)}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as OptionChainSnapshot;
        if (!data?.strikes || !Array.isArray(data.strikes) || data.strikes.length === 0) {
          throw new Error("empty chain");
        }

        // Polled update on the SAME contract set: diff premiums so changed
        // cells flash their tick direction, terminal-style.
        const prev = chainRef.current;
        if (opts.silent && prev && prev.underlying === data.underlying && prev.expiry === data.expiry) {
          const prevByStrike = new Map(prev.strikes.map((s) => [s.strikePrice, s]));
          const nextFlashes = new Map<string, FlashDirection>();
          for (const row of data.strikes) {
            const prevRow = prevByStrike.get(row.strikePrice);
            if (!prevRow) continue;
            for (const type of ["CE", "PE"] as const) {
              const before = prevRow[type]?.lastPrice;
              const after = row[type]?.lastPrice;
              if (before != null && after != null && after !== before) {
                nextFlashes.set(`${row.strikePrice}-${type}`, after > before ? "up" : "down");
              }
            }
          }
          setFlashes(nextFlashes);
          setSpotFlash(
            data.underlyingValue !== prev.underlyingValue ? (data.underlyingValue > prev.underlyingValue ? "up" : "down") : null
          );
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => {
            setFlashes(new Map());
            setSpotFlash(null);
          }, FLASH_CLEAR_MS);
        }

        chainRef.current = data;
        setChain(data);
        onChainDataRef.current?.(data);
      } catch {
        // A failed SILENT poll keeps showing the last good snapshot — a blip in
        // the upstream feed must not blank a working ladder.
        if (!opts.silent) {
          chainRef.current = null;
          setChain(null);
          setChainError("Chain temporarily unavailable — try again shortly.");
        }
      } finally {
        if (!opts.silent) setLoadingChain(false);
      }
    },
    [underlying, expiry]
  );

  useEffect(() => {
    chainRef.current = null;
    setChain(null);
    setFlashes(new Map());
    setSpotFlash(null);
    if (expiry) void loadChain({ silent: false });
  }, [expiry, loadChain]);

  useVisiblePolling(() => void loadChain({ silent: true }), CHAIN_POLL_MS, Boolean(expiry) && chain != null);

  // The flash-clear timer must not leak across unmount.
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    []
  );

  const atmStrikePrice = useMemo(() => {
    if (!chain || chain.strikes.length === 0) return null;
    return chain.strikes.reduce((best, s) =>
      Math.abs(s.strikePrice - chain.underlyingValue) < Math.abs(best.strikePrice - chain.underlyingValue) ? s : best
    ).strikePrice;
  }, [chain]);

  const visibleStrikes = useMemo(() => {
    if (!chain) return [];
    if (showFullLadder || atmStrikePrice === null) return chain.strikes;
    const atmIndex = chain.strikes.findIndex((s) => s.strikePrice === atmStrikePrice);
    if (atmIndex < 0) return chain.strikes;
    const start = Math.max(0, atmIndex - STRIKES_AROUND_ATM);
    const end = Math.min(chain.strikes.length, atmIndex + STRIKES_AROUND_ATM + 1);
    return chain.strikes.slice(start, end);
  }, [chain, atmStrikePrice, showFullLadder]);

  const asOfLabel = useMemo(() => {
    if (!chain?.asOf) return null;
    const asOfDate = new Date(chain.asOf);
    return asOfDate.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }, [chain]);

  function handleCellClick(strikePrice: number, optionType: "CE" | "PE", quote: OptionQuote | null) {
    if (!chain || !chain.lotSize || quote?.lastPrice == null || quote.lastPrice <= 0) return;
    onSelectContract({
      underlying,
      expiry,
      strikePrice,
      optionType,
      premium: quote.lastPrice,
      lotSize: chain.lotSize,
      underlyingValue: chain.underlyingValue
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
          {UNDERLYINGS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnderlying(u)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                underlying === u ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              {u}
            </button>
          ))}
        </div>

        <Select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          disabled={loadingExpiries || expiries.length === 0}
          className="w-auto min-w-[160px]"
        >
          {expiries.length === 0 && <option value="">{loadingExpiries ? "Loading expiries…" : "No expiries"}</option>}
          {expiries.map((exp) => (
            <option key={exp} value={exp}>
              {exp}
            </option>
          ))}
        </Select>

        {chain && (
          <span className="text-sm text-ink-500">
            Spot:{" "}
            <span
              className={`rounded-md px-1 font-medium transition-colors duration-700 ${
                spotFlash === "up" ? "bg-emerald-100 text-emerald-700" : spotFlash === "down" ? "bg-rose-100 text-rose-700" : "text-ink-900"
              }`}
            >
              {formatRupees(chain.underlyingValue)}
            </span>
          </span>
        )}
      </div>

      {expiriesError && <p className="text-sm text-rose-600">{expiriesError}</p>}
      {chainError && <p className="text-sm text-rose-600">{chainError}</p>}
      {loadingChain && !chain && <p className="text-sm text-ink-400">Loading chain…</p>}

      {asOfLabel && (
        <p className="flex items-center gap-1.5 text-xs text-ink-400">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-sky opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-signal-sky" />
          </span>
          Auto-updating · premiums as of {asOfLabel} IST — delayed a few minutes, refreshes every ~30s. If the
          market is closed right now, this is the last session&apos;s data.
        </p>
      )}

      {chain && visibleStrikes.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-ink-100">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-ink-50 text-ink-500">
              <tr>
                <th className="px-3 py-2 text-right font-medium">CE premium</th>
                <th className="px-3 py-2 text-center font-medium">Strike</th>
                <th className="px-3 py-2 text-left font-medium">PE premium</th>
              </tr>
            </thead>
            <tbody>
              {visibleStrikes.map((row) => {
                const isAtm = row.strikePrice === atmStrikePrice;
                return (
                  <tr key={row.strikePrice} className={isAtm ? "bg-signal-sky/10" : undefined}>
                    <td className="px-1 py-1 text-right">
                      <StrikeCell
                        quote={row.CE}
                        onClick={() => handleCellClick(row.strikePrice, "CE", row.CE)}
                        align="right"
                        flash={flashes.get(`${row.strikePrice}-CE`)}
                      />
                    </td>
                    <td className={`px-3 py-2 text-center font-medium ${isAtm ? "text-signal-sky" : "text-ink-700"}`}>
                      {row.strikePrice.toLocaleString("en-IN")}
                      {isAtm && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-sky">ATM</span>}
                    </td>
                    <td className="px-1 py-1 text-left">
                      <StrikeCell
                        quote={row.PE}
                        onClick={() => handleCellClick(row.strikePrice, "PE", row.PE)}
                        align="left"
                        flash={flashes.get(`${row.strikePrice}-PE`)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!showFullLadder && chain.strikes.length > visibleStrikes.length && (
            <button
              type="button"
              onClick={() => setShowFullLadder(true)}
              className="w-full border-t border-ink-100 py-2 text-xs font-medium text-ink-500 hover:text-ink-900"
            >
              Show full chain ({chain.strikes.length} strikes)
            </button>
          )}
        </div>
      )}

      {chain && !chain.lotSize && (
        <p className="text-xs text-amber-700">
          Lot size unavailable for this contract right now — trading is temporarily disabled for this expiry.
        </p>
      )}
    </div>
  );
}

function StrikeCell({
  quote,
  onClick,
  align,
  flash
}: {
  quote: OptionQuote | null;
  onClick: () => void;
  align: "left" | "right";
  flash?: FlashDirection;
}) {
  if (!quote || quote.lastPrice == null || quote.lastPrice <= 0) {
    return <span className={`block px-2 py-2 text-ink-300 ${align === "right" ? "text-right" : "text-left"}`}>—</span>;
  }
  const flashClass =
    flash === "up" ? "bg-emerald-100 text-emerald-800" : flash === "down" ? "bg-rose-100 text-rose-800" : "text-ink-900";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-xl px-2 py-2 font-medium transition-colors duration-700 hover:bg-signal-sky/20 ${flashClass} ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      ₹{quote.lastPrice.toLocaleString("en-IN")}
    </button>
  );
}
