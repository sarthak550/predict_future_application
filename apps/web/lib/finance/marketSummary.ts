/**
 * Homepage "Indian Economy" section (2026-08-09) — server-to-server fetcher
 * for apps/api's `/api/finance/market-summary` (NIFTY 50, SENSEX, BANK
 * NIFTY, USD/INR), same loopback pattern as `fetchAllIndices`/
 * `fetchIndexBySlug` in `lib/finance/indices.ts` — apps/web cannot import
 * apps/api's server code directly, so this hops HTTP, server-to-server.
 *
 * Uses `cache: "no-store"` — NOT the segment-level ISR window this file's
 * prior version relied on. Real production bug found 2026-08-09: apps/web's
 * Docker build statically prerenders this ISR page during `next build`,
 * BEFORE the two containers are networked together (`pf-api` doesn't resolve
 * at build time) — the very first fetch attempt fails, and without
 * `no-store` Next.js treats that failure as a cacheable result and bakes the
 * resulting `null` permanently into the built image. No runtime restart or
 * on-demand revalidation can undo it — it's baked into `.next`'s own output,
 * not an in-memory or disk cache that clears. `no-store` forces a genuine
 * fetch on every request instead, matching this codebase's own established
 * "no-store fetches" convention for server-to-server loopback calls.
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

export type MarketSummaryTile = {
  key: string;
  label: string;
  indexSlug: string | null;
  last: number | null;
  changePercent: number | null;
  changeAbs: number | null;
  spark: { sessionDate: Date; close: number }[];
};

export type MarketSummaryResult = { asOf: string; tiles: MarketSummaryTile[] };

function apiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
}

type RawTile = Omit<MarketSummaryTile, "spark"> & { spark: { sessionDate: string; close: number }[] };

/** Returns `null` only on a total upstream failure (whole route unreachable) — an individual tile's own null fields (partial data loss) are preserved as-is, never upgraded or hidden here. */
export async function fetchMarketSummary(): Promise<MarketSummaryResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiBaseUrl()}/api/finance/market-summary`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { asOf: string; tiles: RawTile[] } | null;
    if (!data || !Array.isArray(data.tiles)) return null;

    return {
      asOf: data.asOf,
      tiles: data.tiles.map((t) => ({
        ...t,
        spark: t.spark.map((p) => ({ sessionDate: new Date(p.sessionDate), close: p.close })),
      })),
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[lib/finance/marketSummary] fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
