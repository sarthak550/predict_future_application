/**
 * Selftest for collapseGroup (lib/ai/extractExpertOpinions.ts) — sentiment
 * bias fix mechanism 2, 2026-08-16.
 *
 * Locks in the behavior change: the old rule let ANY presence of BULLISH
 * (even 1-vs-many against NEUTRAL) win outright over NEUTRAL — symmetric in
 * code between BULLISH/BEARISH, but bullish-amplifying in practice because
 * real analyst commentary hedges positive more often than negative. The new
 * rule is a strict count-based majority, with a genuine tie between a
 * directional stance and NEUTRAL resolving to NEUTRAL (not to conviction).
 * BULLISH+BEARISH-present-together still drops the whole group, unchanged.
 *
 * Pure — no DB access — so it runs standalone. Usage (from apps/api):
 *   npx tsx scripts/selftest-collapse-group.ts
 */

import { collapseGroup, type EnrichedRawOpinion } from "../lib/ai/extractExpertOpinions";

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

console.log("Running selftest-collapse-group (collapseGroup)...\n");

function op(direction: "BULLISH" | "BEARISH" | "NEUTRAL", overrides: Partial<EnrichedRawOpinion> = {}): EnrichedRawOpinion {
  return {
    expertName: "Test Analyst",
    expertOrganization: "Test Securities",
    paraphrasedQuote: `A ${direction.toLowerCase()} quote long enough to pass the 80-char floor for validation purposes in this test fixture.`,
    direction,
    confidence: 0.85,
    isSourceAttribution: false,
    analystCallAt: null,
    rejectionReason: null,
    instrumentType: "STOCK",
    instrumentLabel: "Test Corp",
    resolvedInstrument: "Test Corp",
    resolvedTicker: "TESTCORP.NS",
    ...overrides,
  };
}

// ── 1 opinion -> keep as-is (unchanged). ────────────────────────────────────
{
  const group = [op("NEUTRAL")];
  const result = collapseGroup(group);
  assert("single-opinion group -> returned unchanged", result.length === 1 && result[0] === group[0]);
}

// ── BULLISH + BEARISH present (with or without NEUTRAL) -> drop ALL, UNCHANGED. ─
{
  const result = collapseGroup([op("BULLISH"), op("BEARISH")]);
  assert("BULLISH+BEARISH -> drops all (2 rows)", result.length === 0);
}
{
  const result = collapseGroup([op("BULLISH"), op("BEARISH"), op("NEUTRAL")]);
  assert("BULLISH+BEARISH+NEUTRAL -> drops all (3 rows)", result.length === 0);
}

// ── THE ACTUAL BEHAVIOR CHANGE, per T2 acceptance criteria. ─────────────────
{
  // 2x BULLISH / 1x NEUTRAL -> still resolves BULLISH (majority by count).
  const result = collapseGroup([op("BULLISH"), op("BULLISH"), op("NEUTRAL")]);
  assert(
    "2x BULLISH / 1x NEUTRAL -> BULLISH wins (strict majority)",
    result.length === 1 && result[0]!.direction === "BULLISH"
  );
}
{
  // 1x BULLISH / 1x NEUTRAL -> now resolves NEUTRAL (was BULLISH under the old
  // "any presence of BULLISH wins outright" rule). This is the bug this
  // sprint fixes.
  const result = collapseGroup([op("BULLISH"), op("NEUTRAL")]);
  assert(
    "1x BULLISH / 1x NEUTRAL -> NEUTRAL wins (tie goes to NEUTRAL, was BULLISH before this fix)",
    result.length === 1 && result[0]!.direction === "NEUTRAL"
  );
}
{
  // Mirror check on the BEARISH side — the fix must be symmetric.
  const result = collapseGroup([op("BEARISH"), op("NEUTRAL")]);
  assert(
    "1x BEARISH / 1x NEUTRAL -> NEUTRAL wins (symmetric with the BULLISH case)",
    result.length === 1 && result[0]!.direction === "NEUTRAL"
  );
}
{
  // 2x BEARISH / 1x NEUTRAL -> BEARISH wins (majority by count, mirror of the bullish case).
  const result = collapseGroup([op("BEARISH"), op("BEARISH"), op("NEUTRAL")]);
  assert(
    "2x BEARISH / 1x NEUTRAL -> BEARISH wins (strict majority)",
    result.length === 1 && result[0]!.direction === "BEARISH"
  );
}

// ── All-NEUTRAL group -> NEUTRAL, representative picked as before. ──────────
{
  const result = collapseGroup([
    op("NEUTRAL", { confidence: 0.83, paraphrasedQuote: "short neutral quote padded to clear the eighty character minimum length floor for this fixture." }),
    op("NEUTRAL", { confidence: 0.9, paraphrasedQuote: "higher-confidence neutral quote padded to clear the eighty character minimum length floor too." }),
  ]);
  assert("all-NEUTRAL group -> NEUTRAL, picks highest-confidence representative", result.length === 1 && result[0]!.direction === "NEUTRAL" && result[0]!.confidence === 0.9);
}

// ── All-same-direction group (no NEUTRAL involved) -> unaffected by the rewrite. ─
{
  const result = collapseGroup([op("BULLISH"), op("BULLISH"), op("BULLISH")]);
  assert("all-BULLISH group -> BULLISH, single representative", result.length === 1 && result[0]!.direction === "BULLISH");
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
