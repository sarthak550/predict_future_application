/**
 * Market Pulse stock-news quality pipeline — shared between apps/api's
 * `/api/finance/market-moves/news` route (mobile) and apps/web's
 * `fetchLatestNews` (the public /pulse page), so both surfaces apply the
 * exact same dedup + credibility rules instead of the web lib's previous
 * "exact-headline dedup only" shortcut, which let the full mess of
 * NSE/BSE twin rows, reworded-headline near-duplicates, and low-credibility
 * aggregator junk through onto the public page.
 *
 * Two read-time problems this closes:
 *   1. REPEATED NEWS — the same event is stored under both an NSE ticker
 *      symbol and its "BSE:<code>" twin (identical headline, two rows), and
 *      arrives worded differently from multiple publishers. Fixed by exact
 *      dedup (NSE-over-BSE preference) + near-duplicate collapse
 *      (collapseNearDuplicates) + a per-ticker cap (capPerTicker).
 *   2. JUNK HEADLINES — a handful of low-credibility aggregator publishers
 *      (observed in prod: Sahi, Whalesbook, scanx.trade) republish
 *      contradictory/garbled numbers relative to mainstream coverage of the
 *      same event. Fixed by BLOCKLISTED_PUBLISHERS (dropped entirely, both
 *      at ingestion in googleNews.ts and read-time here) plus a trusted-
 *      publisher preference when a near-duplicate cluster picks its
 *      surviving representative headline.
 *
 * Every function here is pure (no I/O, no Prisma import) so it can run
 * identically in apps/api (Node/Next API routes) and apps/web (Next server
 * components) — the two apps' local row types just need to satisfy
 * StockNewsRow structurally.
 */

/** Minimal structural shape both apps' MarketMoveNews row types satisfy. */
export type StockNewsRow = {
  id: string;
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: Date;
};

// ---------------------------------------------------------------------------
// Company-name / relevance helpers (moved from apps/api/lib/marketMoves/
// googleNews.ts — re-exported there for backward compatibility since other
// api code, and that file's own buildGoogleNewsQuery/isRelevantHeadline,
// import these by name).
// ---------------------------------------------------------------------------

/** Corporate-suffix tokens stripped only when they trail the company name (case-insensitive). */
const TRAILING_SUFFIX_PATTERN =
  /\s+(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?)\s*$/i;

/**
 * Strips a trailing corporate-suffix token ("Limited", "Ltd", "Ltd.", "Pvt
 * Ltd", "Private Limited") from the end of a company name only — mid-name
 * words like "Industries" (e.g. "Reliance Industries") are never touched
 * because the pattern is anchored to the end of the string.
 */
export function stripCorporateSuffix(companyName: string): string {
  const stripped = companyName.replace(TRAILING_SUFFIX_PATTERN, "").trim();
  return stripped || companyName.trim();
}

/** lowercase, strip punctuation, collapse whitespace — for company-name token matching. */
function normalizeCompanyName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generic business/civic words that are worthless as a relevance anchor on
 * their own — a huge slice of PSU banks/insurers/finance companies are named
 * almost entirely out of these ("State Bank Of India", "Bank Of Baroda",
 * "Life Insurance Corp", "New India Assurance"). See the Phase 1c QA fail:
 * "RBI holds repo rate, bank stocks mixed" wrongly matched both Bank of
 * Baroda and Bank of India via the word "bank".
 */
const GENERIC_COMPANY_STOPWORDS = new Set([
  "bank", "state", "national", "general", "united", "central", "indian", "india",
  "life", "new", "housing", "power", "union", "corporation", "corp", "limited",
  "ltd", "company", "co", "industries", "finance", "financial", "insurance",
  "assurance", "development", "services", "enterprises", "holdings", "group",
  "motors", "private", "pvt", "public", "sector", "and", "the", "of",
]);

/**
 * The single most distinctive token in a company name for relevance matching
 * and near-duplicate event-token extraction: the longest word that isn't a
 * generic business/civic stopword and is at least 4 characters (short words
 * are too collision-prone). Returns null when every token is generic (e.g.
 * "Bank Of India").
 */
export function mostDistinctiveNameToken(companyName: string): string | null {
  const cleanName = stripCorporateSuffix(companyName);
  const candidates = normalizeCompanyName(cleanName)
    .split(" ")
    .filter((word) => word.length >= 4 && !GENERIC_COMPANY_STOPWORDS.has(word));

  if (candidates.length === 0) return null;

  return candidates.reduce((longest, word) => (word.length > longest.length ? word : longest));
}

// ---------------------------------------------------------------------------
// Material / roundup headline filters (moved from googleNews.ts — re-exported
// there for backward compatibility).
// ---------------------------------------------------------------------------

/**
 * Earnings/results signal. Exported separately (in addition to living inside
 * MATERIAL_SIGNAL_PATTERNS below) because near-duplicate collapse's Rule A
 * reuses this exact pattern to detect "these two headlines are both about
 * the same results announcement". Keep this as the single source of truth.
 */
export const EARNINGS_RESULTS_PATTERN =
  /\b(q[1-4]|h[12]|fy\d{2,4}|quarterly|results?|profit|revenue|earnings|net\s+income|ebitda|margins?)\b/i;

/**
 * List/roundup headlines ("Top gainers today", "5 stocks to watch", "Nifty
 * movers") false-positive relevance checks upstream because a ticker/company
 * token happens to appear inside a headline that enumerates many stocks, not
 * one.
 */
const ROUNDUP_PATTERNS: RegExp[] = [
  /\btop (gainers|losers|movers)\b/i,
  /\bstocks? to (watch|buy|track)\b/i,
  /\bstocks? in (focus|news)\b/i,
  /\bnifty(\s*50)? (movers|top gainers|top losers)\b/i,
  /\bbuzzing stocks?\b/i,
  /\bf\s*&\s*o\b.*\b(stocks?|ban)\b/i,
  /\bmarket (close|opening|wrap|highlights|live)\b/i,
  /\bshare market (highlights|updates|live)\b/i,
  /\b\d+\s+stocks?\b/i,
  /\bsensex\b.{0,40}\bnifty\b|\bnifty\b.{0,40}\bsensex\b/i,
];

/** True if the headline matches a known list/roundup shape — see ROUNDUP_PATTERNS doc comment. */
export function isRoundupHeadline(cleanTitle: string): boolean {
  return ROUNDUP_PATTERNS.some((pattern) => pattern.test(cleanTitle));
}

/**
 * Material/price-impact allow-list. A headline must match at least one of
 * these to be kept — see isMaterialHeadline doc comment for the full
 * precedence rule. Plain deterministic regex, no AI/embeddings.
 */
const MATERIAL_SIGNAL_PATTERNS: RegExp[] = [
  EARNINGS_RESULTS_PATTERN,
  // M&A / stake moves
  /\b(acqui(re|res|red|sition)|merger|merges?|stake\s*(buy|sale|purchase|acquisition)|buys?\s+stake|sells?\s+stake|takeover|divest(s|ment)?)\b/i,
  // Orders / deals / contracts
  /\b(order\s*win|wins?\s+(order|contract|deal)|bags?\s+(order|contract|deal)|contract\s+win|deal\s+worth|inks?\s+(deal|pact|agreement)|secures?\s+(order|contract))\b/i,
  // Capital actions — dividends / buyback / bonus / split / rights issue
  /\b(dividend|buyback|bonus\s+shares?|stock\s+split|share\s+split|rights\s+issue)\b/i,
  // Ratings / target changes / analyst calls
  /\b(upgrades?|downgrades?|target\s+price|rating\s+(upgrade|downgrade)|initiates?\s+coverage|maintains?\s+(buy|sell|hold)|outperform|underperform|overweight|underweight|buy\s+call|sell\s+call)\b/i,
  // Guidance changes
  /\b(guidance|outlook\s+(raised|cut|revised)|raises?\s+(guidance|forecast|revenue)|cuts?\s+(guidance|forecast)|revises?\s+(guidance|forecast))\b/i,
  // Large investment / capex / expansion
  /\b(invests?\s+(₹|rs\.?|inr)?\s*[\d,]+|to\s+invest\s|capex|capital\s+expenditure|announces?\s+investment|to\s+set\s*up|expansion|expand(s|ing)?\s+(capacity|plant|facility))\b/i,
  // Sharp price move — verbs
  /\b(surge[sd]?|jump[sd]?|soar[sd]?|plung(e[sd]?|ing)|slump[sd]?|tumbl(e[sd]?|ing)|crash(es|ed)?|rallie[sd]?|skyrocket(s|ed)?|tank(s|ed)?|slid(e|es)?|falls?|fell)\b/i,
  // Sharp price move — 52-week/record high-low
  /\bhits?\s+(52.?week|record|all.?time)\s+(high|low)\b/i,
  // Sharp price move — explicit percentage
  /\b\d+(\.\d+)?\s*%/,
  // Regulatory / legal / SEBI-RBI action
  /\b(sebi|rbi|nclt|cci\b|penalt(y|ies)|fine[sd]?|probe|investigation|litigation|lawsuit|court\s+(order|ruling)|bars?\s+from|banned?\b|raids?|frauds?|insolvenc(y|ies))\b/i,
  // Block / bulk deals / promoter activity
  /\b(block\s+deal|bulk\s+deal|promoters?\s+(buys?|sells?|pledg(e[sd]?|ing)))\b/i,
  // Fundraise / IPO / QIP
  /\b(ipo\b|qip\b|fpo\b|fundrais|fund.?raising|preferential\s+allotment)\b/i,
];

/**
 * Documented non-material shapes — belt-and-suspenders, NOT an override: a
 * headline matching both a material and a deny pattern is still KEPT (see
 * isMaterialHeadline). `resign`/`steps down` are deliberately NOT included
 * here — a CXO resignation is often genuinely price-moving and a regex can't
 * reliably distinguish it from a junior-role resignation, so those headlines
 * fall through to the default-drop-unless-material rule instead of being
 * force-dropped, and are still kept if a real material signal is present.
 */
const NON_MATERIAL_PATTERNS: RegExp[] = [
  // Board / independent-director appointments (not senior CXO changes)
  /\b(appoints?|independent\s+director|non.?executive\s+director|inducted?\s+(as|to)\s+the\s+board)\b/i,
  // Interviews / opinion pieces / podcasts
  /\b(interview|exclusive\s+interview|in\s+conversation\s+with|speaks?\s+exclusively|opinion:|editorial:|podcast)\b/i,
  // Awards / rankings / recognitions
  /\b(award[s]?|ranked\s|ranking|recogni[sz](e[sd]?|tion)|felicitat|honou?red|wins?\s+(award|recognition|title)|listed\s+among|features?\s+in\s+.*(list|ranking))\b/i,
  // CSR / sustainability / sponsorships / academic partnerships
  /\b(\bcsr\b|sustainab|sponsor(s|ship)?|esg\s+report|plants?\s+\d*\s*trees?|donates?|charity|philanthrop|partners?\s+with\b.*\b(university|academia|institute))\b/i,
  // Product-launch PR fluff
  /\b(launches?\s+new|unveils?|introduces?\s+new|rolls?\s+out\s+new)\b/i,
  // Routine operational updates / conference mentions
  /\b(to\s+participate\s+in|will\s+attend|hosts?\s+(conference|summit|event)|holds?\s+(webinar|workshop)|celebrates?|inaugurat(e[sd]?|ion))\b/i,
];

/**
 * Material/price-impact gate (HARD requirement — Market Pulse only shows
 * news that could plausibly move the stock). Precedence:
 *   1. Matches a MATERIAL_SIGNAL_PATTERNS entry -> keep, regardless of any
 *      deny match (material always wins).
 *   2. Else matches a NON_MATERIAL_PATTERNS entry -> drop (documented case).
 *   3. Else -> drop (default-drop-unless-material).
 */
export function isMaterialHeadline(cleanTitle: string): boolean {
  return MATERIAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(cleanTitle));
}

// ---------------------------------------------------------------------------
// Publisher credibility — NEW.
// ---------------------------------------------------------------------------

/**
 * Conservative blocklist of junk aggregator publishers observed in prod
 * republishing contradictory/garbled figures relative to mainstream coverage
 * of the same event (e.g. "profit rises 6% to record ₹23,196 crore" from
 * these sources vs. TOI/mainstream correctly reporting "profit falls 22% to
 * ₹20,946 crore" for the same quarter). Matched case-insensitively as a
 * substring against either the stored `publisher` name or the `sourceUrl`
 * hostname — extend this list as new junk aggregators surface.
 */
export const BLOCKLISTED_PUBLISHERS: readonly string[] = [
  "sahi",
  "whalesbook",
  "scanx.trade",
  "marketsmojo",
];

/**
 * True if a row's publisher matches BLOCKLISTED_PUBLISHERS by name or by the
 * sourceUrl's hostname. Blocklisted rows are dropped entirely — both at
 * ingestion (googleNews.ts's fetch loop) and again at read-time here, so
 * rows stored before the blocklist existed are also filtered out.
 */
export function isBlockedPublisher(row: { publisher: string; sourceUrl: string }): boolean {
  const publisherLower = row.publisher.toLowerCase();
  if (BLOCKLISTED_PUBLISHERS.some((name) => publisherLower.includes(name))) {
    return true;
  }

  try {
    const host = new URL(row.sourceUrl).hostname.toLowerCase();
    if (BLOCKLISTED_PUBLISHERS.some((name) => host.includes(name))) {
      return true;
    }
  } catch {
    // sourceUrl isn't a resolvable absolute URL (e.g. a relative Google News
    // redirect stub) — publisher-name match above is authoritative in that case.
  }

  return false;
}

/**
 * Trusted mainstream publishers, in preference-priority tiers (checked in
 * order; the first tier with a match in a near-duplicate cluster wins). Each
 * tier is a list of case-insensitive alias substrings for the same outlet
 * (Google News RSS decodes publisher names inconsistently — "The Economic
 * Times" vs "ETMarkets", "Mint" vs "LiveMint" — so a tier can match on any
 * alias without disturbing priority order). Unknown (non-trusted,
 * non-blocklisted) publishers rank below every tier here but still above
 * blocklisted ones, since blocklisted rows never reach this stage.
 */
export const TRUSTED_PUBLISHER_TIERS: readonly (readonly string[])[] = [
  ["economic times", "economictimes"],
  ["livemint", "mint"],
  ["moneycontrol"],
  ["business standard"],
  ["times of india"],
  ["cnbctv18", "cnbc-tv18", "cnbc tv18"],
  ["ndtv profit"],
  ["hindu businessline", "businessline", "business line"],
  ["reuters"],
  ["financial express"],
];

/**
 * Which row survives a near-duplicate cluster: prefer the highest-priority
 * TRUSTED_PUBLISHER_TIERS match, else the earliest-published row in the
 * cluster (deterministic, no randomness). Callers MUST filter out
 * isBlockedPublisher rows before clustering — this function does not itself
 * re-check the blocklist, so a blocklisted row could otherwise still win via
 * the earliest-published fallback.
 */
function pickClusterRepresentative<T extends StockNewsRow>(cluster: T[]): T {
  if (cluster.length === 1) return cluster[0];

  for (const tier of TRUSTED_PUBLISHER_TIERS) {
    const match = cluster.find((row) => {
      const publisherLower = row.publisher.toLowerCase();
      return tier.some((alias) => publisherLower.includes(alias));
    });
    if (match) return match;
  }

  return cluster.reduce((earliest, row) =>
    row.publishedAt.getTime() < earliest.publishedAt.getTime() ? row : earliest
  );
}

// ---------------------------------------------------------------------------
// Exact-headline dedup (NSE-over-BSE preference).
// ---------------------------------------------------------------------------

function normalizeHeadlineForExactDedupe(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Pass 1 — exact-headline dedup. The same story is frequently stored under
 * both an NSE ticker symbol and its "BSE:<code>" twin (identical headline,
 * two rows) — this collapses those to one row, preferring the NSE-symbol
 * version, using a Map so the first-seen row's position in the reverse-chron
 * order is preserved for whichever row wins.
 */
function dedupeExactHeadlines<T extends StockNewsRow>(rows: T[]): T[] {
  const dedup = new Map<string, T>();
  for (const row of rows) {
    const key = normalizeHeadlineForExactDedupe(row.headline);
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, row);
    } else if (existing.tickerSymbol.startsWith("BSE:") && !row.tickerSymbol.startsWith("BSE:")) {
      dedup.set(key, row); // upgrade to the NSE-symbol version (Map keeps position)
    }
  }
  return [...dedup.values()];
}

// ---------------------------------------------------------------------------
// Near-duplicate collapse (reworded headlines about the same event).
// ---------------------------------------------------------------------------

/** Near-duplicate collapse window: reworded stories about the same event. */
const NEAR_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Per-ticker feed cap: at most this many rows per ticker per assembled page. */
export const MAX_PER_TICKER_PER_PAGE = 2;

/**
 * Boilerplate words common to nearly every stock-news headline — stripped
 * (in addition to ordinary English stopwords) before computing Rule B's
 * shared "event token" overlap, so two headlines don't look similar merely
 * because they're both about "shares" "surging" on "results" day.
 */
const NEWS_BOILERPLATE_STOPWORDS = new Set([
  "shares", "share", "stock", "stocks", "surge", "surges", "jump", "jumps",
  "rally", "gain", "gains", "gainer", "gainers", "rise", "rises", "results",
  "result", "beat", "beats", "report", "reports", "reported", "announce",
  "announces", "announced", "update", "updates", "news", "today", "crore",
  "cr", "lakh", "percent", "set", "sets",
]);

/** Ordinary English stopwords — not finance-specific, just generic noise. */
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "is",
  "are", "was", "were", "by", "with", "from", "as", "its", "it", "this",
  "that", "after", "amid", "amidst", "amongst", "over", "up", "down", "will",
  "has", "have", "had", "be", "been", "not", "no", "so", "but", "if", "than",
  "then", "into", "out", "about", "across", "says", "say", "said",
]);

/**
 * Short finance acronyms that qualify as an "event token" for Rule B despite
 * being under the normal 4-character minimum. `&` is stripped before
 * tokenizing, so "M&A" is represented here as "ma".
 */
const EVENT_TOKEN_ACRONYM_WHITELIST = new Set([
  "ai", "ipo", "ev", "jv", "mou", "eps", "ma", "esg", "egm", "agm", "nclt",
  "sebi", "rbi", "fy",
]);

function normalizeHeadlineTokens(headline: string): string[] {
  return headline
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isQualifyingEventToken(token: string): boolean {
  return token.length >= 4 || EVENT_TOKEN_ACRONYM_WHITELIST.has(token);
}

/**
 * Rule B's "event token" set for one headline: lowercase, punctuation-
 * stripped tokens with the company-name distinctive token, the ticker
 * symbol, and both stopword lists removed, keeping only tokens that are
 * either >= 4 chars or a whitelisted finance acronym.
 */
function extractEventTokens(headline: string, companyName: string, tickerSymbol: string): Set<string> {
  const distinctiveToken = mostDistinctiveNameToken(companyName);
  const tickerToken = tickerSymbol.replace(/^BSE:/i, "").replace(/&/g, "").toLowerCase();

  const tokens = normalizeHeadlineTokens(headline).filter((token) => {
    if (token === distinctiveToken) return false;
    if (token === tickerToken) return false;
    if (ENGLISH_STOPWORDS.has(token)) return false;
    if (NEWS_BOILERPLATE_STOPWORDS.has(token)) return false;
    return isQualifyingEventToken(token);
  });

  return new Set(tokens);
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count++;
  }
  return count;
}

/**
 * Pass 2 — near-duplicate collapse (runs after the exact-headline dedup
 * pass above). Groups rows by tickerSymbol, then within each group clusters
 * rows within a 24h window via Rule A (both match EARNINGS_RESULTS_PATTERN —
 * the dominant reworded-results-headline case) or Rule B (share >= 2 event
 * tokens after stripping company/ticker/stopwords — catches one-off events
 * like a reworded investment announcement). One representative row survives
 * per cluster, chosen by pickClusterRepresentative (trusted-publisher
 * preference).
 */
function collapseNearDuplicates<T extends StockNewsRow>(rows: T[]): T[] {
  const byTicker = new Map<string, T[]>();
  for (const row of rows) {
    const group = byTicker.get(row.tickerSymbol);
    if (group) {
      group.push(row);
    } else {
      byTicker.set(row.tickerSymbol, [row]);
    }
  }

  const survivors: T[] = [];

  for (const group of byTicker.values()) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }

    // Union-find over the group's indices — clusters transitively (if A~B
    // and B~C, all three end up in one cluster even if A and C alone
    // wouldn't match).
    const parent = group.map((_, i) => i);
    const find = (i: number): number => {
      if (parent[i] !== i) parent[i] = find(parent[i]);
      return parent[i];
    };
    const union = (a: number, b: number) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootA] = rootB;
    };

    const matchesEarnings = group.map((row) => EARNINGS_RESULTS_PATTERN.test(row.headline));
    const eventTokens = group.map((row) => extractEventTokens(row.headline, row.companyName, row.tickerSymbol));

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const withinWindow =
          Math.abs(group[i].publishedAt.getTime() - group[j].publishedAt.getTime()) <=
          NEAR_DUPLICATE_WINDOW_MS;
        if (!withinWindow) continue;

        const ruleA = matchesEarnings[i] && matchesEarnings[j];
        const ruleB = !ruleA && sharedTokenCount(eventTokens[i], eventTokens[j]) >= 2;

        if (ruleA || ruleB) union(i, j);
      }
    }

    const clusters = new Map<number, T[]>();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const cluster = clusters.get(root);
      if (cluster) {
        cluster.push(group[i]);
      } else {
        clusters.set(root, [group[i]]);
      }
    }

    for (const cluster of clusters.values()) {
      survivors.push(pickClusterRepresentative(cluster));
    }
  }

  return survivors;
}

/**
 * Pass 3 — per-ticker feed cap (runs after near-duplicate collapse +
 * re-sort). Walks the reverse-chron list keeping at most `maxPerTicker` rows
 * per ticker; scope is per-call (not a global rolling cap), so a capped
 * ticker can still surface older rows on a later page/call.
 */
function capPerTicker<T extends StockNewsRow>(rows: T[], maxPerTicker: number): T[] {
  const counts = new Map<string, number>();
  const capped: T[] = [];

  for (const row of rows) {
    const count = counts.get(row.tickerSymbol) ?? 0;
    if (count >= maxPerTicker) continue;
    counts.set(row.tickerSymbol, count + 1);
    capped.push(row);
  }

  return capped;
}

// ---------------------------------------------------------------------------
// Composed pipeline.
// ---------------------------------------------------------------------------

/**
 * The full Market Pulse stock-news read-side quality pipeline, in order:
 *   1. Drop blocklisted-publisher rows entirely (isBlockedPublisher).
 *   2. Drop non-material / roundup headlines (isMaterialHeadline / isRoundupHeadline).
 *   3. Exact-headline dedup, preferring the NSE-symbol row over its BSE: twin.
 *   4. Near-duplicate collapse (reworded headlines about the same event),
 *      re-sorted reverse-chronological (a cluster's surviving row isn't
 *      always the newest, per the trusted-publisher tie-break).
 *   5. Per-ticker cap (MAX_PER_TICKER_PER_PAGE).
 *
 * `options.limit`, if given, slices the final result to at most that many
 * rows — callers that need pagination metadata (hasMore/nextCursor) should
 * omit `limit` and slice the returned array themselves (over-fetch the input
 * `rows` generously, since every pass here can only shrink the set).
 */
export function refineStockNews<T extends StockNewsRow>(
  rows: T[],
  options: { limit?: number } = {}
): T[] {
  const qualityFiltered = rows.filter(
    (row) => !isBlockedPublisher(row) && isMaterialHeadline(row.headline) && !isRoundupHeadline(row.headline)
  );

  const exactDeduped = dedupeExactHeadlines(qualityFiltered);

  const nearDupCollapsed = collapseNearDuplicates(exactDeduped).sort((a, b) => {
    const byTime = b.publishedAt.getTime() - a.publishedAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });

  const capped = capPerTicker(nearDupCollapsed, MAX_PER_TICKER_PER_PAGE);

  return typeof options.limit === "number" ? capped.slice(0, options.limit) : capped;
}
