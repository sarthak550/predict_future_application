/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T7) — server-side
 * index-futures quote fetch for order fills and margin/headroom checks.
 *
 * Same direct-to-apps/api loopback pattern as lib/paperTrading/optionQuote.ts's
 * fetchOptionChainSnapshot: calls apps/api's `/api/finance/futures/quote`
 * endpoint server-to-server (NOT through the apps/web
 * `/api/paper-trading/futures/quote` browser-facing proxy — that proxy exists
 * for client-side fetches from the futures terminal UI, this is a separate
 * server-to-server call for order-fill/margin pricing, avoiding an
 * unnecessary extra hop through this app's own HTTP layer).
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

export type FuturesQuoteSource = "LIVE" | "PCP_DERIVED";

export interface FuturesContractQuote {
  /** "DD-MMM-YYYY", NSE's own expiry string format. */
  expiry: string;
  price: number;
  openInterest: number | null;
  changePercent: number | null;
  lotSize: number | null;
}

export interface FuturesQuote {
  underlying: string;
  /** Near-month contract's price. */
  price: number;
  expiry: string;
  asOf: Date;
  source: FuturesQuoteSource;
  openInterest: number | null;
  changePercent: number | null;
  lotSize: number | null;
  /** Every contract month (near/next/far) when source is LIVE — empty for PCP_DERIVED (PCP only estimates the near-month price). */
  allContracts: FuturesContractQuote[];
}

/**
 * Fetches `underlying`'s live-or-PCP-derived futures quote (all contract
 * months when available). Returns null on any upstream failure, timeout, or
 * malformed response — callers (order placement, the margin-headroom check)
 * must treat that as "no fill price available right now" (502), never fall
 * back to a stale/estimated price for an actual fill.
 */
export async function fetchFuturesQuoteServer(underlying: string): Promise<FuturesQuote | null> {
  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const url = `${apiBase}/api/finance/futures/quote?underlying=${encodeURIComponent(underlying)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!data || typeof data.price !== "number" || typeof data.expiry !== "string") return null;

    return {
      underlying: data.underlying,
      price: data.price,
      expiry: data.expiry,
      asOf: typeof data.asOf === "string" ? new Date(data.asOf) : new Date(),
      source: data.source === "LIVE" ? "LIVE" : "PCP_DERIVED",
      openInterest: typeof data.openInterest === "number" ? data.openInterest : null,
      changePercent: typeof data.changePercent === "number" ? data.changePercent : null,
      lotSize: typeof data.lotSize === "number" ? data.lotSize : null,
      allContracts: Array.isArray(data.allContracts) ? data.allContracts : []
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[paperTrading/futuresQuote] fetch failed for ${underlying}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Finds a specific contract month's quote (price + lot size) within a FuturesQuote — checks allContracts first, falling back to the top-level near-month fields when the requested expiry matches the quote's own near-month expiry (covers the PCP_DERIVED case, whose allContracts is always empty). Null if the requested expiry isn't resolvable from this quote at all. */
export function findFuturesContractQuote(quote: FuturesQuote, expiry: string): FuturesContractQuote | null {
  const fromAllContracts = quote.allContracts.find((c) => c.expiry === expiry);
  if (fromAllContracts) return fromAllContracts;
  if (quote.expiry === expiry) {
    return { expiry: quote.expiry, price: quote.price, openInterest: quote.openInterest, changePercent: quote.changePercent, lotSize: quote.lotSize };
  }
  return null;
}
