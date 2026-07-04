/**
 * Fetches India macro projections from the IMF DataMapper public API (no auth key needed).
 *
 * Indicators fetched:
 *   - GDP Growth (NGDP_RPCH): real GDP growth rate %
 *   - CPI Inflation (PCPIPCH): consumer price inflation %
 *
 * The IMF API returns annual projections for past and future years. We pick the
 * latest year for which the value is non-null (the API includes future projections
 * alongside historical data, so "latest non-null" gives the most recent confirmed
 * or IMF-projected figure, typically the current or next calendar year).
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
 * Returns `{ value, year }` for the latest non-null year within the plausible range,
 * or `null` if no valid data point is found.
 */
function parseLatestYear(
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

  // Sort years descending, pick the latest one with a valid non-null value.
  const yearMap = byCountry as Record<string, unknown>;
  const sortedYears = Object.keys(yearMap)
    .map(Number)
    .filter((y) => !Number.isNaN(y))
    .sort((a, b) => b - a);

  for (const year of sortedYears) {
    const raw = yearMap[String(year)];
    if (raw === null || raw === undefined) continue;
    const val = Number(raw);
    if (!Number.isFinite(val)) continue;
    if (val < minVal || val > maxVal) continue;
    return { value: val, year };
  }
  return null;
}

async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
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

  const gdpResult = gdpJson ? parseLatestYear(gdpJson, "NGDP_RPCH", -20, 30) : null;
  const cpiResult = cpiJson ? parseLatestYear(cpiJson, "PCPIPCH", -10, 50) : null;

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
