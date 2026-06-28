/**
 * Fetches RBI's current monetary-policy rates from the public RBI homepage
 * (https://www.rbi.org.in). These are public-domain figures RBI updates on MPC days.
 *
 * There is NO official RBI rates API, so this scrapes the homepage's policy-rates
 * widget, which renders each rate as a label followed by its percentage value
 * (e.g. "Policy Repo Rate" → "5.25%"). The parser locates each known label and takes
 * the next percentage token. It is deliberately defensive:
 *   - validates every value is a plausible rate (0 < x <= 25)
 *   - returns null if the headline Repo Rate can't be parsed (never returns garbage)
 * Callers should keep the last-known-good value on a null/failed fetch.
 */

const RBI_URL = "https://www.rbi.org.in/";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Accept: "text/html",
};

export type RbiPolicyRates = {
  policyRepoRate: number | null;
  standingDepositFacilityRate: number | null;
  marginalStandingFacilityRate: number | null;
  bankRate: number | null;
  cashReserveRatio: number | null;
  statutoryLiquidityRatio: number | null;
  /** ISO timestamp of when this snapshot was fetched. */
  fetchedAt: string;
};

const LABELS: { key: keyof Omit<RbiPolicyRates, "fetchedAt">; label: string }[] = [
  { key: "policyRepoRate", label: "Policy Repo Rate" },
  { key: "standingDepositFacilityRate", label: "Standing Deposit Facility Rate" },
  { key: "marginalStandingFacilityRate", label: "Marginal Standing Facility Rate" },
  { key: "bankRate", label: "Bank Rate" },
  // RBI's rates widget labels CRR/SLR with the abbreviations (e.g. "CRR : 3.00%").
  { key: "cashReserveRatio", label: "CRR" },
  { key: "statutoryLiquidityRatio", label: "SLR" },
];

/** Strip tags → collapse whitespace, so labels and their values become adjacent tokens. */
function toText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePercentAfter(text: string, label: string): number | null {
  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;
  // Look only at a short window after the label so we grab ITS value, not a later one.
  const window = text.slice(idx + label.length, idx + label.length + 40);
  const m = window.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0 || val > 25) return null; // sanity bound
  return val;
}

export function parseRbiRatesFromHtml(html: string): RbiPolicyRates | null {
  const text = toText(html);
  const out: Partial<RbiPolicyRates> = {};
  for (const { key, label } of LABELS) {
    out[key] = parsePercentAfter(text, label);
  }
  // The Repo Rate is the headline; if we can't read it, treat the whole parse as failed.
  if (out.policyRepoRate == null) return null;
  return {
    policyRepoRate: out.policyRepoRate ?? null,
    standingDepositFacilityRate: out.standingDepositFacilityRate ?? null,
    marginalStandingFacilityRate: out.marginalStandingFacilityRate ?? null,
    bankRate: out.bankRate ?? null,
    cashReserveRatio: out.cashReserveRatio ?? null,
    statutoryLiquidityRatio: out.statutoryLiquidityRatio ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchRbiPolicyRates(): Promise<RbiPolicyRates | null> {
  let res: Response;
  try {
    res = await fetch(RBI_URL, { headers: FETCH_HEADERS });
  } catch (err) {
    console.warn(`[rbiRates] network error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[rbiRates] RBI returned ${res.status}`);
    return null;
  }
  const html = await res.text();
  const parsed = parseRbiRatesFromHtml(html);
  if (!parsed) {
    console.warn("[rbiRates] could not parse policy rates from RBI homepage (layout changed?)");
  }
  return parsed;
}
