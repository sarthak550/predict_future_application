/**
 * Paper Trading Phase 3 — server-to-server F&O stock universe membership
 * check, used by order placement (T5) and the option-order route's
 * underlyingSymbol validation.
 *
 * Same direct-to-apps/api loopback pattern as lib/paperTrading/optionQuote.ts's
 * fetchOptionChainSnapshot: apps/web cannot import apps/api's server code
 * directly, so this calls apps/api's `/api/finance/options/fo-universe`
 * endpoint server-to-server — NOT through the apps/web
 * `/api/paper-trading/options/universe` browser-facing proxy (that one exists
 * for client-side fetches from the chain browser/CTA), same "avoid an
 * unnecessary extra hop" reasoning as optionQuote.ts's identical note.
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

/** The only two underlyings Phase 2's index-options chain supports. Every other tradable underlying is a Phase 3 stock, validated against the live F&O universe below. */
import { INDEX_OPTION_UNDERLYINGS } from "@predict-future/business-rules/papertrading/optionContract";
const INDEX_UNDERLYINGS = new Set<string>(INDEX_OPTION_UNDERLYINGS);

export function isIndexUnderlyingServer(symbol: string): boolean {
  return INDEX_UNDERLYINGS.has(symbol);
}

/**
 * True for NIFTY/BANKNIFTY (no network call needed) or a live member of the
 * F&O stock universe (fetched server-to-server). Order placement is rare
 * enough that this doesn't need its own cache layer beyond apps/api's own 6h
 * TTL on the underlying fo_mktlots.csv table. Never throws — returns false on
 * any upstream failure, so an order against an unresolvable universe is
 * correctly REJECTED rather than optimistically accepted (the safe failure
 * direction for a validation gate).
 */
export async function isTradableOptionUnderlyingServer(symbol: string): Promise<boolean> {
  if (isIndexUnderlyingServer(symbol)) return true;

  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiBase}/api/finance/options/fo-universe`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    const universe: Array<{ symbol: string }> = Array.isArray(data?.universe) ? data.universe : [];
    return universe.some((entry) => entry.symbol === symbol);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[paperTrading/fnoUniverseServer] universe fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
