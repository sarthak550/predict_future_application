/**
 * Homepage "Indian Economy" section (2026-08-09) — server-to-server fetcher
 * for apps/api's `/api/finance/market-summary` (NIFTY 50, SENSEX, BANK
 * NIFTY, USD/INR), same loopback pattern as `fetchAllIndices`/
 * `fetchIndexBySlug` in `lib/finance/indices.ts` — apps/web cannot import
 * apps/api's server code directly, so this hops HTTP, server-to-server.
 *
 * Deliberately does NOT set `cache: "no-store"` — the homepage is ISR
 * (`export const revalidate = 900`), and Next.js applies that segment-level
 * window to any `fetch()` inside the render that doesn't opt out, same
 * rationale as `indices.ts`'s own doc comment.
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
