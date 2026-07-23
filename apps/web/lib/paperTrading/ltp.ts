/**
 * Paper Trading Phase 1 — server-side delayed LTP fetch for order fills.
 *
 * Same loopback proxy pattern as
 * apps/web/app/api/instruments/[symbol]/intraday/route.ts: apps/api's
 * /api/finance/instruments/[symbol]/intraday is the only thing that can reach
 * NSE/Yahoo's intraday tick feed (see that route + lib/marketMoves/intraday.ts on
 * the apps/api side), so this calls it server-to-server rather than duplicating
 * any fetch logic here. No new apps/api endpoint needed — this reuses the existing
 * one exactly as the brief specifies.
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

export interface DelayedLtp {
  price: number;
  /** The upstream tick's own timestamp — can be up to ~60s stale (the intraday fetcher's in-module cache TTL). Persisted on every PaperOrder as fillTickAt so the UI can honestly label "priced as of HH:MM, delayed data" rather than implying a live match. */
  tickAt: Date;
  sessionLabel: string | null;
}

/**
 * Fetches the latest delayed intraday tick for `symbol`. Returns null on any
 * upstream failure, timeout, or empty series — callers must treat that as "no
 * price available right now" (502), never fall back to a stale/estimated price for
 * an actual fill.
 */
export async function fetchDelayedLtp(symbol: string): Promise<DelayedLtp | null> {
  const apiBase = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const url = `${apiBase}/api/finance/instruments/${encodeURIComponent(symbol)}/intraday`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    const points: unknown = data?.points;
    if (!Array.isArray(points) || points.length === 0) return null;

    const lastPoint = points[points.length - 1];
    if (!Array.isArray(lastPoint) || lastPoint.length < 2) return null;
    const [t, price] = lastPoint as [number, number];
    if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0) return null;

    return { price, tickAt: new Date(t), sessionLabel: typeof data?.sessionLabel === "string" ? data.sessionLabel : null };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(`[paperTrading/ltp] fetch failed for ${symbol}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
