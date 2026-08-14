/**
 * Shared AMFI scheme-master ISIN join (factored out of etfRegistry.ts,
 * 2026-08-14, as part of BSE Phase 3B — the BSE fund registry
 * (bseFundRegistry.ts) needs the exact same real-name join etfRegistry.ts
 * already built for NSE ETFs, and the brief's own instruction is "avoid
 * duplicating the name-search machinery — refactor-in-place if cleaner." No
 * behavior change for etfRegistry.ts's existing NSE join — this is a pure
 * extraction, verified byte-identical logic (same regex, same 6-field/
 * numeric-scheme-code row recognition, same first-seen-wins collision rule).
 *
 * Bonus: previously each registry (etfRegistry.ts, now also
 * bseFundRegistry.ts) fetched+parsed the ~14.2k-row AMFI file independently
 * on its own 24h cache. Centralizing the fetch here means BOTH registries
 * share ONE cached parse (own 24h TTL below) instead of two, halving the
 * daily AMFI download.
 *
 * SOURCE (verified live 2026-08-12, re-verified 2026-08-14):
 * `portal.amfiindia.com/spages/NAVAll.txt` — semicolon-delimited,
 * `SchemeCode;ISIN Div Payout/Growth;ISIN Div Reinvestment;SchemeName;NAV;
 * Date`, with bare section-header lines interspersed — parsed defensively:
 * exactly 6 `;`-fields AND a numeric scheme code, or the line is skipped.
 */

const AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** End-anchored, mechanical only — never matches a "Growth"/"IDCW" token that isn't the trailing plan designation (e.g. "HDFC NIFTY GROWTH SECTORS 15 ETF" keeps its real index name; see `cleanAmfiName`'s doc). */
const TRAILING_GROWTH_SUFFIX_RE = /(\s*-\s*|\s+)growth(\s+(option|plan))?\s*$/i;

/**
 * Strips a trailing AMFI plan-designation suffix ("- Growth", "- Growth
 * Option", "- Growth Plan", "GROWTH", any casing/spacing) and collapses
 * stray double-spaces AMFI's own data occasionally contains. Deliberately
 * does NOT strip an IDCW suffix — verified live 2026-08-12 that several
 * liquid/overnight ETFs (e.g. "Aditya Birla Sun Life CRISIL Liquid Overnight
 * ETF - IDCW Daily Reinvestment with Weekly Payout") are IDCW-only funds
 * where that suffix IS the fund's real, only-listed identity, not
 * interchangeable plan noise the way a redundant "- Growth" is on a
 * single-plan ETF.
 */
export function cleanAmfiName(raw: string): string {
  const stripped = TRAILING_GROWTH_SUFFIX_RE.test(raw) ? raw.replace(TRAILING_GROWTH_SUFFIX_RE, "") : raw;
  return stripped.replace(/\s{2,}/g, " ").trim();
}

/**
 * Parses AMFI's NAVAll.txt into an ISIN -> real scheme-name map, checking
 * BOTH ISIN columns (either can be a "-" placeholder). Defensive against the
 * file's interspersed section-header lines and blank separator lines: a data
 * row is recognized only by having exactly 6 `;`-delimited fields AND a
 * numeric first field (the scheme code) — this also skips the literal
 * column-header row. On a rare ISIN collision the first-seen name wins
 * rather than silently overwriting.
 */
export function parseAmfiIsinMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(";")) continue;
    const parts = trimmed.split(";");
    if (parts.length !== 6) continue;
    const [schemeCode, isinPayoutGrowth, isinReinvestment, schemeName] = parts;
    if (!/^\d+$/.test(schemeCode.trim())) continue;
    const name = schemeName.trim();
    if (!name) continue;
    for (const isinRaw of [isinPayoutGrowth, isinReinvestment]) {
      const isin = isinRaw.trim().toUpperCase();
      if (isin && isin !== "-" && !map.has(isin)) map.set(isin, name);
    }
  }
  return map;
}

let cache: { at: number; map: Map<string, string> } | null = null;
let inFlight: Promise<Map<string, string> | null> | null = null;

async function fetchAndParse(): Promise<Map<string, string> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(AMFI_NAV_URL, { headers: { "User-Agent": BROWSER_UA }, cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`[amfi] AMFI NAVAll.txt returned ${res.status}`);
      return null;
    }
    return parseAmfiIsinMap(await res.text());
  } catch (err) {
    console.warn(`[amfi] AMFI NAVAll.txt fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * ISIN -> real scheme-name map, shared 24h cache across every caller
 * (etfRegistry.ts, bseFundRegistry.ts). Stale-serve on a failed refetch, same
 * discipline as etfRegistry.ts's own CSV fetch; returns `null` only when
 * there has never been a successful fetch yet.
 */
export async function fetchAmfiIsinMap(): Promise<Map<string, string> | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.map;
  if (inFlight) return inFlight;
  inFlight = fetchAndParse()
    .then((map) => {
      if (map && map.size > 0) {
        cache = { at: now, map };
        return map;
      }
      // Stale-serve: a failed/empty refetch keeps the previous good map alive.
      return cache?.map ?? null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
