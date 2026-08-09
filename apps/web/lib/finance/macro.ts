/**
 * Homepage "Indian Economy" section (2026-08-09) — server-to-server fetcher
 * for apps/api's `/api/finance/macro`, the SAME warm-store route mobile's
 * `IndiaMacroCard` (apps/mobile/src/components/finance-mode.tsx) already
 * consumes via packages/api-client. apps/web has no `MacroSnapshot` model in
 * its own Prisma schema (api-only table), so this hops HTTP rather than
 * querying directly — same loopback rationale as `lib/finance/indices.ts`
 * and the new `lib/finance/marketSummary.ts`.
 *
 * Field set intentionally mirrors mobile's consumption exactly (repoRate/
 * crr/slr from RBI, gdpGrowth/cpiInflation from IMF) — no invented fields.
 * Returns `null` on a total fetch failure OR a 404 (no snapshot seeded
 * yet); either way the caller renders nothing rather than an empty card,
 * same "no empty chrome" convention `IndiaMacroCard` itself uses.
 */

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3001";
const UPSTREAM_TIMEOUT_MS = 8000;

export type MacroSnapshotResult = {
  rbi: { repoRate: number | null; crr: number | null; slr: number | null };
  imf: { gdpGrowth: number | null; gdpGrowthYear: number | null; cpiInflation: number | null; cpiInflationYear: number | null };
  asOf: string | null;
};

function apiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
}

export async function fetchMacroSnapshot(): Promise<MacroSnapshotResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiBaseUrl()}/api/finance/macro`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null; // includes the 404 "no snapshot seeded yet" case
    const data = (await res.json().catch(() => null)) as MacroSnapshotResult | null;
    if (!data || !data.rbi || !data.imf) return null;
    return data;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[lib/finance/macro] fetch failed: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
