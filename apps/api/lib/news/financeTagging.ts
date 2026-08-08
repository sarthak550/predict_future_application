/**
 * Finance story tagging — India-market keyword detection.
 *
 * A story is tagged FINANCE when:
 *   (a) its source is in the approved Indian finance source domain list, AND
 *   (b) its title or summary contains at least one Indian market keyword (case-insensitive).
 *
 * Stories WITHOUT an India angle do NOT get the FINANCE tag even if they come from a
 * finance source (e.g. an ET article about US Fed policy with no India mention → not FINANCE).
 */

/** Approved Indian finance news source domains for FINANCE tagging.
 *  Must be kept in sync with `ANALYST_OPINION_SOURCES` domains in extractExpertOpinions.ts. */
const FINANCE_SOURCE_DOMAINS = [
  "moneycontrol.com",
  "economictimes.indiatimes.com",
  "livemint.com",
  "cnbctv18.com",
  "seekingalpha.com",
  "bloomberg.com",
  "reuters.com",
  // Added 2026-08-08 alongside the 4 new Indian finance RSS sources in
  // rssSources.ts (ndtv-profit, gnews-business-standard, gnews-zeebiz,
  // gnews-financial-express) — without a FINANCE_SOURCE_DOMAINS entry these
  // sources' stories would fetch fine but never tag FINANCE, so they'd never
  // reach the Feed's Finance surface or the finance-scoped summarizer. NOT
  // added to extractExpertOpinions.ts's ANALYST_OPINION_SOURCES (extraction's
  // separate, narrower allowlist) — that pipeline is owned separately; these
  // domains being FINANCE-tagged doesn't make them extraction-eligible.
  "business-standard.com",
  "zeebiz.com",
  "financialexpress.com",
  "ndtvprofit.com",
] as const;

/** India-market keywords. Any match (case-insensitive) qualifies a story for FINANCE tagging. */
const INDIA_MARKET_KEYWORDS: string[] = [
  // Indices
  "Nifty",
  "Sensex",
  "Bank Nifty",
  "Nifty Bank",
  "Nifty IT",
  "Nifty Pharma",
  "Nifty Auto",
  "Nifty FMCG",
  "Nifty Midcap",
  "Nifty 50",
  // Regulators / exchanges
  "RBI",
  "SEBI",
  "BSE",
  "NSE",
  "Dalal Street",
  // Currency / macro
  "INR",
  "Indian rupee",
  "Budget India",
  "Union Budget",
  "GST",
  "FII",
  "DII",
  "FPI",
  // Top-30 Indian listed companies
  "Reliance Industries",
  "RIL",
  "TCS",
  "Tata Consultancy",
  "HDFC Bank",
  "Infosys",
  "Wipro",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra",
  "Bajaj Finance",
  "SBI",
  "State Bank of India",
  "Adani",
  "Hindustan Unilever",
  "HUL",
  "ITC",
  "Maruti Suzuki",
  "L&T",
  "Larsen & Toubro",
  "Sun Pharma",
  "Titan",
  "Asian Paints",
  "Zomato",
  "Swiggy",
  "Paytm",
  "Nykaa",
  "PolicyBazaar",
  "IndusInd Bank",
  "Yes Bank",
  "PNB",
];

// Pre-compile keyword patterns for performance (case-insensitive word-boundary-aware search)
// We use simple includes with case fold rather than RegExp word boundaries, because
// financial keywords like "RBI" or "SBI" may appear embedded in longer text without spaces.
const KEYWORD_PATTERNS = INDIA_MARKET_KEYWORDS.map((kw) => ({
  keyword: kw,
  pattern: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
}));

/**
 * Google-News-routed sources (gnews-business-standard, gnews-zeebiz,
 * gnews-financial-express in rssSources.ts, and the pre-existing
 * gnews-in-business/-sports/-entertainment) always store `source_url` as the
 * `news.google.com/rss/articles/...` redirect link, NEVER the resolved
 * publisher URL — decodeGoogleNewsSource() only splits the *title*, not the
 * link (see rssProvider.ts). A hostname check against FINANCE_SOURCE_DOMAINS
 * alone would therefore never match these, silently defeating the point of
 * adding them. Fall back to matching the decoded publisher DISPLAY NAME
 * (sourceName) against a small trusted-name allowlist for exactly this case —
 * same precedent as MarketMoveNews's TRUSTED_PUBLISHER_TIERS name-substring
 * matching in packages/business-rules/src/marketPulse/newsQuality.ts, applied
 * here to the separate Story/FINANCE-tagging pipeline. Substring match
 * (case-insensitive) because Google News decodes publisher names
 * inconsistently (observed: "Business Standard", "Zee Business",
 * "financialexpress.com" verbatim, "NDTV Profit").
 */
const GOOGLE_NEWS_TRUSTED_PUBLISHER_NAMES = [
  "business standard",
  "zee business",
  "financialexpress",
  "financial express",
  "ndtv profit",
] as const;

function isGoogleNewsRedirectUrl(hostname: string): boolean {
  return hostname === "news.google.com" || hostname.endsWith(".news.google.com");
}

/**
 * Returns true if the source URL belongs to an approved Indian finance
 * source, OR (for Google-News-routed items only) the decoded publisher
 * display name matches a trusted name — see doc comment above.
 */
function isIndianFinanceSource(sourceUrl: string, sourceName?: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (FINANCE_SOURCE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return true;
    }

    if (isGoogleNewsRedirectUrl(hostname) && sourceName) {
      const nameLower = sourceName.toLowerCase();
      return GOOGLE_NEWS_TRUSTED_PUBLISHER_NAMES.some((trusted) => nameLower.includes(trusted));
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Returns the matched keyword if the text contains an India-market keyword,
 * otherwise returns null.
 */
function findIndiaMarketKeyword(text: string): string | null {
  for (const { keyword, pattern } of KEYWORD_PATTERNS) {
    if (pattern.test(text)) {
      return keyword;
    }
  }
  return null;
}

export type FinanceTagDecision =
  | { isFinance: true; matchedKeyword: string }
  | { isFinance: false; reason: string };

/**
 * Determines whether a story should be tagged FINANCE.
 *
 * Logs the decision at debug level as required by the AC.
 *
 * @param title - Story headline
 * @param summary - Story summary / description
 * @param sourceUrl - Original article URL
 * @param sourceName - Decoded publisher display name (used as a fallback signal
 *   for Google-News-routed sources, whose sourceUrl is always a news.google.com
 *   redirect — see isIndianFinanceSource doc comment). Optional for backward
 *   compatibility with any other caller that doesn't have it handy.
 * @returns FinanceTagDecision with tagging outcome and matched keyword or reason
 */
export function evaluateFinanceTag(
  title: string,
  summary: string,
  sourceUrl: string,
  sourceName?: string
): FinanceTagDecision {
  if (!isIndianFinanceSource(sourceUrl, sourceName)) {
    return { isFinance: false, reason: "source not in approved Indian finance source list" };
  }

  const combinedText = `${title} ${summary}`;
  const keyword = findIndiaMarketKeyword(combinedText);

  if (keyword) {
    console.debug(`[Finance Tagger] Tagged FINANCE: "${title.slice(0, 80)}" — matched keyword: "${keyword}"`);
    return { isFinance: true, matchedKeyword: keyword };
  }

  console.debug(`[Finance Tagger] Not tagged FINANCE: "${title.slice(0, 80)}" — no India keywords found`);
  return { isFinance: false, reason: "no India market keywords found in title or summary" };
}
