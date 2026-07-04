/**
 * Fetches India macro projections from the IMF DataMapper public API (no auth key needed).
 *
 * Indicators fetched:
 *   - GDP Growth (NGDP_RPCH): real GDP growth rate %
 *   - CPI Inflation (PCPIPCH): consumer price inflation %
 *
 * The IMF API returns annual figures for past AND future years (projections run out
 * to ~2031). We pick the value for the CURRENT calendar year — the meaningful
 * "current" figure — NOT the max year (which would surface a far-future projection).
 *
 * Defensive design mirrors rbiRates.ts:
 *   - try/catch around every fetch — never throws, returns null on any failure
 *   - plausibility bounds: GDP in [-20, 30], inflation in [-10, 50]
 *   - 8-second timeout to avoid hanging cron runs
 *   - logs warnings for bad scrapes so infra can diagnose layout changes
 */

const GDP_URL = "https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/IND";
const CPI_URL = "https://www.imf.org/external/datamapper/api/v1/PCPIPCH/IND";

const FETCH_TIMEOUT_MS = 8_000;

export type ImfMacroData = {
  gdpGrowth: number | null;
  gdpGrowthYear: number | null;
  cpiInflation: number | null;
  cpiInflationYear: number | null;
  fetchedAt: string;
};

/**
 * Parses the IMF DataMapper JSON response for a single indicator.
 * JSON shape: `{ "values": { "<INDICATOR>": { "IND": { "2024": 8.2, "2025": 6.5, ... } } } }`
 *
 * Returns `{ value, year }` for the CURRENT calendar year within the plausible range
 * (falling back to the nearest available year — preferring actuals/past on ties),
 * or `null` if no valid data point is found.
 */
function parseCurrentYear(
  json: unknown,
  indicatorKey: string,
  minVal: number,
  maxVal: number
): { value: number; year: number } | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const values = root["values"];
  if (typeof values !== "object" || values === null) return null;
  const byIndicator = (values as Record<string, unknown>)[indicatorKey];
  if (typeof byIndicator !== "object" || byIndicator === null) return null;
  const byCountry = (byIndicator as Record<string, unknown>)["IND"];
  if (typeof byCountry !== "object" || byCountry === null) return null;

  const yearMap = byCountry as Record<string, unknown>;
  const nowYear = new Date().getUTCFullYear();

  // Keep only years with a valid, in-range value; then choose the one closest to the
  // current year (tie-break prefers the past/actual over a future projection).
  const validYears = Object.keys(yearMap)
    .map(Number)
    .filter((y) => !Number.isNaN(y))
    .filter((y) => {
      const raw = yearMap[String(y)];
      if (raw === null || raw === undefined) return false;
      const v = Number(raw);
      return Number.isFinite(v) && v >= minVal && v <= maxVal;
    })
    .sort((a, b) => {
      const da = Math.abs(a - nowYear);
      const db = Math.abs(b - nowYear);
      if (da !== db) return da - db;
      return (a > nowYear ? 1 : 0) - (b > nowYear ? 1 : 0);
    });

  if (validYears.length === 0) return null;
  const year = validYears[0];
  return { value: Number(yearMap[String(year)]), year };
}

async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // IMF's CDN 403s Node's default fetch UA (undici) and browser UAs, but allows
    // curl-style clients. Send a curl UA so server-side fetches from the container
    // aren't blocked. (Verified: "curl/8.5.0" → 200, "node"/"undici"/"Mozilla" → 403.)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "curl/8.5.0" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches IMF macro projections for India.
 * Returns `null` on any network or parse failure (never throws).
 * Callers should keep last-known-good values when null is returned.
 */
export async function fetchImfMacro(): Promise<ImfMacroData | null> {
  let gdpJson: unknown;
  let cpiJson: unknown;

  try {
    gdpJson = await fetchWithTimeout(GDP_URL);
  } catch (err) {
    console.warn(
      `[imfMacro] GDP fetch failed: ${err instanceof Error ? err.message : err}`
    );
    gdpJson = null;
  }

  try {
    cpiJson = await fetchWithTimeout(CPI_URL);
  } catch (err) {
    console.warn(
      `[imfMacro] CPI fetch failed: ${err instanceof Error ? err.message : err}`
    );
    cpiJson = null;
  }

  const gdpResult = gdpJson ? parseCurrentYear(gdpJson, "NGDP_RPCH", -20, 30) : null;
  const cpiResult = cpiJson ? parseCurrentYear(cpiJson, "PCPIPCH", -10, 50) : null;

  if (!gdpResult && !cpiResult) {
    console.warn("[imfMacro] both GDP and CPI fetches produced no usable data");
    return null;
  }

  return {
    gdpGrowth: gdpResult?.value ?? null,
    gdpGrowthYear: gdpResult?.year ?? null,
    cpiInflation: cpiResult?.value ?? null,
    cpiInflationYear: cpiResult?.year ?? null,
    fetchedAt: new Date().toISOString(),
  };
}
