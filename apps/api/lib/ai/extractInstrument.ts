/**
 * Instrument extraction from analyst quotes using keyword map first, Groq AI fallback.
 *
 * Used by the auto-resolution pipeline to identify the primary tradeable Indian financial
 * instrument referenced in an expert opinion so we can look up its price history.
 *
 * Strategy:
 * 1. Check a hardcoded ticker map first (case-insensitive substring match on quote + headline)
 *    — this is fast, free, and covers the vast majority of Indian market instruments.
 * 2. If the map misses, call Groq (llama-3.3-70b-versatile) for AI extraction.
 * 3. Return null when no confident instrument can be identified.
 */

export type InstrumentResult = {
  instrument: string;
  ticker: string;
};

/**
 * Hardcoded map of common Indian financial instrument keywords to their
 * human-readable name and Yahoo Finance ticker symbol.
 *
 * Keys are lowercase and matched via case-insensitive substring search against
 * the combined quote + headline text. Longer/more-specific keys take priority
 * by being listed first where there could be ambiguity.
 */
const TICKER_MAP: Record<string, InstrumentResult> = {
  // Indices — checked before individual stocks to prefer broader instrument
  "nifty 50": { instrument: "Nifty 50", ticker: "^NSEI" },
  "nifty50": { instrument: "Nifty 50", ticker: "^NSEI" },
  "bank nifty": { instrument: "Bank Nifty", ticker: "^NSEBANK" },
  "banknifty": { instrument: "Bank Nifty", ticker: "^NSEBANK" },
  "sensex": { instrument: "Sensex", ticker: "^BSESN" },
  "midcap": { instrument: "Nifty Midcap 50", ticker: "^NSEMDCP50" },
  "nifty": { instrument: "Nifty 50", ticker: "^NSEI" },
  // Commodities
  "gold": { instrument: "Gold", ticker: "GC=F" },
  "crude": { instrument: "Crude Oil", ticker: "CL=F" },
  // Indian stocks — more specific names first to avoid partial collisions
  "hdfc bank": { instrument: "HDFC Bank", ticker: "HDFCBANK.NS" },
  "bajaj finance": { instrument: "Bajaj Finance", ticker: "BAJFINANCE.NS" },
  "icici bank": { instrument: "ICICI Bank", ticker: "ICICIBANK.NS" },
  "axis bank": { instrument: "Axis Bank", ticker: "AXISBANK.NS" },
  "kotak mahindra": { instrument: "Kotak Mahindra Bank", ticker: "KOTAKBANK.NS" },
  "kotak bank": { instrument: "Kotak Mahindra Bank", ticker: "KOTAKBANK.NS" },
  "kotak": { instrument: "Kotak Mahindra Bank", ticker: "KOTAKBANK.NS" },
  "tata motors": { instrument: "Tata Motors", ticker: "TATAMOTORS.NS" },
  "tata steel": { instrument: "Tata Steel", ticker: "TATASTEEL.NS" },
  "tatasteel": { instrument: "Tata Steel", ticker: "TATASTEEL.NS" },
  "bharti airtel": { instrument: "Bharti Airtel", ticker: "BHARTIARTL.NS" },
  "asian paints": { instrument: "Asian Paints", ticker: "ASIANPAINT.NS" },
  "maruti suzuki": { instrument: "Maruti Suzuki", ticker: "MARUTI.NS" },
  "maruti": { instrument: "Maruti Suzuki", ticker: "MARUTI.NS" },
  "reliance industries": { instrument: "Reliance Industries", ticker: "RELIANCE.NS" },
  "reliance": { instrument: "Reliance Industries", ticker: "RELIANCE.NS" },
  "infosys": { instrument: "Infosys", ticker: "INFY.NS" },
  "wipro": { instrument: "Wipro", ticker: "WIPRO.NS" },
  "l&t": { instrument: "L&T", ticker: "LT.NS" },
  " lt ": { instrument: "L&T", ticker: "LT.NS" },
  "itc": { instrument: "ITC", ticker: "ITC.NS" },
  "sbin": { instrument: "SBI", ticker: "SBIN.NS" },
  " sbi ": { instrument: "SBI", ticker: "SBIN.NS" },
  "tcs": { instrument: "TCS", ticker: "TCS.NS" },
};

/**
 * Checks the hardcoded ticker map against the combined text.
 * Returns the first match found (keys are ordered longest/most-specific first where relevant).
 */
function checkTickerMap(combinedText: string): InstrumentResult | null {
  const lower = combinedText.toLowerCase();

  for (const [key, result] of Object.entries(TICKER_MAP)) {
    if (lower.includes(key)) {
      return result;
    }
  }

  return null;
}

const INSTRUMENT_EXTRACTION_SYSTEM = `You are a financial data extraction assistant. Your job is to identify the PRIMARY Indian financial instrument that an analyst is making a directional call about.

Rules:
- Return JSON: {"instrument": "human-readable name", "ticker": "Yahoo Finance ticker"}
- ONLY return a result if you are highly confident (90%+) of both the instrument and its ticker
- Prefer index tickers (Nifty 50, Sensex, Bank Nifty) over individual stocks when both are mentioned
- Return null (the literal string "null") if:
  - The quote is about macroeconomics without a specific tradeable instrument (e.g., "Indian economy will grow")
  - The instrument is non-Indian or not listed on NSE/BSE
  - You cannot identify the instrument with high confidence

Ticker format rules:
- NSE stocks: "SYMBOL.NS" (e.g., "HDFCBANK.NS", "RELIANCE.NS")
- BSE index: "^BSESN"
- NSE index: "^NSEI"
- Bank Nifty: "^NSEBANK"
- Commodities: "GC=F" (gold), "CL=F" (crude oil)

Return ONLY valid JSON: {"instrument": "...", "ticker": "..."} or null`;

/**
 * Calls Groq to extract the primary instrument from a quote and headline.
 * Returns null if Groq is unavailable, returns null response, or confidence is low.
 */
async function callGroqForInstrument(
  apiKey: string,
  quote: string,
  headline: string
): Promise<InstrumentResult | null> {
  const userMessage = `Analyst quote: "${quote}"\nArticle headline: "${headline}"\n\nIdentify the primary Indian financial instrument. Return JSON or null.`;

  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: INSTRUMENT_EXTRACTION_SYSTEM },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 100,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    console.warn(`[extractInstrument] Groq network error: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!response.ok) {
    console.warn(`[extractInstrument] Groq returned ${response.status}`);
    return null;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  const dataObj = data as Record<string, unknown>;
  const choices = dataObj?.choices as Record<string, unknown>[] | undefined;
  const firstChoice = choices?.[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const text = message?.content as string | undefined;
  if (!text) return null;

  const cleaned = text.trim();

  // Handle explicit null responses
  if (cleaned === "null" || cleaned.toLowerCase() === '"null"') return null;

  try {
    const parsed = JSON.parse(cleaned) as unknown;

    // Handle cases where AI wraps in an extra object
    let candidate: Record<string, unknown> | null = null;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      // Direct shape: { instrument, ticker }
      if (typeof obj.instrument === "string" && typeof obj.ticker === "string") {
        candidate = obj;
      } else {
        // Unwrap first nested object value
        for (const val of Object.values(obj)) {
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            const inner = val as Record<string, unknown>;
            if (typeof inner.instrument === "string" && typeof inner.ticker === "string") {
              candidate = inner;
              break;
            }
          }
          // Handle cases where AI returns null-ish string
          if (val === null || val === "null") return null;
        }
      }
    }

    if (!candidate) return null;

    const instrument = (candidate.instrument as string).trim();
    const ticker = (candidate.ticker as string).trim();

    if (!instrument || !ticker) return null;

    return { instrument, ticker };
  } catch {
    return null;
  }
}

/**
 * Extracts the primary Indian financial instrument from an analyst quote and article headline.
 *
 * Check order:
 * 1. Hardcoded ticker map (free, instant, covers ~80% of cases)
 * 2. Groq AI extraction (fallback, requires GROQ_API_KEY env var)
 *
 * Returns null if no confident instrument can be identified.
 *
 * @example
 *   const result = await extractInstrumentFromQuote(
 *     "Nifty is likely to test 25,000 near term on strong FII flows",
 *     "Nifty outlook: analysts bullish for Q2"
 *   );
 *   // result → { instrument: "Nifty 50", ticker: "^NSEI" }
 */
export async function extractInstrumentFromQuote(
  quote: string,
  headline: string
): Promise<InstrumentResult | null> {
  const combinedText = `${headline} ${quote}`;

  // Fast path: check hardcoded map first
  const mapResult = checkTickerMap(combinedText);
  if (mapResult) {
    return mapResult;
  }

  // Slow path: AI extraction
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.warn("[extractInstrument] GROQ_API_KEY not set — skipping AI instrument extraction");
    return null;
  }

  return callGroqForInstrument(groqKey, quote, headline);
}
