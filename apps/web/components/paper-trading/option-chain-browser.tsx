"use client";

/**
 * Paper Trading Phase 2 (index options) + Phase 3 (stock options) —
 * option-chain browser (T7): an Index/Stock mode toggle, an underlying
 * selector (NIFTY/BANKNIFTY buttons in Index mode, a searchable F&O-stock
 * combobox in Stock mode), an expiry picker (populated from the live expiry
 * list — never assumes weekly vs. monthly cadence), and a strike ladder (CE
 * premium | strike | PE premium) with the ATM strike visually highlighted
 * against the live underlyingValue. Each strike's CE/PE cell is a premium
 * value + a compact [B]/[S] chip pair (Trading Terminal UI Overhaul, Sprint A
 * T6 — replaces the original single clickable premium cell); tapping a chip
 * calls onSelectContract(contract, side), which options-page-client.tsx uses
 * to pre-fill the terminal's DOCKED order ticket (or, if Express mode is
 * armed, to fire an instant fill — see that file for the Express wiring).
 *
 * Index mode is pixel-identical to pre-Phase-3 behavior — the NIFTY/BANKNIFTY
 * toggle, strike ladder, ATM highlighting, 30s live-polling UX, and
 * market-closed banner were already underlying-agnostic (keyed off
 * `underlyingValue`/`asOf` from the generic chain snapshot type), so Stock
 * mode integrates WITH the existing polling rather than duplicating it.
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
import { fetchFnoUniverseClient, type FnoUniverseEntry } from "@/lib/paperTrading/fnoUniverseClient";

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
  /** Phase 3: widened from "NIFTY" | "BANKNIFTY" to any validated string (index or F&O stock symbol). */
  underlying: string;
  expiry: string;
  underlyingValue: number;
  asOf: string | null;
  lotSize: number | null;
  strikes: OptionStrikeRow[];
}

export interface SelectedContract {
  underlying: string;
  expiry: string;
  strikePrice: number;
  optionType: "CE" | "PE";
  premium: number;
  lotSize: number;
  underlyingValue: number;
}

type ChainMode = "index" | "stock";

const INDEX_UNDERLYINGS: Array<"NIFTY" | "BANKNIFTY"> = ["NIFTY", "BANKNIFTY"];
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

function isIndexUnderlying(symbol: string): symbol is "NIFTY" | "BANKNIFTY" {
  return symbol === "NIFTY" || symbol === "BANKNIFTY";
}

export function OptionChainBrowser({
  onSelectContract,
  onChainData,
  initialUnderlying,
  initialOptionType,
  initialExpiry,
  getHeldLots
}: {
  /**
   * Trading Terminal UI Overhaul (Sprint A, T6) — WIDENED to also report which
   * chip (B or S) was tapped, so the docked ticket can pre-fill the correct
   * side. Every existing caller updated in lockstep (options-page-client.tsx
   * is the only one).
   */
  onSelectContract: (contract: SelectedContract, side: "BUY" | "SELL") => void;
  /** Fires on EVERY successful chain load, initial and polled — lets the page keep a selected contract's premium live. */
  onChainData?: (chain: OptionChainSnapshot) => void;
  /** Phase 3 deep-link pre-fill (from ?underlying=): a non-index symbol opens the browser directly in Stock mode with this underlying selected. NIFTY/BANKNIFTY (or omitted) keeps Index mode, unchanged from pre-Phase-3 behavior. */
  initialUnderlying?: string | null;
  /** Phase 3 deep-link pre-fill (from ?optionType=): highlights this column once a chain loads. */
  initialOptionType?: "CE" | "PE" | null;
  /** Sell deep-link pre-fill (from ?expiry=): selects this expiry (when the live list contains it) instead of the nearest one. */
  initialExpiry?: string | null;
  /**
   * Trading Terminal UI Overhaul (Sprint A, T6) — how many lots of a given
   * contract the account currently holds, so the [S] chip can be rendered
   * disabled (long-only guard, now a disabled STATE instead of an absent
   * button) rather than simply omitted. Omitted prop: every [S] chip renders
   * disabled (same as "holds nothing"), never an absent-button crash.
   */
  getHeldLots?: (underlying: string, strikePrice: number, optionType: "CE" | "PE", expiry: string) => number;
}) {
  const deepLinkIsStock = Boolean(initialUnderlying) && !isIndexUnderlying(initialUnderlying as string);
  const [mode, setMode] = useState<ChainMode>(deepLinkIsStock ? "stock" : "index");
  // Empty string means "no underlying selected yet" — only reachable in Stock
  // mode before the user picks a stock from the combobox; every fetch effect
  // below no-ops on an empty underlying rather than accidentally requesting a
  // stale/wrong symbol's chain.
  const [underlying, setUnderlying] = useState<string>(
    initialUnderlying && (deepLinkIsStock || isIndexUnderlying(initialUnderlying)) ? initialUnderlying : "NIFTY"
  );
  const [stockQuery, setStockQuery] = useState(deepLinkIsStock ? (initialUnderlying as string) : "");
  const [stockComboboxOpen, setStockComboboxOpen] = useState(false);
  const [fnoUniverse, setFnoUniverse] = useState<FnoUniverseEntry[]>([]);
  const highlightOptionType = initialOptionType ?? null;
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

  // Stock mode's F&O universe: fetched once (cached client-side, see
  // fnoUniverseClient.ts), needed for the searchable combobox.
  useEffect(() => {
    let cancelled = false;
    if (mode === "stock" && fnoUniverse.length === 0) {
      fetchFnoUniverseClient().then((list) => {
        if (!cancelled) setFnoUniverse(list);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [mode, fnoUniverse.length]);

  // Deep-link pre-fills, frozen at mount (refs, not deps — they must not
  // re-trigger the expiries effect on later renders).
  const initialExpiryRef = useRef(initialExpiry ?? null);
  const initialUnderlyingRef = useRef(initialUnderlying ?? null);

  // Refs so the polled loader never has to be re-created on data/parent renders
  // (a fresh callback identity would re-arm effects — the price-chart lesson).
  const chainRef = useRef<OptionChainSnapshot | null>(null);
  const onChainDataRef = useRef(onChainData);
  onChainDataRef.current = onChainData;
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!underlying) {
      // Stock mode, nothing picked yet — nothing to fetch.
      setExpiries([]);
      setExpiry("");
      setLoadingExpiries(false);
      setExpiriesError("");
      return;
    }
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
        // Sell deep-link may target a later expiry than the nearest — honor it
        // when the live list actually contains it (only on first load for the
        // deep-linked underlying; switching underlyings falls back to nearest).
        const preferred =
          initialExpiryRef.current && underlying === initialUnderlyingRef.current && list.includes(initialExpiryRef.current)
            ? initialExpiryRef.current
            : list[0];
        setExpiry(preferred ?? "");
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
      if (!expiry || !underlying) return;
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

  function handleChipTap(strikePrice: number, optionType: "CE" | "PE", quote: OptionQuote | null, side: "BUY" | "SELL") {
    if (!chain || !chain.lotSize || quote?.lastPrice == null || quote.lastPrice <= 0) return;
    onSelectContract(
      {
        underlying,
        expiry,
        strikePrice,
        optionType,
        premium: quote.lastPrice,
        lotSize: chain.lotSize,
        underlyingValue: chain.underlyingValue
      },
      side
    );
  }

  const stockMatches = useMemo(() => {
    if (mode !== "stock") return [];
    const q = stockQuery.trim().toUpperCase();
    if (q.length === 0) return fnoUniverse.slice(0, 30);
    return fnoUniverse.filter((e) => e.symbol.includes(q) || e.companyName.toUpperCase().includes(q)).slice(0, 30);
  }, [mode, stockQuery, fnoUniverse]);

  function selectStock(entry: FnoUniverseEntry) {
    setUnderlying(entry.symbol);
    setStockQuery(entry.symbol);
    setStockComboboxOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
          {(["index", "stock"] as ChainMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                if (m === "index") {
                  setUnderlying("NIFTY");
                } else if (!isIndexUnderlying(underlying)) {
                  // Already had a stock selected (e.g. toggled back and forth) — keep it.
                } else {
                  // Coming from Index mode with no stock chosen yet — don't
                  // fetch a stale NIFTY/BANKNIFTY chain under the Stock label.
                  setUnderlying("");
                  setStockQuery("");
                }
              }}
              className={`rounded-xl px-4 py-2 text-sm font-medium capitalize transition ${
                mode === m ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "index" ? (
          <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
            {INDEX_UNDERLYINGS.map((u) => (
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
        ) : (
          <div className="relative w-full max-w-xs">
            <input
              value={stockQuery}
              onChange={(e) => {
                setStockQuery(e.target.value);
                setStockComboboxOpen(true);
              }}
              onFocus={() => setStockComboboxOpen(true)}
              placeholder="Search F&O stock…"
              autoComplete="off"
              className="h-10 w-full rounded-2xl border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-ink-400"
            />
            {stockComboboxOpen && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-ink-200 bg-white shadow-lg">
                {fnoUniverse.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-ink-400">Loading F&O universe…</p>
                ) : stockMatches.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-ink-400">No matches.</p>
                ) : (
                  stockMatches.map((entry) => (
                    <button
                      key={entry.symbol}
                      type="button"
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-50 ${
                        entry.symbol === underlying ? "bg-signal-sky/10" : ""
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectStock(entry)}
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-ink-900">{entry.symbol}</span>{" "}
                        <span className="text-ink-400">{entry.companyName}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

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

      {mode === "stock" && !underlying && (
        <p className="text-sm text-ink-400">Search and select an F&amp;O stock above to see its option chain.</p>
      )}
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
                <th
                  className={`px-3 py-2 text-right font-medium ${highlightOptionType === "CE" ? "bg-signal-sky/15 text-signal-sky" : ""}`}
                >
                  CE premium
                </th>
                <th className="px-3 py-2 text-center font-medium">Strike</th>
                <th
                  className={`px-3 py-2 text-left font-medium ${highlightOptionType === "PE" ? "bg-signal-sky/15 text-signal-sky" : ""}`}
                >
                  PE premium
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleStrikes.map((row) => {
                const isAtm = row.strikePrice === atmStrikePrice;
                const ceHeldLots = getHeldLots?.(underlying, row.strikePrice, "CE", expiry) ?? 0;
                const peHeldLots = getHeldLots?.(underlying, row.strikePrice, "PE", expiry) ?? 0;
                return (
                  <tr key={row.strikePrice} className={isAtm ? "bg-signal-sky/10" : undefined}>
                    <td className="px-1 py-1 text-right">
                      <StrikeCell
                        quote={row.CE}
                        heldLots={ceHeldLots}
                        onBuy={() => handleChipTap(row.strikePrice, "CE", row.CE, "BUY")}
                        onSell={() => handleChipTap(row.strikePrice, "CE", row.CE, "SELL")}
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
                        heldLots={peHeldLots}
                        onBuy={() => handleChipTap(row.strikePrice, "PE", row.PE, "BUY")}
                        onSell={() => handleChipTap(row.strikePrice, "PE", row.PE, "SELL")}
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

/**
 * Trading Terminal UI Overhaul (Sprint A, T6) — premium value + a compact
 * [B]/[S] chip pair, replacing the old single clickable premium cell.
 * [S] renders disabled/grayed unless the account holds this exact contract
 * (unchanged long-only guard, now a disabled STATE instead of an absent
 * button) — the server-side rejection in optionOrders.ts is still the source
 * of truth, this is UX guidance only.
 */
function StrikeCell({
  quote,
  heldLots,
  onBuy,
  onSell,
  align,
  flash
}: {
  quote: OptionQuote | null;
  heldLots: number;
  onBuy: () => void;
  onSell: () => void;
  align: "left" | "right";
  flash?: FlashDirection;
}) {
  const hasQuote = quote != null && quote.lastPrice != null && quote.lastPrice > 0;
  const flashClass = flash === "up" ? "text-emerald-700" : flash === "down" ? "text-rose-700" : "text-ink-900";
  const alignClass = align === "right" ? "items-end" : "items-start";

  return (
    <div className={`flex flex-col gap-1 px-1 py-1 ${alignClass}`}>
      <span className={`text-xs font-medium transition-colors duration-700 ${hasQuote ? flashClass : "text-ink-300"}`}>
        {hasQuote ? `₹${quote!.lastPrice!.toLocaleString("en-IN")}` : "—"}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={!hasQuote}
          onClick={onBuy}
          className="rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Buy"
        >
          B
        </button>
        <button
          type="button"
          disabled={!hasQuote || heldLots === 0}
          onClick={onSell}
          className="rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
          title={heldLots > 0 ? `Sell (holding ${heldLots} lot(s))` : "Sell — you don't hold this contract"}
        >
          S
        </button>
      </div>
    </div>
  );
}
