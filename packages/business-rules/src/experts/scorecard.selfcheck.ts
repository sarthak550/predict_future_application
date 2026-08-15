/**
 * Trust Layer Sprint T1 — `npm run check` (`packages/business-rules/package.json`'s
 * `"tsx src/experts/scorecard.selfcheck.ts"`). This repo has no formal test runner
 * (no jest/vitest anywhere in the workspace — confirmed before writing this); the
 * established convention for "unit tests" on pure business-rules functions is a
 * tsx-runnable selfcheck with a tiny assertion harness, exiting non-zero on any
 * failure — see apps/web/lib/ta/selfcheck.ts (`npm run ta:check`) for the precedent
 * this file follows.
 *
 * Covers `computeWilsonInterval` per the Trust Layer Sprint brief's locked oracle list
 * (Decision 2): the founder's own 4/6 worked example, n=1, a 0% and 100% hit rate, and
 * a large-n case that should be tight. Also spot-checks `computeScorecard` and
 * `buildInstrumentBreakdown` remain untouched (T1 must not touch those formulas).
 */
import { computeWilsonInterval, computeScorecard, buildInstrumentBreakdown } from "./scorecard";

// ── Tiny assertion harness (mirrors apps/web/lib/ta/selfcheck.ts) ───────────────

let passCount = 0;
let failCount = 0;

function report(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passCount += 1;
  } else {
    failCount += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function assert(label: string, condition: boolean, detail?: string): void {
  report(label, condition, detail);
}

function assertInRange(label: string, actual: number, min: number, max: number): void {
  const ok = Number.isFinite(actual) && actual >= min && actual <= max;
  report(label, ok, `expected in [${min}, ${max}], got ${actual}`);
}

function assertClose(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
  report(label, ok, `expected ${expected}, got ${actual}`);
}

// ── computeWilsonInterval ────────────────────────────────────────────────────────

// Oracle 1: the founder's own worked example, cited verbatim in the brief and on the
// eventual /methodology#sample-size copy — 4 hit / 6 resolved should land at ~30%-90%.
{
  const result = computeWilsonInterval(4, 6);
  assert("4/6: returns a result", result !== null);
  if (result) {
    // "roughly 30%-90%" per the brief — assert to the whole-percent rounding the UI
    // actually displays (Math.round(x * 100)), not to many decimals of the raw formula.
    assertClose("4/6: lower rounds to 30%", Math.round(result.lower * 100), 30);
    assertClose("4/6: upper rounds to 90%", Math.round(result.upper * 100), 90);
    assert("4/6: lower < point estimate", result.lower < 4 / 6);
    assert("4/6: upper > point estimate", result.upper > 4 / 6);
  }
}

// Oracle 2: n=1 — the widest possible interval short of n=0. A single HIT should still
// span nearly the whole [0,1] range (Wilson never claims false certainty from n=1).
{
  const hit = computeWilsonInterval(1, 1);
  assert("1/1: returns a result", hit !== null);
  if (hit) {
    assertInRange("1/1: lower bound", hit.lower, 0, 0.5);
    assertClose("1/1: upper bound is exactly 1", hit.upper, 1);
  }

  const miss = computeWilsonInterval(0, 1);
  assert("0/1: returns a result", miss !== null);
  if (miss) {
    assertClose("0/1: lower bound is exactly 0", miss.lower, 0);
    assertInRange("0/1: upper bound", miss.upper, 0.5, 1);
  }
}

// Oracle 3: 0% hit rate at a slightly larger n — lower bound must stay clamped at 0
// (the raw formula can drift to a tiny negative float here; the clamp must catch it).
{
  const result = computeWilsonInterval(0, 10);
  assert("0/10: returns a result", result !== null);
  if (result) {
    assertClose("0/10: lower bound clamped to 0", result.lower, 0);
    assert("0/10: upper bound in (0, 1)", result.upper > 0 && result.upper < 1);
  }
}

// Oracle 4: 100% hit rate — upper bound must stay clamped at 1.
{
  const result = computeWilsonInterval(10, 10);
  assert("10/10: returns a result", result !== null);
  if (result) {
    assertClose("10/10: upper bound clamped to 1", result.upper, 1);
    assert("10/10: lower bound in (0, 1)", result.lower > 0 && result.lower < 1);
  }
}

// Oracle 5: large-n case — the interval should be TIGHT (confirms the formula doesn't
// degenerate at scale). 700/1000 = 70% point estimate; Wilson at n=1000 should be within
// a few points either side, not the wide spread a small-n case produces.
{
  const result = computeWilsonInterval(700, 1000);
  assert("700/1000: returns a result", result !== null);
  if (result) {
    const width = result.upper - result.lower;
    assert("700/1000: interval is tight (width < 0.06)", width < 0.06, `width was ${width}`);
    assertInRange("700/1000: point estimate inside interval", 0.7, result.lower, result.upper);
  }
}

// Edge case: resolvedCount === 0 must return null, not divide by zero.
{
  assert("0/0: returns null", computeWilsonInterval(0, 0) === null);
}

// Sanity: interval bounds are always ordered and within [0, 1] across a spread of inputs.
{
  const cases: Array<[number, number]> = [[1, 3], [2, 5], [3, 10], [50, 50], [1, 200], [199, 200]];
  for (const [hitCount, resolvedCount] of cases) {
    const result = computeWilsonInterval(hitCount, resolvedCount);
    const label = `${hitCount}/${resolvedCount}`;
    assert(`${label}: returns a result`, result !== null);
    if (result) {
      assert(`${label}: lower <= upper`, result.lower <= result.upper);
      assertInRange(`${label}: lower in [0,1]`, result.lower, 0, 1);
      assertInRange(`${label}: upper in [0,1]`, result.upper, 0, 1);
    }
  }
}

// ── Regression guard: T1 must not touch computeScorecard / buildInstrumentBreakdown ──

{
  const scorecard = computeScorecard([
    { resolutionStatus: "RESOLVED_HIT" },
    { resolutionStatus: "RESOLVED_HIT" },
    { resolutionStatus: "RESOLVED_MISS" },
  ]);
  assertClose("computeScorecard: unchanged hitRate formula", scorecard.hitRate ?? -1, 2 / 3);
  assert("computeScorecard: unchanged provisional gate", scorecard.provisional === false);

  const breakdown = buildInstrumentBreakdown([
    { instrument: "Nifty 50", instrumentTicker: "^NSEI", resolutionStatus: "RESOLVED_HIT" },
    { instrument: "Nifty 50", instrumentTicker: "^NSEI", resolutionStatus: "RESOLVED_MISS" },
  ]);
  assert("buildInstrumentBreakdown: unchanged grouping", breakdown.length === 1 && breakdown[0]?.resolvedCount === 2);
}

// ── Report ────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log(`\nscorecard.selfcheck: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exitCode = 1;
}
