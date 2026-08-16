/**
 * Sentiment bullish-bias fix — Track A validation script (mechanisms 1+2:
 * few-shot prompt bias + collapseGroup tie-break), 2026-08-16.
 *
 * Implements the brief's Track A methodology
 * (cto_assignment_brief_sentiment_bias_fix.md, "Validation methodology ->
 * Track A"): a before/after extraction comparison on a fixed sample of real,
 * already-processed stories, run through extractExpertOpinionsFromStory()
 * ONLY — this script NEVER calls persistExpertOpinions and NEVER writes to
 * ExpertOpinion/Expert/aliases. Reads the prod DB URL from a job-scoped
 * file, never from the CLI — same pattern as scripts/investigate-accuracy-
 * discrepancy.ts and scripts/sentiment-bias-track-b-dedup-audit.ts.
 *
 * SCOPE NOTE (found while building this script, worth recording): this
 * validates mechanism 1 (the EXTRACTION_SYSTEM_PROMPT few-shot examples)
 * ONLY. collapseGroup() (mechanism 2) is invoked exclusively from
 * persistExpertOpinions's phase 2 (collapseDuplicateOpinions) — it is never
 * reached by extractExpertOpinionsFromStory, which this script (per the
 * brief's own explicit "NOT persistExpertOpinions" instruction) is the only
 * thing it's allowed to call. There is no way to exercise collapseGroup's
 * new tie-break logic through a persist-free dry run — its old-vs-new
 * behavior is instead deterministic and exhaustively covered by
 * scripts/selftest-collapse-group.ts (9/9 assertions, including the exact
 * "1xBULLISH/1xNEUTRAL now resolves NEUTRAL" behavior change), which is
 * actually the more rigorous validation for a pure, deterministic code path
 * than a probabilistic AI-driven story dry run could be. Flagging this
 * explicitly rather than silently letting "Track A validates mechanisms 1+2"
 * stand unchallenged.
 *
 * Selection (brief step 1): ~40 recent Story rows that already have >=1
 * associated ExpertOpinion and pass isApprovedFinanceSource(story.sourceUrl),
 * ordered by publishedAt desc, taken AS-IS (no cherry-picking for direction).
 *
 * Usage (from apps/api):
 *   MODE=before npx tsx scripts/sentiment-bias-track-a-dryrun.ts
 *   MODE=after  npx tsx scripts/sentiment-bias-track-a-dryrun.ts
 * (MODE only affects the output filename tag; extraction always runs
 * against whatever code is currently on disk — "before" and "after" are
 * produced by running this script against two different checkouts of
 * lib/ai/extractExpertOpinions.ts, never by the script itself mutating
 * anything.)
 *
 * Cost: SAMPLE_SIZE stories x 1 AI call each (Gemini primary, Groq
 * fallback) — well under checkAndIncrementFinanceAiDailyCap's default-50
 * per-process budget, and this in-memory counter never contends with the
 * live prod cron (separate process) — see financeAiDailyCap.ts and the
 * brief's own cost/env note.
 *
 * Output: full raw extraction results (per story: id, headline, url,
 * publishedAt, and every extracted opinion's expert/org/direction/
 * confidence/instrument/quote) written to a LOCAL JSON file under the
 * job-scoped tmp directory (never the DB, never this repo) for later
 * hand-inspection/diffing. A concise console summary (aggregate direction
 * distribution) prints on every run.
 *
 * ============================================================================
 * RESULTS (live run against prod, 2026-08-16 — re-run any time to reproduce
 * the AFTER pass against shipped code; numbers below are transcribed from
 * that run):
 * ============================================================================
 * See the CTO's sprint report / QA notes for the transcribed before/after
 * distribution and the 15 hand-verified quote judgments — intentionally not
 * hardcoded into this comment so the script's own JSON output stays the
 * source of truth.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { isApprovedFinanceSource, extractExpertOpinionsFromStory, type RawExpertOpinion } from "../lib/ai/extractExpertOpinions";

process.env.DATABASE_URL = readFileSync(
  "/Users/sarthak/.claude/jobs/66e6876e/tmp/prod_db_url.txt",
  "utf8"
).trim();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const SAMPLE_SIZE = 40;
// Over-fetch before the in-app isApprovedFinanceSource filter — not every
// story with an opinion is necessarily still on an approved domain (the
// allowlist has changed over time, S74-T1) — take a generous candidate pool.
const CANDIDATE_POOL_SIZE = 400;
const MODE = process.env.MODE === "before" ? "before" : process.env.MODE === "after" ? "after" : "unlabeled";
const OUTPUT_PATH = `/Users/sarthak/.claude/jobs/66e6876e/tmp/sentiment-bias-track-a-${MODE}.json`;

interface StoryResult {
  storyId: string;
  headline: string;
  sourceUrl: string;
  publishedAt: string;
  opinions: RawExpertOpinion[];
}

async function main() {
  console.log("=".repeat(78));
  console.log(`SENTIMENT BIAS FIX — TRACK A dry-run (mode: ${MODE})`);
  console.log("=".repeat(78));

  const candidates = await prisma.story.findMany({
    where: { expertOpinions: { some: {} } },
    orderBy: { publishedAt: "desc" },
    take: CANDIDATE_POOL_SIZE,
    select: { id: true, headline: true, sourceUrl: true, publishedAt: true, bodyText: true, summary: true },
  });

  const approved = candidates.filter((s) => isApprovedFinanceSource(s.sourceUrl));
  const sample = approved.slice(0, SAMPLE_SIZE);

  console.log(`Candidate pool (stories with >=1 ExpertOpinion, most recent ${CANDIDATE_POOL_SIZE}): ${candidates.length}`);
  console.log(`Passing isApprovedFinanceSource: ${approved.length}`);
  console.log(`Sample taken (as-is, no cherry-picking, most recent first): ${sample.length}\n`);

  if (sample.length < SAMPLE_SIZE) {
    console.warn(`WARNING: only found ${sample.length} qualifying stories, fewer than the target ${SAMPLE_SIZE}.`);
  }

  const results: StoryResult[] = [];
  const distribution = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
  let totalOpinions = 0;
  let storiesWithZeroOpinions = 0;

  for (let i = 0; i < sample.length; i++) {
    const story = sample[i]!;
    const content = story.bodyText ?? story.summary ?? "";
    process.stdout.write(`[${i + 1}/${sample.length}] ${story.headline.slice(0, 70)}... `);
    let opinions: RawExpertOpinion[] = [];
    try {
      // DRY RUN ONLY — extractExpertOpinionsFromStory never writes anything.
      // persistExpertOpinions is deliberately never imported into this
      // script, let alone called.
      opinions = await extractExpertOpinionsFromStory({
        id: story.id,
        title: story.headline,
        content,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
      });
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log(`${opinions.length} opinion(s)`);
    if (opinions.length === 0) storiesWithZeroOpinions++;
    for (const op of opinions) {
      distribution[op.direction] += 1;
      totalOpinions++;
    }
    results.push({
      storyId: story.id,
      headline: story.headline,
      sourceUrl: story.sourceUrl,
      publishedAt: story.publishedAt.toISOString(),
      opinions,
    });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify({ mode: MODE, runAt: new Date().toISOString(), sampleSize: sample.length, results }, null, 2));

  console.log(`\n--- AGGREGATE DIRECTION DISTRIBUTION (mode: ${MODE}) ---`);
  console.log(`Stories processed: ${sample.length} (${storiesWithZeroOpinions} yielded zero opinions)`);
  console.log(`Total opinions extracted: ${totalOpinions}`);
  if (totalOpinions > 0) {
    console.log(`BULLISH: ${distribution.BULLISH} (${((distribution.BULLISH / totalOpinions) * 100).toFixed(1)}%)`);
    console.log(`BEARISH: ${distribution.BEARISH} (${((distribution.BEARISH / totalOpinions) * 100).toFixed(1)}%)`);
    console.log(`NEUTRAL: ${distribution.NEUTRAL} (${((distribution.NEUTRAL / totalOpinions) * 100).toFixed(1)}%)`);
  }
  console.log(`\nFull raw output written to: ${OUTPUT_PATH}`);
  console.log("=".repeat(78));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
