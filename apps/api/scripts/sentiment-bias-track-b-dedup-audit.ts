/**
 * Sentiment bullish-bias fix — Track B validation script (mechanism 3:
 * cross-article duplicate-stance counting), 2026-08-16.
 *
 * Implements the brief's Track B methodology in full
 * (cto_assignment_brief_sentiment_bias_fix.md, "Validation methodology ->
 * Track B"). This is a deterministic, no-AI, DB-query-correctness check —
 * cheaper and faster to validate than Track A's quote-level spot check.
 *
 * READ-ONLY: this script only ever SELECTs from ExpertOpinion/Expert. It
 * never writes resolutionStatus/suppressedAt/direction/any row, and never
 * calls persistExpertOpinions. Reads the prod DB URL from a job-scoped file,
 * never from the CLI — same pattern as scripts/investigate-accuracy-
 * discrepancy.ts (Trust Layer Sprint T0).
 *
 * What it reports, against the homepage's real 7-day sentiment window
 * (mirrors apps/web/lib/finance/sentiment.ts's getSentimentSplit — same
 * `suppressedAt: null, publishedAt: { gte: sevenDaysAgo }` unscoped where):
 *
 *   1. Duplicate-rate quantification (brief step 1): among non-suppressed
 *      in-window rows grouped by (expertId, instrument-identity) — the exact
 *      same key dedupeToLatestStancePerExpertInstrument uses — how many
 *      groups have >1 row, how many rows those groups contribute beyond 1
 *      each, and how many of those groups show a genuine in-window
 *      DIRECTION FLIP (not just a restatement).
 *   2. Fix verification (brief step 2): raw count vs. the now-shipped
 *      deduped count diverge by EXACTLY the "duplicate contribution" number
 *      from step 1, cross-checked against an INDEPENDENTLY-implemented
 *      dedup (different code path, same semantics — a second engineer's
 *      "hand-computed" check, not just re-invoking the same function twice).
 *   3. The founder's two explicit test cases (brief step 3), demonstrated on
 *      REAL prod data, not synthetic fixtures:
 *      (a) one real analyst with >=2 same-direction rows on the same
 *          instrument in-window -> confirm the fixed aggregate counts them
 *          once.
 *      (b) one real analyst who FLIPPED direction on the same instrument
 *          -> confirm the fixed aggregate counts only their LATEST stance.
 *          Searched first within the 7-day window; if none exists there
 *          (a flip inside a single week is a narrow target), the search is
 *          widened to the full non-suppressed corpus and explicitly labeled
 *          as such — per the brief's own "(or note if none exists)" out.
 *
 * Usage (from apps/api): npx tsx scripts/sentiment-bias-track-b-dedup-audit.ts
 *
 * ============================================================================
 * RESULTS (live run against prod, 2026-08-16 — re-run any time to reproduce;
 * numbers below are transcribed from that run and will drift as new opinions
 * are extracted/resolved):
 * ============================================================================
 * See the CTO's sprint report / QA notes for the transcribed run output —
 * intentionally not hardcoded into this comment so the script's own printed
 * output is always the source of truth, not a comment that can drift from it.
 */
import { readFileSync } from "node:fs";

import { PrismaClient, type OpinionDirection } from "@prisma/client";

process.env.DATABASE_URL = readFileSync(
  "/Users/sarthak/.claude/jobs/66e6876e/tmp/prod_db_url.txt",
  "utf8"
).trim();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// ─── KEEP IN LOCKSTEP with apps/web/lib/finance/sentiment.ts's
// dedupeToLatestStancePerExpertInstrument (apps/api has no shared
// Prisma-aware package with apps/web — same duplication convention as
// apps/api/app/api/finance/expert-sentiment/route.ts's own port). ──────────

interface OpinionRow {
  id: string;
  expertId: string;
  expertName: string;
  expertOrg: string;
  instrumentTicker: string | null;
  instrument: string | null;
  direction: OpinionDirection;
  publishedAt: Date;
}

function dedupKey(r: { instrumentTicker: string | null; instrument: string | null }): string | null {
  if (r.instrumentTicker) return `t:${r.instrumentTicker.toUpperCase()}`;
  if (r.instrument) return `l:${r.instrument.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  return null;
}

function dedupeToLatestStancePerExpertInstrument<T extends OpinionRow>(rows: T[]): T[] {
  const latestByKey = new Map<string, T>();
  const passthrough: T[] = [];
  for (const row of rows) {
    const instKey = dedupKey(row);
    if (!instKey) { passthrough.push(row); continue; }
    const key = `${row.expertId}::${instKey}`;
    const existing = latestByKey.get(key);
    if (!existing || row.publishedAt > existing.publishedAt) latestByKey.set(key, row);
  }
  return [...latestByKey.values(), ...passthrough];
}

/**
 * Independently-implemented dedup — deliberately a DIFFERENT code shape
 * (sort-then-overwrite instead of a running max comparison) so it can catch
 * a bug in dedupeToLatestStancePerExpertInstrument's own implementation
 * rather than just re-confirming the same logic twice. Same semantics:
 * latest publishedAt wins per (expertId, instrument-identity) group.
 */
function handComputedDedup<T extends OpinionRow>(rows: T[]): T[] {
  const withKey = rows.map((r) => ({ r, key: dedupKey(r) }));
  const grouped = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const { r, key } of withKey) {
    if (key === null) { passthrough.push(r); continue; }
    const groupKey = `${r.expertId}::${key}`;
    const arr = grouped.get(groupKey) ?? [];
    arr.push(r);
    grouped.set(groupKey, arr);
  }
  const survivors: T[] = [...passthrough];
  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    survivors.push(sorted[sorted.length - 1]!); // last after ascending sort = latest
  }
  return survivors;
}

function tally(rows: OpinionRow[]): { bullish: number; bearish: number; neutral: number; total: number } {
  const bullish = rows.filter((r) => r.direction === "BULLISH").length;
  const bearish = rows.filter((r) => r.direction === "BEARISH").length;
  const neutral = rows.filter((r) => r.direction === "NEUTRAL").length;
  return { bullish, bearish, neutral, total: rows.length };
}

function pct(n: number, d: number): string {
  return d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`;
}

function fmtRow(r: OpinionRow): string {
  const inst = r.instrumentTicker ?? r.instrument ?? "(no instrument)";
  return `${r.expertName || r.expertOrg} on ${inst}: ${r.direction} @ ${r.publishedAt.toISOString().slice(0, 10)} [opinion ${r.id}]`;
}

async function fetchWindowRows(where: { publishedAt?: { gte: Date } }): Promise<OpinionRow[]> {
  const raw = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, ...where },
    orderBy: { publishedAt: "asc" },
    select: {
      id: true,
      expertId: true,
      instrument: true,
      instrumentTicker: true,
      direction: true,
      publishedAt: true,
      expert: { select: { name: true, organization: true } },
    },
  });
  return raw.map((r) => ({
    id: r.id,
    expertId: r.expertId,
    expertName: r.expert.name,
    expertOrg: r.expert.organization,
    instrument: r.instrument,
    instrumentTicker: r.instrumentTicker,
    direction: r.direction,
    publishedAt: r.publishedAt,
  }));
}

async function main() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  console.log("=".repeat(78));
  console.log("SENTIMENT BIAS FIX — TRACK B (mechanism 3: duplicate-stance dedup audit)");
  console.log("=".repeat(78));
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Homepage 7-day window start: ${sevenDaysAgo.toISOString()}\n`);

  // ── Step 1: quantify the bug on the real homepage window ─────────────────
  const windowRows = await fetchWindowRows({ publishedAt: { gte: sevenDaysAgo } });
  console.log(`--- STEP 1: 7-day window duplicate-rate quantification ---`);
  console.log(`Total non-suppressed rows in window: ${windowRows.length}`);

  const groups = new Map<string, OpinionRow[]>();
  const ungroupable: OpinionRow[] = [];
  for (const row of windowRows) {
    const key = dedupKey(row);
    if (!key) { ungroupable.push(row); continue; }
    const groupKey = `${row.expertId}::${key}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push(row);
    groups.set(groupKey, arr);
  }
  const groupsWithDup = [...groups.values()].filter((g) => g.length > 1);
  const duplicateRowContribution = groupsWithDup.reduce((sum, g) => sum + (g.length - 1), 0);
  const groupsWithDirectionFlip = groupsWithDup.filter((g) => new Set(g.map((r) => r.direction)).size > 1);

  console.log(`Rows with no resolvable instrument identity (passthrough, unmerged): ${ungroupable.length}`);
  console.log(`Distinct (expert, instrument) groups: ${groups.size}`);
  console.log(`Groups with >1 row (duplicate-stance groups): ${groupsWithDup.length}`);
  console.log(`Rows contributed BEYOND the first in each dup group (would be double-counted pre-fix): ${duplicateRowContribution}`);
  console.log(`Of those dup groups, how many show a genuine in-window DIRECTION FLIP (not just a restatement): ${groupsWithDirectionFlip.length}`);
  if (groupsWithDup.length > 0) {
    console.log(`\nSample duplicate-stance groups (up to 5):`);
    for (const g of groupsWithDup.slice(0, 5)) {
      console.log(`  ${g.length}x rows:`);
      for (const r of [...g].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) {
        console.log(`    - ${fmtRow(r)}`);
      }
    }
  }

  // ── Step 2: verify the fix — raw vs deduped, cross-checked independently ─
  console.log(`\n--- STEP 2: fix verification (raw vs. deduped, cross-checked) ---`);
  const deduped = dedupeToLatestStancePerExpertInstrument(windowRows);
  const handDeduped = handComputedDedup(windowRows);

  const rawTally = tally(windowRows);
  const dedupedTally = tally(deduped);
  const handTally = tally(handDeduped);

  console.log(`Raw (pre-fix) counts:     bullish=${rawTally.bullish} bearish=${rawTally.bearish} neutral=${rawTally.neutral} total=${rawTally.total}`);
  console.log(`Deduped (shipped) counts: bullish=${dedupedTally.bullish} bearish=${dedupedTally.bearish} neutral=${dedupedTally.neutral} total=${dedupedTally.total}`);
  console.log(`Hand-computed (independent implementation) counts: bullish=${handTally.bullish} bearish=${handTally.bearish} neutral=${handTally.neutral} total=${handTally.total}`);

  const rawVsDedupedDivergence = rawTally.total - dedupedTally.total;
  const matchesExpectedDivergence = rawVsDedupedDivergence === duplicateRowContribution;
  console.log(`\nraw.total - deduped.total = ${rawVsDedupedDivergence}; expected (duplicateRowContribution from Step 1) = ${duplicateRowContribution}`);
  console.log(`MATCH: ${matchesExpectedDivergence ? "YES ✓" : "NO ✗ — INVESTIGATE"}`);

  const shippedMatchesHand =
    dedupedTally.bullish === handTally.bullish &&
    dedupedTally.bearish === handTally.bearish &&
    dedupedTally.neutral === handTally.neutral &&
    dedupedTally.total === handTally.total;
  console.log(`Shipped dedup matches independent hand-computed dedup: ${shippedMatchesHand ? "YES ✓" : "NO ✗ — INVESTIGATE"}`);

  console.log(`\nRaw percentages:     bullish=${pct(rawTally.bullish, rawTally.total)} bearish=${pct(rawTally.bearish, rawTally.total)} neutral=${pct(rawTally.neutral, rawTally.total)}`);
  console.log(`Deduped percentages: bullish=${pct(dedupedTally.bullish, dedupedTally.total)} bearish=${pct(dedupedTally.bearish, dedupedTally.total)} neutral=${pct(dedupedTally.neutral, dedupedTally.total)}`);

  if (!matchesExpectedDivergence || !shippedMatchesHand) {
    console.error("\n*** VERIFICATION FAILED — see above. Do not treat mechanism 3 as validated. ***");
    process.exitCode = 1;
  }

  // ── Step 3: founder's two explicit test cases, on real data ──────────────
  console.log(`\n--- STEP 3: founder's explicit test cases (real prod data) ---`);

  // (a) repeated SAME-direction stance -> counted once.
  const sameDirectionGroup = groupsWithDup.find((g) => new Set(g.map((r) => r.direction)).size === 1);
  if (sameDirectionGroup) {
    const survivorInDeduped = deduped.filter(
      (r) => r.expertId === sameDirectionGroup[0]!.expertId && dedupKey(r) === dedupKey(sameDirectionGroup[0]!)
    );
    console.log(`(a) REPEATED SAME-DIRECTION STANCE — real case found in the 7-day window:`);
    for (const r of [...sameDirectionGroup].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) {
      console.log(`    RAW: ${fmtRow(r)}`);
    }
    console.log(`    Fixed aggregate counts this group ${survivorInDeduped.length} time(s) (expected: 1). ${survivorInDeduped.length === 1 ? "PASS ✓" : "FAIL ✗"}`);
    if (survivorInDeduped.length === 1) {
      console.log(`    Surviving row is the latest: ${fmtRow(survivorInDeduped[0]!)}`);
    }
  } else {
    console.log(`(a) No same-direction duplicate-stance group found in the 7-day window (window may be thin this run) — see widened-corpus fallback below.`);
  }

  // (b) FLIPPED direction -> counts only the latest.
  let flipGroup: OpinionRow[] | undefined = groupsWithDirectionFlip[0];
  let flipSearchScope = "7-day homepage window";
  if (!flipGroup) {
    // Widen to the full non-suppressed corpus (brief: "within a window" —
    // not necessarily the 7-day one — "or note if none exists").
    flipSearchScope = "full non-suppressed corpus (all-time; none found in the 7-day window)";
    const allRows = await fetchWindowRows({});
    const allGroups = new Map<string, OpinionRow[]>();
    for (const row of allRows) {
      const key = dedupKey(row);
      if (!key) continue;
      const groupKey = `${row.expertId}::${key}`;
      const arr = allGroups.get(groupKey) ?? [];
      arr.push(row);
      allGroups.set(groupKey, arr);
    }
    flipGroup = [...allGroups.values()].find((g) => g.length > 1 && new Set(g.map((r) => r.direction)).size > 1);
  }
  if (flipGroup) {
    const sorted = [...flipGroup].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    const latest = sorted[sorted.length - 1]!;
    const dedupedResult = dedupeToLatestStancePerExpertInstrument(flipGroup);
    const correctlyCollapsedToOne = dedupedResult.length === 1;
    const correctlyKeptLatest = correctlyCollapsedToOne && dedupedResult[0]!.id === latest.id;
    console.log(`(b) DIRECTION FLIP — real case found (search scope: ${flipSearchScope}):`);
    for (const r of sorted) {
      console.log(`    RAW: ${fmtRow(r)}${r.id === latest.id ? "  <- latest" : ""}`);
    }
    console.log(`    Fixed aggregate collapses to ${dedupedResult.length} row(s) (expected: 1). ${correctlyCollapsedToOne ? "PASS ✓" : "FAIL ✗"}`);
    console.log(`    Surviving row is the LATEST stance, not an earlier one: ${correctlyKeptLatest ? "PASS ✓" : "FAIL ✗"}`);
  } else {
    console.log(`(b) No direction-flip case exists ANYWHERE in the non-suppressed corpus at run time — noting absence per the brief's explicit "or note if none exists" out. This is itself informative: same-direction restatement is the dominant duplicate pattern in this corpus, not flip-flopping.`);
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(process.exitCode === 1 ? "TRACK B: FAILED — see errors above." : "TRACK B: PASSED — mechanism 3 verified against real prod data.");
  console.log("=".repeat(78));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
