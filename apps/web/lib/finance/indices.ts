/**
 * All-Indices informational layer — server-to-server fetchers, same
 * direct-to-apps/api loopback pattern as lib/paperTrading/ltp.ts and
 * fnoUniverseServer.ts: apps/web cannot import apps/api's server code
 * directly, so this calls apps/api's /api/finance/indices[/​[slug]] routes
 * server-to-server — NOT through the app/api/indices/** browser-facing
 * proxy routes (those exist for client-side fetches; going through them
 * here would add an unnecessary extra hop for a server component).
 *
 * Uses `cache: "no-store"` — the prior version of this comment argued for
 * relying on the page's ISR revalidate window instead, but that's wrong for
 * an internal-only loopback target: apps/web's Docker build statically
 * prerenders ISR pages during `next build`, BEFORE the two containers are
 * networked together, so `pf-api` doesn't resolve yet. Without no-store, the
 * resulting build-time fetch failure gets baked permanently into the built
 * image — no runtime restart or on-demand revalidation can undo it
 * afterward. Found and fixed 2026-08-09 (see lib/finance/marketSummary.ts's
 * doc comment for the full incident writeup — same bug, same root cause,
 * this file's own comment is what that new code mistakenly copied from).
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
      headers: { Accept: "application/json" },
      cache: "no-store",
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
      headers: { Accept: "application/json" },
      cache: "no-store",
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
