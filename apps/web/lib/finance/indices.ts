/**
 * All-Indices informational layer — server-to-server fetchers, same
 * direct-to-apps/api loopback pattern as lib/paperTrading/ltp.ts and
 * fnoUniverseServer.ts: apps/web cannot import apps/api's server code
 * directly, so this calls apps/api's /api/finance/indices[/​[slug]] routes
 * server-to-server — NOT through the app/api/indices/** browser-facing
 * proxy routes (those exist for client-side fetches; going through them
 * here would add an unnecessary extra hop for a server component).
 *
 * Deliberately does NOT set `cache: "no-store"` on these fetches — the
 * /indices and /indices/[slug] pages are ISR (`export const revalidate`),
 * and Next.js automatically applies that segment-level revalidate window to
 * any `fetch()` call inside the render that doesn't specify its own cache
 * option. Setting no-store here would silently opt the whole route out of
 * static generation.
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

export type IndexRow = {
  name: string;
  slug: string;
  group: string;
  last: number | null;
  changePercent: number | null;
  changeAbs: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
};

export type AllIndicesResult = { asOf: string; indices: IndexRow[] };

function apiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
}

/** Fetches every NSE index. Returns null on any upstream failure — callers render an "unavailable" state rather than an empty directory. */
export async function fetchAllIndices(): Promise<AllIndicesResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiBaseUrl()}/api/finance/indices`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as AllIndicesResult | null;
    if (!data || !Array.isArray(data.indices)) return null;
    return data;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[lib/finance/indices] list fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches one index by slug. Returns null on 404 (unknown slug) or any upstream failure — callers cannot distinguish the two, both render notFound(). */
export async function fetchIndexBySlug(slug: string): Promise<(IndexRow & { asOf: string }) | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiBaseUrl()}/api/finance/indices/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as (IndexRow & { asOf: string }) | null;
    if (!data || typeof data.slug !== "string") return null;
    return data;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[lib/finance/indices] detail fetch failed for ${slug}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
