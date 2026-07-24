/**
 * Paper Trading Phase 2 — server-side option-chain fetch for order fills.
 *
 * Same direct-to-apps/api loopback pattern as lib/paperTrading/ltp.ts's
 * fetchDelayedLtp: this calls apps/api's `/api/finance/options/chain` endpoint
 * server-to-server (NOT through the apps/web `/api/paper-trading/options/chain`
 * browser-facing proxy — that proxy exists for client-side fetches from the
 * chain browser UI, this is a separate server-to-server call for order-fill
 * pricing, avoiding an unnecessary extra hop through this app's own HTTP layer).
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

export interface OptionQuote {
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
}

export interface OptionStrikeRow {
  strikePrice: number;
  CE: OptionQuote | null;
  PE: OptionQuote | null;
}

export interface OptionChainSnapshot {
  /** Phase 3: widened from "NIFTY" | "BANKNIFTY" to any validated string (index or F&O stock symbol). */
  underlying: string;
  expiry: string;
  underlyingValue: number;
  asOf: Date | null;
  lotSize: number | null;
  strikes: OptionStrikeRow[];
}

/**
 * Fetches the full option-chain snapshot for `underlying`/`expiry` (index OR
 * stock, Phase 2/3). Returns null on any upstream failure, timeout, or
 * malformed response — callers (order placement, the client pre-trade
 * estimate's server round-trip) must treat that as "no fill price available
 * right now" (502), never fall back to a stale/estimated premium for an
 * actual fill.
 */
export async function fetchOptionChainSnapshot(underlying: string, expiry: string): Promise<OptionChainSnapshot | null> {
  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const url = `${apiBase}/api/finance/options/chain?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.strikes) || typeof data.underlyingValue !== "number") return null;

    return {
      underlying: data.underlying,
      expiry: data.expiry,
      underlyingValue: data.underlyingValue,
      asOf: typeof data.asOf === "string" ? new Date(data.asOf) : null,
      lotSize: typeof data.lotSize === "number" ? data.lotSize : null,
      strikes: data.strikes
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[paperTrading/optionQuote] fetch failed for ${underlying}/${expiry}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Finds one strike row's CE or PE quote in a snapshot. Null if the strike or leg doesn't exist in the response. */
export function findOptionQuote(
  snapshot: OptionChainSnapshot,
  strikePrice: number,
  optionType: "CE" | "PE"
): OptionQuote | null {
  const row = snapshot.strikes.find((s) => s.strikePrice === strikePrice);
  if (!row) return null;
  return optionType === "CE" ? row.CE : row.PE;
}
