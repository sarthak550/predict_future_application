/**
 * Selftest for resolveOpinionAttribution (lib/ai/extractExpertOpinions.ts) —
 * the blank-name guard added 2026-08-08 after a founder-reported prod bug: 7
 * legacy Expert rows were created with empty name strings (org present, e.g.
 * "Goldman Sachs India") because the old code fell back to
 * `opinion.expertName` (blank) as the display name whenever isSourceAttribution
 * wasn't explicitly true. Fixed on prod by converting those rows to FIRM rows
 * named by their org; this selftest locks in the two guarded branches so the
 * bug can't silently regress.
 *
 * Pure — no DB access — so it runs standalone. Usage (from apps/api):
 *   npx tsx scripts/selftest-opinion-attribution.ts
 */

import { resolveOpinionAttribution } from "../lib/ai/extractExpertOpinions";

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

console.log("Running selftest-opinion-attribution (resolveOpinionAttribution)...\n");

// ── Branch 1: blank name, organization present -> effective source
// attribution, "<Org> Analysis" display name, never a blank name. ───────────
{
  const result = resolveOpinionAttribution("", "Goldman Sachs India", false);
  assert("blank name + org, isSourceAttribution=false -> not rejected", result.reject === false);
  if (!result.reject) {
    assert(
      'blank name + org -> displayName "Goldman Sachs India Analysis"',
      result.displayName === "Goldman Sachs India Analysis"
    );
    assert("blank name + org -> isEffectivelySourceAttribution=true", result.isEffectivelySourceAttribution === true);
  }
}
{
  // Whitespace-only name counts as blank.
  const result = resolveOpinionAttribution("   ", "ETMarkets", undefined);
  assert("whitespace-only name + org -> not rejected", result.reject === false);
  if (!result.reject) {
    assert("whitespace-only name + org -> treated as source attribution", result.isEffectivelySourceAttribution === true);
    assert('whitespace-only name + org -> displayName "ETMarkets Analysis"', result.displayName === "ETMarkets Analysis");
  }
}

// ── Branch 2: both name and organization blank -> reject, count it, don't
// write. ─────────────────────────────────────────────────────────────────
assert("blank name + blank org -> rejected", resolveOpinionAttribution("", "", false).reject === true);
assert("whitespace-only name + whitespace-only org -> rejected", resolveOpinionAttribution("  ", "\t", false).reject === true);

// ── Untouched happy path: a normal named analyst call is unaffected. ────────
{
  const result = resolveOpinionAttribution("Rahul Shah", "Motilal Oswal Financial Services", false);
  assert("normal named analyst -> not rejected", result.reject === false);
  if (!result.reject) {
    assert("normal named analyst -> displayName is the analyst's own name", result.displayName === "Rahul Shah");
    assert("normal named analyst -> isEffectivelySourceAttribution=false", result.isEffectivelySourceAttribution === false);
  }
}

// ── Untouched happy path: an explicit, correctly-flagged source attribution
// with a real name present is unaffected (name is ignored in favor of org). ─
{
  const result = resolveOpinionAttribution("", "ETMarkets", true);
  assert("explicit source attribution -> not rejected", result.reject === false);
  if (!result.reject) {
    assert('explicit source attribution -> displayName "ETMarkets Analysis"', result.displayName === "ETMarkets Analysis");
    assert("explicit source attribution -> isEffectivelySourceAttribution=true", result.isEffectivelySourceAttribution === true);
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
