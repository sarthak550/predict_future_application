/**
 * Paper Trading Phase 3 (T3) — client-side cached fetch of the F&O stock
 * universe, shared by two independent UI surfaces that both need the same
 * ~210-row payload: the options chain browser's Stock-mode combobox (T7) and
 * the "Paper trade this call" CTA's F&O-eligibility check (T8).
 *
 * Deliberately module-level (not a React context/store) — this data is the
 * same for every user and every page on the site, so a plain in-memory
 * singleton cache is the simplest correct thing, same "fetch once, filter
 * client-side" judgment call the brief makes for the underlying dataset size
 * (~210 rows). Fetches once per browser tab per TTL window; concurrent
 * callers during the first fetch share the same in-flight promise rather than
 * firing duplicate requests.
 */

export interface FnoUniverseEntry {
  symbol: string;
  companyName: string;
}

// Mirrors the server-side proxy's Cache-Control (1h) — no point re-fetching
// client-side more often than the upstream itself refreshes.
const CLIENT_CACHE_TTL_MS = 60 * 60 * 1000;

let cache: { at: number; data: FnoUniverseEntry[] } | null = null;
let inflight: Promise<FnoUniverseEntry[]> | null = null;

/**
 * Returns the cached universe if fresh, otherwise fetches
 * GET /api/paper-trading/options/universe. Never throws — on any failure
 * returns the last good cache (or an empty array on a cold-start failure),
 * so a transient blip degrades to "combobox has no results yet" / "CTA hidden
 * this render", never a crash.
 */
export async function fetchFnoUniverseClient(): Promise<FnoUniverseEntry[]> {
  const now = Date.now();
  if (cache && now - cache.at < CLIENT_CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/paper-trading/options/universe");
      if (!res.ok) return cache?.data ?? [];
      const data = await res.json().catch(() => null);
      const list: FnoUniverseEntry[] = Array.isArray(data?.universe) ? data.universe : [];
      if (list.length > 0) cache = { at: Date.now(), data: list };
      return cache?.data ?? list;
    } catch {
      return cache?.data ?? [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
