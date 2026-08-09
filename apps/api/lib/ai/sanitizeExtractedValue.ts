/**
 * Guards against AI-returned junk sentinel strings landing in the DB as if
 * they were real data. Mirrors the blank-Expert-name guard pattern (see
 * lib/finance/expertMatch.ts's hard guard + extractExpertOpinions.ts's
 * resolveOpinionAttribution, 2026-08-08) but for instrument/instrumentTicker
 * fields specifically — those are legitimately nullable (many real opinions,
 * e.g. sector/macro calls, have no resolvable ticker), so the correct fix
 * here is "convert junk to a real null," not "reject the whole opinion."
 *
 * Root cause (founder-reported prod bug, 2026-08-09): ExpertOpinion
 * cmslr480k04z5izt6xch4gi0b (the "International Gemmological Institute"
 * quote) had instrument AND instrumentTicker set to the LITERAL STRING
 * "null" (not a real SQL NULL) — with a junk InstrumentAlias rawName="NULL"
 * row created alongside it. Traced to lib/ai/extractInstrument.ts's
 * callGroqForInstrument: its system prompt tells Groq to "Return null (the
 * literal string 'null')" when it isn't confident, but the request also
 * forces `response_format: {type: "json_object"}` — a bare JSON `null` is
 * not a valid object, so the model satisfies both constraints by emitting
 * `{"instrument":"null","ticker":"null"}`. The existing sentinel check
 * (`val === "null"`) only fired in the code path that unwraps a NESTED
 * object; the direct `{instrument, ticker}` shape skipped it entirely, so
 * the literal string sailed past `if (!instrument || !ticker)` (a non-empty
 * string is truthy) straight into persistence.
 *
 * Apply this at every boundary where an AI-sourced instrument/ticker string
 * is about to be trusted as real data — see call sites in
 * extractInstrument.ts, extractExpertOpinions.ts, and instrumentAlias.ts.
 */
const JUNK_SENTINELS = new Set(["null", "none", "n/a", "undefined"]);

/**
 * Returns the trimmed value, or `null` when the value is empty/whitespace-
 * only, or case-insensitively matches a known AI junk-sentinel string
 * ("null", "NULL", "None", "N/A", "undefined"). Safe to call on any
 * AI-returned free-text field before it reaches persistence or is used as a
 * lookup key.
 */
export function sanitizeExtractedValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (JUNK_SENTINELS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}
