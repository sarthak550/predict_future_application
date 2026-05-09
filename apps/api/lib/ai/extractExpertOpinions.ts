/**
 * Finance AI extraction pipeline — expert opinion extraction from Indian finance news articles.
 *
 * Tries Groq first (faster/cheaper), falls back to Gemini if Groq is unavailable or rate-limited.
 * Mirrors the dual-provider pattern in gemini.ts (poll generation).
 */

import { OpinionDirection, type PrismaClient } from "@prisma/client";

/**
 * Path-based allowlist for analyst opinion extraction.
 * Only articles whose URL matches a domain + path prefix pair will trigger AI extraction.
 * This is stricter than the broad FINANCE domain tagging used in financeTagging.ts
 * (which still tags the full publisher as FINANCE for category filtering in the news feed).
 */
type AllowedSourcePath = { domain: string; pathPrefixes: string[] };

const ANALYST_OPINION_SOURCES: AllowedSourcePath[] = [
  // Curated expert opinion feeds (highest quality)
  {
    domain: "economictimes.indiatimes.com",
    pathPrefixes: ["/markets/expert-view", "/opinion/columns/"],
  },
  {
    domain: "cnbctv18.com",
    pathPrefixes: ["/views/", "/market/expert-views/"],
  },
  // Expert analyst feeds
  {
    domain: "livemint.com",
    pathPrefixes: ["/opinion/online-views/", "/opinion/", "/market/mark-to-market"],
  },
  {
    domain: "seekingalpha.com",
    pathPrefixes: ["/article/", "/instablog/"],
  },
  // Regional analysts and brokerage research syndicated on news sites
  { domain: "moneycontrol.com", pathPrefixes: ["/news/business/markets/expert-views/"] },
  { domain: "bqprime.com", pathPrefixes: ["/markets/", "/opinion/"] },
  { domain: "ndtvprofit.com", pathPrefixes: ["/markets/", "/opinion/"] },
];

export type RawExpertOpinion = {
  expertName: string;
  expertOrganization: string;
  paraphrasedQuote: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  /** When true, opinion is from trusted source but lacks named analyst attribution */
  isSourceAttribution?: boolean;
  /** Optional: model-provided reason for rejection, logged but never persisted. */
  rejectionReason?: string | null;
};

/**
 * Checks if a source URL matches the path-based analyst-opinion allowlist.
 *
 * Both domain AND path prefix must match. The broad FINANCE category tagging in
 * financeTagging.ts is intentionally kept separate — this check gates AI extraction only.
 */
export function isApprovedFinanceSource(sourceUrl: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname;

    for (const entry of ANALYST_OPINION_SOURCES) {
      const domainMatches = hostname === entry.domain || hostname.endsWith(`.${entry.domain}`);
      if (!domainMatches) continue;

      const pathMatches = entry.pathPrefixes.some((prefix) => pathname.startsWith(prefix));
      if (pathMatches) return true;
    }

    return false;
  } catch {
    return false;
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You are an Indian-equity-market research analyst extracting forward-looking market calls from financial commentary articles.

Extract quotes that meet the criteria below. Two extraction modes:

MODE 1: ANALYST-ATTRIBUTED (preferred, higher credibility)
Quotes from NAMED analysts, strategists, fund managers, or research heads (e.g., "Ridham Desai of Morgan Stanley").
Set "isSourceAttribution": false

MODE 2: SOURCE-ATTRIBUTED (when no named analyst available)
Market analysis/calls from the article's trusted publication itself (e.g., "Mint analysis suggests...", "Seeking Alpha sees...").
Use publication name for expertOrganization, leave expertName blank or use publication.
Set "isSourceAttribution": true

REJECTION CRITERIA (applies to both modes):
- CEO/CFO talking about own company strategy
- Regulator/government policy statements
- Anonymous/unattributed commentary
- Purely descriptive (no forward call or conviction)
- General mood observations without specific prediction

REQUIRED FOR BOTH MODES:
- Specific instrument (Nifty 50, Sensex, Bank Nifty, specific Indian stock, or sector)
- Direction with conviction (bullish/bearish/neutral)
- Rationale (reason supporting the call)
- Timeframe (rough: week, quarter, FY, "near term", etc.)

OUTPUT FORMAT (JSON array):
[{"expertName": "Name or blank", "expertOrganization": "Firm/Publication", "paraphrasedQuote": "≤220 chars with call+rationale+timeframe", "direction": "BULLISH|BEARISH|NEUTRAL", "confidence": 0.0-1.0, "isSourceAttribution": false or true, "rejectionReason": null}]

Return [] if no qualifying calls found. Do not invent quotes.

GOOD EXAMPLE:
"Ridham Desai of Morgan Stanley India sees Nifty 50 reaching 26,000 by FY26-end, citing stable FII flows and earnings growth above consensus."
→ {"expertName":"Ridham Desai","expertOrganization":"Morgan Stanley India","paraphrasedQuote":"Sees Nifty 50 reaching 26,000 by FY26-end on stable FII flows and earnings beats","direction":"BULLISH","confidence":0.9}

BAD EXAMPLE (must reject):
"Reliance CEO Mukesh Ambani said the company is investing ₹50,000 cr in retail expansion."
→ [] (CEO talking about own business strategy, not a market call)

BAD EXAMPLE (must reject):
"Sensex closed 200 points lower today as IT stocks weighed on the index."
→ [] (descriptive news, no named analyst, no forward call)`;

function buildExtractionPrompt(story: { title: string; content: string }): string {
  return `Article title: ${story.title}

Article content:
${story.content.slice(0, 4000)}

Extract India-market expert opinions following the rules above. Return JSON only.`;
}

function validateRawOpinions(raw: unknown): RawExpertOpinion[] {
  if (!Array.isArray(raw)) {
    throw new Error("Expected JSON array from AI provider, got non-array");
  }

  const valid: RawExpertOpinion[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;

    const expertName = typeof obj.expertName === "string" ? obj.expertName.trim() : "";
    const expertOrganization = typeof obj.expertOrganization === "string" ? obj.expertOrganization.trim() : "";
    const paraphrasedQuote = typeof obj.paraphrasedQuote === "string" ? obj.paraphrasedQuote.trim() : "";
    const directionRaw = typeof obj.direction === "string" ? obj.direction.toUpperCase() : "";
    const confidence = typeof obj.confidence === "number" ? Math.min(1, Math.max(0, obj.confidence)) : 0.5;
    const isSourceAttribution = typeof obj.isSourceAttribution === "boolean" ? obj.isSourceAttribution : false;
    const rejectionReason =
      typeof obj.rejectionReason === "string" ? obj.rejectionReason : null;

    // Must have organization (expert or source), and quote must exist
    if (!expertOrganization) continue;
    if (!paraphrasedQuote || paraphrasedQuote.length < 10) continue;
    if (!["BULLISH", "BEARISH", "NEUTRAL"].includes(directionRaw)) continue;
    if (paraphrasedQuote.length > 220) continue;

    // Confidence floor: reject any opinion below 0.75
    if (confidence < 0.75) {
      console.info(
        `[Finance AI] Rejected opinion for "${expertName || expertOrganization}" — confidence ${confidence.toFixed(2)} below floor 0.75`
      );
      continue;
    }

    valid.push({
      expertName,
      expertOrganization,
      paraphrasedQuote,
      direction: directionRaw as "BULLISH" | "BEARISH" | "NEUTRAL",
      confidence,
      isSourceAttribution,
      rejectionReason,
    });
  }

  return valid;
}

const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] as const;

async function callGroqForExtraction(
  apiKey: string,
  story: { title: string; content: string },
  modelIndex = 0
): Promise<RawExpertOpinion[]> {
  const model = GROQ_MODELS[modelIndex] ?? GROQ_MODELS[0];
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: buildExtractionPrompt(story) },
      ],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err: Error & { status?: number; retryAfterSeconds?: number } = new Error(
      `Groq extraction API returned ${response.status}: ${errorText.slice(0, 200)}`
    );
    err.status = response.status;
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      err.retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
    }
    throw err;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Groq extraction returned no content");
  }

  // Groq returns a JSON object when response_format is json_object — wrap key may be "opinions" or similar.
  // Try to parse as array first, otherwise unwrap the first array-valued field.
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null) {
    const arrayField = Object.values(parsed).find((v): v is unknown[] => Array.isArray(v));
    if (arrayField) parsed = arrayField;
  }
  return validateRawOpinions(parsed);
}

async function callGeminiForExtraction(
  apiKey: string,
  story: { title: string; content: string }
): Promise<RawExpertOpinion[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildExtractionPrompt(story)}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2, // Low temperature for extraction — accuracy over creativity
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini extraction API returned ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini extraction returned no content");
  }

  // Strip markdown fences if Gemini wraps the JSON despite responseMimeType
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;
  return validateRawOpinions(parsed);
}

// ─── Daily AI call cap (in-memory) ────────────────────────────────────────────
// NOTE: This counter resets on server restart. Use a Redis counter or DB record
// for production-grade enforcement across multiple instances or restarts.
let _dailyCallCount = 0;
let _dailyCallDate = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

function getDailyCallCap(): number {
  const raw = process.env.FINANCE_AI_DAILY_CAP;
  if (!raw) return 50;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

function checkAndIncrementDailyCap(storyId: string): boolean {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (_dailyCallDate !== todayUtc) {
    // UTC date has rolled over — reset counter
    _dailyCallCount = 0;
    _dailyCallDate = todayUtc;
  }
  const cap = getDailyCallCap();
  if (_dailyCallCount >= cap) {
    console.warn(
      `[extractExpertOpinions] Daily AI cap reached (${_dailyCallCount}/${cap}). Skipping extraction for story ${storyId}.`
    );
    return false;
  }
  _dailyCallCount++;
  return true;
}

/**
 * Extracts expert opinions from a finance news article using Groq (primary) or Gemini (fallback).
 *
 * IMPORTANT: This function does NOT check whether the source is approved —
 * callers must check with `isApprovedFinanceSource()` before calling this function
 * (enforced in the ingestion pipeline integration).
 *
 * @returns Array of raw opinion objects. Returns [] on any failure or when no qualifying opinions found.
 */
export async function extractExpertOpinionsFromStory(story: {
  id: string;
  title: string;
  content: string;
  sourceUrl: string;
  publishedAt: Date;
}): Promise<RawExpertOpinion[]> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!groqKey && !geminiKey) {
    console.warn("[Finance AI] No AI key set (GROQ_API_KEY or GEMINI_API_KEY) — skipping extraction");
    return [];
  }

  // Enforce daily call cap before making any AI request
  if (!checkAndIncrementDailyCap(story.id)) {
    return [];
  }

  const input = { title: story.title, content: story.content };
  const titleSlice = story.title.slice(0, 60);

  // Try Groq first (faster, cheaper)
  if (groqKey) {
    for (let i = 0; i < GROQ_MODELS.length; i++) {
      try {
        const opinions = await callGroqForExtraction(groqKey, input, i);
        if (opinions.length === 0) {
          console.info(
            `[Finance AI] No opinions extracted from "${titleSlice}" via Groq ${GROQ_MODELS[i]} — possible reasons: no named analyst, no forward call, or below confidence floor`
          );
        } else {
          console.info(
            `[Finance AI] Extracted ${opinions.length} opinion(s) via Groq ${GROQ_MODELS[i]} from "${titleSlice}..."`
          );
        }
        return opinions;
      } catch (err) {
        const e = err as Error & { status?: number };
        const msg = e.message || String(err);
        if (e.status === 429) {
          console.warn(`[Finance AI] Groq ${GROQ_MODELS[i]} rate limited, trying next model/provider...`);
          continue;
        }
        console.warn(`[Finance AI] Groq ${GROQ_MODELS[i]} failed: ${msg.slice(0, 200)}`);
        // Try next Groq model on parse / 5xx errors too
      }
    }
  }

  // Fall back to Gemini
  if (geminiKey) {
    try {
      const opinions = await callGeminiForExtraction(geminiKey, input);
      if (opinions.length === 0) {
        console.info(
          `[Finance AI] No opinions extracted from "${titleSlice}" via Gemini — possible reasons: no named analyst, no forward call, or below confidence floor`
        );
      } else {
        console.info(
          `[Finance AI] Extracted ${opinions.length} opinion(s) via Gemini from "${titleSlice}..."`
        );
      }
      return opinions;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Finance AI] Gemini fallback also failed for story ${story.id}: ${msg}`);
    }
  }

  return [];
}

/**
 * Persists extracted expert opinions to the database.
 * Auto-creates Expert rows for new attributions (verified=false).
 * Never throws — logs errors and continues.
 */
export async function persistExpertOpinions(
  prisma: PrismaClient,
  storyId: string,
  sourceUrl: string,
  publishedAt: Date,
  opinions: RawExpertOpinion[]
): Promise<void> {
  for (const opinion of opinions) {
    try {
      // For source attributions, use publication as name; for analyst attributions, use analyst name
      const displayName = opinion.isSourceAttribution
        ? `${opinion.expertOrganization} Analysis`
        : opinion.expertName;

      // Upsert expert: if (name, organization) pair doesn't exist, create with appropriate verified flag
      const expert = await prisma.expert.upsert({
        where: {
          name_organization: {
            name: displayName,
            organization: opinion.expertOrganization,
          },
        },
        update: {}, // Don't overwrite verified=true experts
        create: {
          name: displayName,
          organization: opinion.expertOrganization,
          // Source attributions are pre-verified (trusted publications), named analysts are not
          verified: opinion.isSourceAttribution,
        },
      });

      // Skip if this expert already has an opinion on this story (prevents duplicates on re-ingestion)
      const existing = await prisma.expertOpinion.findFirst({
        where: { expertId: expert.id, storyId },
        select: { id: true },
      });
      if (existing) {
        console.debug(`[Finance AI] Skipping duplicate opinion for "${displayName}" on story ${storyId}`);
        continue;
      }

      await prisma.expertOpinion.create({
        data: {
          expertId: expert.id,
          storyId,
          quote: opinion.paraphrasedQuote,
          direction: opinion.direction as OpinionDirection,
          sourceUrl,
          publishedAt,
          resolutionStatus: "PENDING",
          isSourceAttribution: opinion.isSourceAttribution ?? false,
        },
      });

      const typeLabel = opinion.isSourceAttribution ? "Market Analysis from" : "Expert Opinion by";
      console.info(
        `[Finance AI] Persisted ${typeLabel} "${displayName}" — ${opinion.direction}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[Finance AI] Failed to persist opinion for "${opinion.expertName || opinion.expertOrganization}": ${msg}`
      );
      // Continue to next opinion — don't block the batch
    }
  }
}
