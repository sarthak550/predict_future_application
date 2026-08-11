/**
 * Index composition (founder ask, 2026-08-12: "what are composition of
 * index... the composition and other metrics are necessary") — per-index
 * constituent lists sourced from NSE/NiftyIndices' own published CSVs
 * (nsearchives.nseindia.com/content/indices/ind_<name>list.csv family — the
 * SAME keyless, no-cookie-needed host lib/finance/nseSectorMaster.ts's NIFTY
 * Total Market fetch already uses; identical transport/parse/cache shape
 * reused verbatim here, just per-index instead of one fixed URL).
 *
 * COVERAGE (every filename below verified live via a direct curl 2026-08-12,
 * one request per candidate — not assumed from a naming pattern): of the 35
 * indices that get a full `/instruments/[symbol]` page today (5 F&O-tradable
 * underlyings + INDEX_UNIVERSE's 30 view-only indices), 30 have a real,
 * working constituent CSV. The filename does NOT follow one single
 * deterministic rule off the index's own display name — e.g. "NIFTY INDIA
 * MANUFACTURING" is `ind_niftyindiamanufacturing_list.csv` (trailing
 * underscore before "list"), "NIFTY AUTO" is `ind_niftyautolist.csv` (no
 * underscore at all), "NIFTY PRIVATE BANK" is `ind_nifty_privatebanklist.csv`
 * (underscore after "nifty" instead) — so, same discipline as
 * nseSectorMaster.ts and INDEX_UNIVERSE's own `yahooTicker` field, this is a
 * hand-verified dictionary, never derived/guessed at request time. Two index
 * pairs that LOOK like they'd share a file do NOT: "NIFTY FINANCIAL SERVICES"
 * (FINNIFTY's real underlying, 20 names, `ind_niftyfinancelist.csv`) is a
 * DIFFERENT, smaller universe than "NIFTY FINANCIAL SERVICES 25/50"
 * (`ind_niftyfinancialservices25_50list.csv`, a concentration-capped variant
 * with materially different membership, confirmed by a real member-list
 * diff) — the same ^CNXFIN-style trap this codebase already hit once (see
 * business-rules/finance/indexUniverse.ts's own module doc on that ticker).
 *
 * 5 known misses, deliberately excluded — the composition panel simply
 * doesn't render for these, which is the honest default per the brief
 * ("design for partial coverage honestly"), not a bug to chase:
 *   - INDIAVIX: a volatility index has no equity constituents at all.
 *   - NIFTYINDIAFPI150, NIFTYCHEMICALS, NIFTYREITSREALTY, NIFTYCEMENT: no
 *     working `ind_*list.csv` found under nsearchives after ~15 hand-tried
 *     filename variants each (2026-08-12) — NSE may publish these under a
 *     different path/host this round didn't uncover live; worth a follow-up
 *     if the founder wants 100% INDEX_UNIVERSE coverage specifically.
 *
 * The long tail (any index beyond these 35 — see indexLongTail.ts) gets NO
 * composition panel: extending this registry there would mean hand-verifying
 * a CSV per index name on an unbounded, self-growing DB-derived list, which
 * is exactly the kind of second hand-maintained registry indexLongTail.ts's
 * own module doc argues against. Revisit only if the founder specifically
 * asks for long-tail composition.
 *
 * NO WEIGHTS: every verified CSV here is the "Company Name,Industry,Symbol,
 * Series,ISIN Code" shape (same 5 columns nseSectorMaster.ts's file uses) —
 * none of them carry an index weight column. Per the brief, weights are
 * NEVER computed/estimated locally; the column is simply omitted.
 */

const CONSTITUENT_CSV_SLUG: Record<string, string> = {
  // 5 F&O-tradable underlyings (apps/web/lib/finance/indexTradableAlias.ts)
  NIFTY: "ind_nifty50list",
  BANKNIFTY: "ind_niftybanklist",
  FINNIFTY: "ind_niftyfinancelist",
  MIDCPNIFTY: "ind_niftymidcapselect_list",
  NIFTYNXT50: "ind_niftynext50list",

  // INDEX_UNIVERSE — Broad Market (8 of 10; INDIAVIX and NIFTYINDIAFPI150 excluded, see module doc)
  NIFTY100: "ind_nifty100list",
  NIFTY200: "ind_nifty200list",
  NIFTY500: "ind_nifty500list",
  NIFTYMIDCAP50: "ind_niftymidcap50list",
  NIFTYMIDCAP100: "ind_niftymidcap100list",
  NIFTYMIDCAP150: "ind_niftymidcap150list",
  NIFTYTOTALMARKET: "ind_niftytotalmarket_list",
  NIFTYMICROCAP250: "ind_niftymicrocap250_list",

  // INDEX_UNIVERSE — Sectoral (11 of 14; CHEMICALS/REITSREALTY/CEMENT excluded, see module doc)
  NIFTYAUTO: "ind_niftyautolist",
  NIFTYFMCG: "ind_niftyfmcglist",
  NIFTYIT: "ind_niftyitlist",
  NIFTYMEDIA: "ind_niftymedialist",
  NIFTYMETAL: "ind_niftymetallist",
  NIFTYPHARMA: "ind_niftypharmalist",
  NIFTYPSUBANK: "ind_niftypsubanklist",
  NIFTYPRIVATEBANK: "ind_nifty_privatebanklist",
  NIFTYREALTY: "ind_niftyrealtylist",
  NIFTYHEALTHCAREINDEX: "ind_niftyhealthcarelist",
  NIFTYOILGAS: "ind_niftyoilgaslist",

  // Thematic override (see INDEX_UNIVERSE's module doc)
  NIFTYINFRASTRUCTURE: "ind_niftyinfralist",

  // Index Identity Audit five (2026-08-10) — all 5 verified
  NIFTYENERGY: "ind_niftyenergylist",
  NIFTYINDIACONSUMPTION: "ind_niftyconsumptionlist",
  NIFTYINDIAMANUFACTURING: "ind_niftyindiamanufacturing_list",
  NIFTYINDIADEFENCE: "ind_niftyindiadefence_list",
  NIFTYSMALLCAP250: "ind_niftysmallcap250list",
};

const NSE_ARCHIVES_BASE = "https://nsearchives.nseindia.com/content/indices";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface IndexConstituentRow {
  symbol: string;
  companyName: string;
  /** NSE's own industry label (their own naming convention, not GICS — same source nseSectorMaster.ts uses for opinion sector filtering). Null on a malformed row (never observed live, defensive only). */
  industry: string | null;
}

/** "Company Name,Industry,Symbol,Series,ISIN Code" -> rows, same parser shape as nseSectorMaster.ts's parseNseTotalMarketCsv (no embedded commas in any published field). */
function parseConstituentCsv(csv: string): IndexConstituentRow[] {
  const rows: IndexConstituentRow[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const companyName = parts[0]?.trim();
    const industry = parts[1]?.trim() || null;
    const symbol = parts[2]?.trim();
    if (symbol && companyName) rows.push({ symbol, companyName, industry });
  }
  return rows;
}

const cache = new Map<string, { at: number; rows: IndexConstituentRow[] }>();

/** Cheap sync check — lets a caller skip any network/DB work entirely for the ~130+ indices with no verified list (every long-tail index, plus the 5 documented misses). */
export function hasIndexConstituentList(symbol: string): boolean {
  return symbol.trim().toUpperCase() in CONSTITUENT_CSV_SLUG;
}

/**
 * Returns this index's constituent list, or null when unverified/unavailable.
 * Cached 24h per index in-module (rebalances are quarterly-or-rarer events,
 * far less often than this TTL) with stale-serve on a failed refetch —
 * mirrors nseSectorMaster.ts's getNseIndustryMap exactly. Never throws.
 */
export async function fetchIndexConstituents(symbol: string): Promise<IndexConstituentRow[] | null> {
  const key = symbol.trim().toUpperCase();
  const csvSlug = CONSTITUENT_CSV_SLUG[key];
  if (!csvSlug) return null;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${NSE_ARCHIVES_BASE}/${csvSlug}.csv`, {
        headers: { "User-Agent": BROWSER_UA },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`[indexConstituents] ${key} (${csvSlug}.csv) returned ${res.status}`);
      return cached?.rows ?? null;
    }
    const rows = parseConstituentCsv(await res.text());
    if (rows.length === 0) return cached?.rows ?? null;
    cache.set(key, { at: now, rows });
    return rows;
  } catch (err) {
    console.warn(`[indexConstituents] ${key} (${csvSlug}.csv) fetch error: ${err instanceof Error ? err.message : err}`);
    return cached?.rows ?? null;
  }
}
