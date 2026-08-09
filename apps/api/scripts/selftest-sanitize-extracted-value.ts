/**
 * Selftest for sanitizeExtractedValue (lib/ai/sanitizeExtractedValue.ts) —
 * the AI-junk-sentinel guard added 2026-08-09 after a founder-reported prod
 * bug: ExpertOpinion cmslr480k04z5izt6xch4gi0b (the "International
 * Gemmological Institute" quote) had instrument AND instrumentTicker set to
 * the LITERAL STRING "null", plus a junk InstrumentAlias rawName="NULL" row.
 *
 * Root cause: lib/ai/extractInstrument.ts's callGroqForInstrument is forced
 * into response_format {type:"json_object"} while its prompt tells the model
 * to return the literal string "null" when unconfident (a bare JSON `null`
 * isn't a valid object) — so the model emitted
 * {"instrument":"null","ticker":"null"}, and the code's only sentinel check
 * lived in a branch (nested-object unwrap) that direct-shape responses never
 * reached. This selftest locks in the fix at the pure function level; see
 * also the regression case at the bottom which replays the exact prod shape.
 *
 * Pure — no DB access — so it runs standalone. Usage (from apps/api):
 *   npx tsx scripts/selftest-sanitize-extracted-value.ts
 */

import { sanitizeExtractedValue } from "../lib/ai/sanitizeExtractedValue";

let pass = 0;
let fail = 0;
const assert = (label: string, cond: boolean) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
};

console.log("Running selftest-sanitize-extracted-value (sanitizeExtractedValue)...\n");

// ── Junk sentinels, exact case ──────────────────────────────────────────────
assert('"null" -> null', sanitizeExtractedValue("null") === null);
assert('"NULL" -> null', sanitizeExtractedValue("NULL") === null);
assert('"None" -> null', sanitizeExtractedValue("None") === null);
assert('"N/A" -> null', sanitizeExtractedValue("N/A") === null);
assert('"undefined" -> null', sanitizeExtractedValue("undefined") === null);

// ── Junk sentinels, mixed/odd case — case-insensitive match required ───────
assert('"Null" -> null', sanitizeExtractedValue("Null") === null);
assert('"nUlL" -> null', sanitizeExtractedValue("nUlL") === null);
assert('"n/a" -> null', sanitizeExtractedValue("n/a") === null);
assert('"UNDEFINED" -> null', sanitizeExtractedValue("UNDEFINED") === null);

// ── Junk sentinels with surrounding whitespace ──────────────────────────────
assert('"  null  " -> null', sanitizeExtractedValue("  null  ") === null);
assert('"\\tNone\\n" -> null', sanitizeExtractedValue("\tNone\n") === null);

// ── Empty / whitespace-only / nullish inputs ────────────────────────────────
assert('"" -> null', sanitizeExtractedValue("") === null);
assert('"   " -> null', sanitizeExtractedValue("   ") === null);
assert("null input -> null", sanitizeExtractedValue(null) === null);
assert("undefined input -> null", sanitizeExtractedValue(undefined) === null);

// ── Legitimate values pass through untouched (trimmed) ──────────────────────
assert('"HDFCBANK.NS" -> unchanged', sanitizeExtractedValue("HDFCBANK.NS") === "HDFCBANK.NS");
assert('"  IGIL.NS  " -> trimmed', sanitizeExtractedValue("  IGIL.NS  ") === "IGIL.NS");
assert(
  '"International Gemological Institute" -> unchanged',
  sanitizeExtractedValue("International Gemological Institute") === "International Gemological Institute"
);
// A value that merely CONTAINS a junk word is NOT junk — only an exact
// (post-trim, case-insensitive) match should be stripped.
assert('"Nullify Corp" is NOT junk -> unchanged', sanitizeExtractedValue("Nullify Corp") === "Nullify Corp");
assert('"Nifty 50" is NOT junk -> unchanged', sanitizeExtractedValue("Nifty 50") === "Nifty 50");

// ── Regression: the exact prod shape (both fields junk) ─────────────────────
{
  // Replays what callGroqForInstrument's `candidate` looked like for the IGI
  // story before the fix: a direct-shape JSON object with literal "null"
  // strings that used to sail past `if (!instrument || !ticker)` because a
  // non-empty string is truthy.
  const candidate = { instrument: "null", ticker: "null" };
  const instrument = sanitizeExtractedValue(candidate.instrument);
  const ticker = sanitizeExtractedValue(candidate.ticker);
  assert("prod regression: candidate.instrument sanitizes to null", instrument === null);
  assert("prod regression: candidate.ticker sanitizes to null", ticker === null);
  assert("prod regression: !instrument now correctly short-circuits", !instrument && !ticker);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
