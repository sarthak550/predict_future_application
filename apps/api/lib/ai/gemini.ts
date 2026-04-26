export type PollResult = {
  skip?: boolean;
  enhancedSummary?: string;
  marketType: "BINARY" | "NUMERIC";
  title: string;
  description: string;
  category: string;
  expiresInHours: number;
  // Numeric-only fields
  unit?: string;
  minValue?: number;
  maxValue?: number;
  precision?: number;
};

export type NewsStoryInput = {
  headline: string;
  summary: string;
  category: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

const SYSTEM_PROMPT = `You analyze news stories and decide whether a good opinion poll question can be created from them.

## STEP 1 — Decide if a poll is possible

NOT every news story lends itself to a poll. SKIP the poll if:
- The story is a recap or retrospective with no future-facing angle (e.g. "Team X won yesterday")
- The outcome is already known or resolved
- There is no clear question that would be interesting for people to share their opinion on
- The story is purely informational with no debatable angle
- Creating a question would be forced, vague, or nonsensical

If you decide to SKIP, return:
{
  "skip": true,
  "enhancedSummary": "A well-written 3-5 sentence summary..."
}

Rules for enhancedSummary:
- DO NOT copy or paraphrase the original summary/headline — rewrite it from scratch
- The summary should give the reader COMPLETE CONTEXT — they should understand the full story just from reading it
- Cover the key facts: who, what, when, where, and why it matters
- Add background context: what led to this, why it's significant, what might happen next
- Write in a clear, engaging, informative tone
- MUST be 60-80 words
- Must be at least 300 characters long

## STEP 2 — If a good poll IS possible, create one

There are exactly TWO types:

### TYPE 1 — BINARY (Yes / No)
The title MUST be answerable with only "Yes" or "No". Users vote on what they think will happen.
- Always start with "Will…" or "Do you think…" or "Should…" or "Is…"
- Always include a specific timeframe when relevant
- This is an OPINION POLL — people share what they believe, nothing is at stake

Good BINARY examples:
  "Will Tesla stock close above $300 by June 30?"
  "Do you think Arsenal will win the Premier League this season?"
  "Will OpenAI release GPT-5 before July 2026?"

### TYPE 2 — NUMERIC (Guess the Number)
The title asks users to guess a specific number. The crowd average is shown.
- Start with "How many…", "What will… be?", "How much…"
- Must include: unit, minValue, maxValue, precision
- The range (min–max) should be realistic but wide enough

Good NUMERIC examples:
  "How many points will LeBron score in tonight's game?" (unit: "points", min: 0, max: 60)
  "What will be the opening weekend box office in millions?" (unit: "million USD", min: 10, max: 300)

### Choosing the type
- If the story mentions specific stats, scores, counts, prices → use NUMERIC
- If the story is about whether something will or won't happen → use BINARY
- Aim for roughly 50/50 split between types

### Rules for polls
- The question MUST directly relate to the news story
- Title: 12–160 characters, must be a clear question
- Description: 24–2000 characters, explain context
- Do NOT create questions about death, violence, crime, disasters, or private lives
- Keep questions fun, engaging, and about outcomes people enjoy giving opinions on
- expiresInHours: 6–168 (when the poll closes)

For polls, respond with:
{
  "skip": false,
  "marketType": "BINARY" or "NUMERIC",
  "title": "string",
  "description": "string",
  "category": "SPORTS" | "BUSINESS" | "TECH" | "GENERAL" | "ENTERTAINMENT",
  "expiresInHours": number,
  "unit": "string (NUMERIC only)",
  "minValue": number (NUMERIC only),
  "maxValue": number (NUMERIC only),
  "precision": number 0-6 (NUMERIC only)
}

Respond with ONLY valid JSON.`;

function buildUserPrompt(story: NewsStoryInput): string {
  return `Analyze this news story and decide if a good opinion poll can be made from it:

**Headline:** ${story.headline}
**Summary:** ${story.summary}
**Category:** ${story.category}
**Source:** ${story.sourceName}
**Published:** ${story.publishedAt}

IMPORTANT:
- First decide: does this story have a clear, debatable FUTURE outcome people would want to weigh in on? If not, set "skip": true and write an enhancedSummary.
- If the event already happened and there's no forward angle → SKIP it.
- Only create a poll if there's a genuinely interesting question that relates directly to the story.
- If you SKIP: the enhancedSummary MUST be original — do NOT copy the summary above.
- If creating a poll:
  - NUMERIC for scores, stats, prices, counts ("How many…", "What will…be?")
  - BINARY for whether something will or won't happen ("Will…?", "Do you think…?")`;
}

const NUMERIC_TITLE_PATTERNS = /^(how many|how much|what will|what percentage|what is the|what are the|how long|how far|how high|how low|what percent)/i;
const BINARY_TITLE_PATTERNS = /^(will|is|are|does|has|can|do|did|should|could|would)/i;

function isTooSimilar(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.length > 0 && nb.length > 0) {
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length < nb.length ? nb : na;
    if (longer.includes(shorter) && shorter.length / longer.length > 0.6) return true;
  }
  return false;
}

function validateAndNormalize(parsed: PollResult, originalSummary?: string): PollResult {
  if (parsed.skip) {
    const wordCount = (parsed.enhancedSummary ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (!parsed.enhancedSummary || wordCount < 30) {
      throw new Error(`AI skipped but returned too short a summary (${wordCount} words, need 30+).`);
    }
    if (originalSummary && isTooSimilar(parsed.enhancedSummary, originalSummary)) {
      throw new Error("AI returned a summary too similar to the original.");
    }
    return { skip: true, enhancedSummary: parsed.enhancedSummary } as PollResult;
  }

  if (!parsed.title || parsed.title.length < 12 || parsed.title.length > 160) {
    throw new Error("AI returned an invalid title length.");
  }
  if (!parsed.description || parsed.description.length < 24) {
    throw new Error("AI returned an invalid description.");
  }
  if (!parsed.expiresInHours || parsed.expiresInHours < 2) {
    parsed.expiresInHours = 24;
  }

  // Auto-correct type mismatches
  const titleLooksNumeric = NUMERIC_TITLE_PATTERNS.test(parsed.title);
  const titleLooksBinary = BINARY_TITLE_PATTERNS.test(parsed.title);

  if (parsed.marketType === "BINARY" && titleLooksNumeric && !titleLooksBinary) {
    parsed.marketType = "NUMERIC";
  } else if (parsed.marketType === "NUMERIC" && titleLooksBinary && !titleLooksNumeric) {
    parsed.marketType = "BINARY";
  }

  if (parsed.marketType === "NUMERIC") {
    if (!parsed.unit) parsed.unit = "value";
    if (parsed.minValue === undefined) parsed.minValue = 0;
    if (parsed.maxValue === undefined) parsed.maxValue = 100;
    if (parsed.minValue >= parsed.maxValue) parsed.maxValue = parsed.minValue + 100;
    if (parsed.precision === undefined) parsed.precision = 0;
  }

  return parsed;
}

// ---- Groq (primary) ----

const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] as const;

async function callGroq(apiKey: string, story: NewsStoryInput, modelIndex = 0): Promise<PollResult> {
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
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(story) },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Groq API error:", response.status, errorText);
    if (response.status === 429) {
      throw new Error("Rate limit reached. Please wait a moment and try again.");
    }
    throw new Error(`Groq API returned ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("Groq returned no content.");
  }

  return validateAndNormalize(JSON.parse(text) as PollResult, story.summary);
}

// ---- Gemini (fallback) ----

async function callGemini(apiKey: string, story: NewsStoryInput): Promise<PollResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(story)}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", response.status, errorText);
    throw new Error(`Gemini API returned ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini returned no content.");
  }

  return validateAndNormalize(JSON.parse(text) as PollResult, story.summary);
}

// ---- Public entry point: Groq first, Gemini fallback ----

async function callGeminiWithRetry(apiKey: string, story: NewsStoryInput, maxRetries = 2): Promise<PollResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callGemini(apiKey, story);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") && attempt < maxRetries) {
        const delay = (attempt + 1) * 30_000;
        console.warn(`[ai] Gemini rate limited, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Gemini max retries exhausted");
}

export async function generatePollWithAI(story: NewsStoryInput): Promise<PollResult> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!groqKey && !geminiKey) {
    throw new Error("No AI API key configured. Set GROQ_API_KEY or GEMINI_API_KEY.");
  }

  if (groqKey) {
    for (let i = 0; i < GROQ_MODELS.length; i++) {
      try {
        return await callGroq(groqKey, story, i);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Rate limit") || msg.includes("429")) {
          console.warn(`[ai] Groq ${GROQ_MODELS[i]} rate limited, trying next model...`);
          continue;
        }
        console.warn(`Groq ${GROQ_MODELS[i]} failed:`, msg);
        if (i === GROQ_MODELS.length - 1 && !geminiKey) throw err;
      }
    }
    if (!geminiKey) {
      throw new Error("All Groq models rate limited and no Gemini key configured.");
    }
    console.warn("[ai] All Groq models failed, falling back to Gemini");
  }

  return callGeminiWithRetry(geminiKey!, story);
}
