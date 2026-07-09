import type { MarketMoveEventType } from "@prisma/client";

/**
 * Classifies a raw NSE/BSE announcement category/subject into our
 * MarketMoveEventType enum via keyword matching. Shared by both fetchers so
 * NSE and BSE announcements land in the same buckets even though the two
 * exchanges use completely different category vocabularies:
 *   - BSE: `CATEGORYNAME` (e.g. "Board Meeting", "Result") + `SUBCATNAME`
 *     (e.g. "Outcome of Board Meeting", "Acquisition", "Credit Rating").
 *   - NSE: a single free-text `desc` field (e.g. "Award of Order",
 *     "Financial Results", "Change in Directorate").
 *
 * Order matters — more specific keywords are checked before generic ones so
 * e.g. "Credit Rating" doesn't fall through to OTHER_MATERIAL just because
 * it also contains no "board"/"result" keyword.
 */
export function classifyMarketMoveEventType(...textParts: (string | null | undefined)[]): MarketMoveEventType {
  const text = textParts.filter(Boolean).join(" ").toLowerCase();

  if (
    text.includes("board meeting") ||
    text.includes("outcome of board")
  ) {
    return "BOARD_MEETING";
  }

  if (
    text.includes("financial result") ||
    text.includes("quarterly result") ||
    text.includes("annual result") ||
    (text.includes("result") && !text.includes("election result"))
  ) {
    return "RESULTS";
  }

  if (
    text.includes("acquisition") ||
    text.includes("merger") ||
    text.includes("amalgamation") ||
    text.includes("demerger") ||
    text.includes("diversification") ||
    text.includes("disinvestment") ||
    text.includes("scheme of arrangement")
  ) {
    return "MERGER_ACQUISITION";
  }

  if (
    text.includes("credit rating") ||
    text.includes("rating action") ||
    text.includes("rating revis") ||
    text.includes("rating reaffirm") ||
    text.includes("rating downgrad") ||
    text.includes("rating upgrad")
  ) {
    return "RATING_CHANGE";
  }

  return "OTHER_MATERIAL";
}

/** Known NSE/BSE index identifiers — used to tag INDEX-type tickers vs. STOCK. */
const KNOWN_INDEX_SYMBOLS = new Set([
  "NIFTY",
  "NIFTY 50",
  "NIFTY50",
  "NIFTY BANK",
  "BANKNIFTY",
  "BANK NIFTY",
  "NIFTY 200",
  "NIFTY 500",
  "NIFTY IT",
  "NIFTY FIN SERVICE",
  "NIFTY MIDCAP 100",
  "NIFTY NEXT 50",
  "SENSEX",
  "S&P BSE SENSEX",
  "BSE 100",
  "BSE 500",
]);

/** True if `symbol` looks like an index identifier rather than a single-stock ticker. */
export function isIndexSymbol(symbol: string): boolean {
  return KNOWN_INDEX_SYMBOLS.has(symbol.trim().toUpperCase());
}
