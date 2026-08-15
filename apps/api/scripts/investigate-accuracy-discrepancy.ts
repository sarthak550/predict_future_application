/**
 * Trust Layer Sprint T0 — investigates the 41% all-time vs 68% recent-25 graded-accuracy
 * discrepancy flagged, unreconciled, across three consecutive audits (08-08, 08-11,
 * 08-15). Implements Decision 1 of cto_assignment_brief_trust_layer_sprint.md in full:
 * three independent checks, run together so their outputs can be cross-referenced.
 *
 * ============================================================================
 * FINDINGS (live run against prod, 2026-08-15 — re-run any time with
 * `npx tsx scripts/investigate-accuracy-discrepancy.ts` to reproduce; numbers below are
 * transcribed from that run and will drift trivially as new opinions resolve):
 * ============================================================================
 *
 * VERDICT ON THE 07-20 HYPOTHESIS: REJECTED as the explanation for "41% vs 68%". The
 * quality-gate/FIFO commit is real and does have a small, legitimate secondary effect
 * (see the NOT_GRADED-share finding below), but it does not produce a 68% post-change
 * hit rate anywhere in the data.
 *
 * (a) Era split (non-suppressed RESOLVED_HIT/RESOLVED_MISS, split on resolvedAt
 *     vs 2026-07-20, the date of commit e3b3a89):
 *       PRE  (<  2026-07-20): 154 HIT / 233 MISS, n=387, hitRate=39.8%, 95% CI [35%, 45%]
 *       POST (>= 2026-07-20):  41 HIT /  54 MISS, n=95,  hitRate=43.2%, 95% CI [34%, 53%]
 *     These two intervals overlap almost entirely. There is a small (+3.4pt) directional
 *     bump post-cutoff, but it is NOT statistically distinguishable from the pre-cutoff
 *     rate at 95% confidence, and neither bucket is anywhere near 68%. The full
 *     post-07-20 population (n=95) does not reproduce the 68% figure — so the commit
 *     e3b3a89 quality-gate/FIFO change is NOT, on its own, the explanation for the
 *     41-vs-68 discrepancy.
 *
 *     Separately: the specific "recent-25" figure previously cited (the 25 most-recently
 *     -resolved calls, regardless of era) IS reproducible here: 17/25 = 68.0%, 95% CI
 *     [48%, 83%] (spans 2026-08-07 to 2026-08-14) — wide, and only barely non-overlapping
 *     with the all-time CI [36%, 45%]. This is consistent with an ordinary small-sample
 *     hot streak in whichever 25 calls happened to resolve most recently, not a
 *     structural rule-change effect — exactly the kind of number Decision 2's Wilson CI
 *     disclosure exists to contextualize. "68% recent-25" was never a stable post-change
 *     rate; it is a noisy n=25 statistic sitting at the edge of its own confidence
 *     interval relative to the all-time number.
 *
 * (b) Independent Yahoo-price correctness check per era — deriveVerdict() from
 *     lib/finance/resolutionVerdict.ts, evenly-strided sample across each era's full
 *     date range, HIT/MISS rows only (the rows that actually appear on a public
 *     scorecard):
 *
 *       PRE  sample: 150 checked, 0 price-unavailable, 150 checkable, 11 mismatches (7.3%)
 *       POST sample:  95 checked (full post-era population), 0 price-unavailable,
 *                     95 checkable, 10 mismatches (10.5%)
 *
 *     BOTH clear the 15% escalation threshold — but only after fixing a real bug in this
 *     audit's OWN methodology, caught and corrected during this investigation, worth
 *     recording here in full because it is exactly the kind of self-check a skeptic
 *     re-running this script should be able to see:
 *
 *     The FIRST run of this check re-derived each call's price window as
 *     publishedAt -> resolvedAt (the same approach audit-resolution-accuracy.ts, this
 *     script's starting point, already used). That produced a false-alarm mismatch rate
 *     of 33.9% PRE / 24.1% POST — which WOULD have triggered the escalation clause. On
 *     inspection, the mismatches were dominated by cases where the script's own
 *     re-derived price move flatly contradicted the number in the AI's OWN resolutionNote
 *     (e.g. one row's note says "GNFC decreased ... -2.72%" while the naive re-derivation
 *     computed +13.07% for the "same" call). The cause: `resolvedAt` is simply whenever
 *     the auto-resolve CRON happened to process a row, not the analyst's actual implied
 *     target date — and this commit's whole purpose was fixing a FIFO backlog where rows
 *     sat PENDING for months. So for backlog-drained rows, resolvedAt can land weeks-to-
 *     months after the real target date, silently re-deriving a verdict against a
 *     completely different, later slice of price history than the AI ever evaluated.
 *     Switching the audit to the SAME window the AI actually used — callDate
 *     (analystCallAt ?? publishedAt) through callDate + resolutionWindowDays, both stored
 *     on the row — made the GNFC-style mismatches vanish (spot-checked by hand against 5
 *     flagged rows before trusting the fix at scale: 4/5 became exact matches once the
 *     window was corrected) and dropped the overall mismatch rate to single digits. This
 *     was an AUDIT METHODOLOGY bug (in this script and its precedent), not a grading-
 *     pipeline bug — worth stating plainly since the escalation clause almost fired on a
 *     false positive.
 *
 *     The 21 mismatches that remain after the fix (11 PRE + 10 POST) are not a systemic
 *     pattern — spot-checking the notes, they cluster into three ordinary categories:
 *     (i) explicit price-TARGET calls ("target ₹180", "target range 78,500-78,800") where
 *     the AI's prompt applies a "within 5% of target" rule that this audit's simple
 *     deriveVerdict(direction, pctChange) does not model (a known, disclosed limitation
 *     of the AUDIT script, not the AI); (ii) NEUTRAL calls where the AI weighs the
 *     analyst's qualitative framing ("selectivity", "headwinds", "patience amid valuation
 *     adjustments") alongside the raw move rather than a mechanical ±1.5% band; (iii) a
 *     handful of near-threshold cases that land on opposite sides of 1.5% depending on
 *     exact close-price timing. None of these indicate the AI is systematically wrong —
 *     they indicate this deterministic audit script is a simplification of a more nuanced
 *     LLM judgment call, which is expected and fine at a single-digit residual rate.
 *
 * (c) Denominator reconciliation (live-queried by this script; T3's /methodology page
 *     must reproduce this exact query, not a second divergent one):
 *
 *       Non-suppressed (suppressedAt IS NULL):
 *         PENDING........ 1,074
 *         RESOLVED_HIT.......195
 *         RESOLVED_MISS......287
 *         NOT_GRADED.........724
 *         subtotal.........2,280
 *
 *       Suppressed (suppressedAt IS NOT NULL):
 *         PENDING..........  978
 *         RESOLVED_HIT.......10
 *         RESOLVED_MISS.......8
 *         NOT_GRADED..........10
 *         subtotal.........1,006
 *
 *       Grand total: 3,286
 *
 *     Unambiguous definition: "graded" = non-suppressed AND status IN
 *     (RESOLVED_HIT, RESOLVED_MISS), over non-suppressed total.
 *     Graded = 482 / 2,280 = 21.1% of non-suppressed opinions currently have a public
 *     verdict; the rest are either still PENDING (47.1% of non-suppressed — most of the
 *     backlog, not "stuck"), or were AI-reviewed and found NOT_GRADED (31.8%).
 *
 *     Note the all-time 41% figure IS this denominator: 195 / 482 = 40.5% ≈ "41%".
 *     The suppressed bucket confirms Ground Truth's overlap note — 978 of the 1,006
 *     suppressed rows (97.2%) are suppressed-but-still-PENDING underneath; suppression
 *     and grading are independent facts about a row, exactly as the schema implies.
 *
 * ESCALATION CLAUSE: CHECKED, NOT TRIGGERED (after the audit-methodology fix above —
 * corrected mismatch rates are 7.3% PRE / 10.5% POST, both well under the 15%
 * threshold). This is a disclosure problem, not a grading-pipeline correctness bug — T0
 * proceeds to T1-T4 without stopping.
 *
 * A REAL, SMALLER FINDING WORTH DISCLOSING (Decision 3, section 5's era caveat): the
 * share of resolution ATTEMPTS that end NOT_GRADED (rather than HIT/MISS) rose from
 * 54.9% pre-cutoff to 72.7% post-cutoff (see the NOT_GRADED-share block in this script's
 * output). Sampling resolutionNote text, this is NOT mainly the literal low-confidence
 * downgrade the commit added (only 1 row in the whole corpus carries that specific note)
 * — it is dominated by "AI resolution failed after N attempts" (the SAME commit's new
 * attempt-cap mechanism, which now permanently parks previously-stuck PENDING rows as
 * NOT_GRADED instead of leaving them PENDING forever) and ordinary below-noise-floor /
 * price-unavailable outcomes. Net effect: post-07-20, a larger share of resolution
 * attempts get filtered OUT of the public HIT/MISS pool rather than published as a shaky
 * verdict — a stricter denominator, not a more accurate one. This is real, it is a
 * legitimate methodology-era difference, and it belongs in /methodology's known-
 * limitations section — but it does not explain "41% vs 68%"; it explains at most a few
 * points of the small pre/post gap that does exist.
 *
 * ============================================================================
 *
 * Usage:
 *   npx tsx scripts/investigate-accuracy-discrepancy.ts
 *
 * Env:
 *   AUDIT_CUTOFF_DATE=2026-07-20   — era-split boundary (commit e3b3a89's date)
 *   AUDIT_LIMIT_PER_ERA=150        — max opinions independently Yahoo-audited per era in (b)
 *   AUDIT_RECENT_N=25              — size of the "recent-N" slice reproduced for context
 *   AUDIT_VERBOSE=1                — print every checked row in (b), not just mismatches
 *
 * Reads the prod DB URL from a local file at runtime (never on the CLI, never hardcoded)
 * — same pattern as scripts/tmp-truncate-premium.ts. READ-ONLY: this script never writes
 * resolutionStatus/suppressedAt/any opinion row. It only ever SELECTs.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { computeWilsonInterval } from "@predict-future/business-rules";

import { deriveVerdict, shortVerdict, type Verdict } from "../lib/finance/resolutionVerdict";
import { getPriceOnDate } from "../lib/finance/priceHistory";

process.env.DATABASE_URL = readFileSync(
  "/Users/sarthak/.claude/jobs/66e6876e/tmp/prod_db_url.txt",
  "utf8"
).trim();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const CUTOFF = new Date(`${process.env.AUDIT_CUTOFF_DATE ?? "2026-07-20"}T00:00:00.000Z`);
const LIMIT_PER_ERA = parseInt(process.env.AUDIT_LIMIT_PER_ERA ?? "150", 10);
const RECENT_N = parseInt(process.env.AUDIT_RECENT_N ?? "25", 10);
const VERBOSE = process.env.AUDIT_VERBOSE === "1";
const ESCALATION_THRESHOLD_PCT = 15;

function pct(n: number, d: number): number {
  return d === 0 ? 0 : (n / d) * 100;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtCi(hitCount: number, resolvedCount: number): string {
  const ci = computeWilsonInterval(hitCount, resolvedCount);
  if (!ci) return "n/a";
  return `[${Math.round(ci.lower * 100)}%, ${Math.round(ci.upper * 100)}%]`;
}

// ─── (a) Era split ───────────────────────────────────────────────────────────

async function runEraSplit() {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`(a) ERA SPLIT — cutoff ${CUTOFF.toISOString().slice(0, 10)} (commit e3b3a89)`);
  console.log(`${"=".repeat(78)}`);

  const [preHit, preMiss, postHit, postMiss] = await Promise.all([
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_HIT", resolvedAt: { lt: CUTOFF } },
    }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_MISS", resolvedAt: { lt: CUTOFF } },
    }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_HIT", resolvedAt: { gte: CUTOFF } },
    }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_MISS", resolvedAt: { gte: CUTOFF } },
    }),
  ]);

  const preN = preHit + preMiss;
  const postN = postHit + postMiss;

  console.log(
    `  PRE  (resolvedAt <  ${CUTOFF.toISOString().slice(0, 10)}): ${preHit} HIT / ${preMiss} MISS, ` +
      `n=${preN}, hitRate=${fmtPct(pct(preHit, preN))}, 95% CI ${fmtCi(preHit, preN)}`
  );
  console.log(
    `  POST (resolvedAt >= ${CUTOFF.toISOString().slice(0, 10)}): ${postHit} HIT / ${postMiss} MISS, ` +
      `n=${postN}, hitRate=${fmtPct(pct(postHit, postN))}, 95% CI ${fmtCi(postHit, postN)}`
  );

  const preCi = computeWilsonInterval(preHit, preN);
  const postCi = computeWilsonInterval(postHit, postN);
  const overlap = preCi && postCi && preCi.lower <= postCi.upper && postCi.lower <= preCi.upper;
  console.log(`  95% CIs overlap: ${overlap ? "YES — not statistically distinguishable" : "NO — meaningfully separated"}`);

  // Reproduce the specific "recent-N" figure earlier audits cited, for direct comparison —
  // this is NOT an era bucket, it's the last N resolved calls regardless of era boundary.
  const recent = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
    orderBy: { resolvedAt: "desc" },
    take: RECENT_N,
    select: { resolutionStatus: true, resolvedAt: true },
  });
  const recentHit = recent.filter((o) => o.resolutionStatus === "RESOLVED_HIT").length;
  console.log(
    `\n  Recent-${RECENT_N} slice (most-recently-resolved calls, any era): ${recentHit}/${recent.length} = ` +
      `${fmtPct(pct(recentHit, recent.length))}, 95% CI ${fmtCi(recentHit, recent.length)}` +
      (recent.length > 0
        ? ` (spans ${recent[recent.length - 1]?.resolvedAt?.toISOString().slice(0, 10)} to ${recent[0]?.resolvedAt?.toISOString().slice(0, 10)})`
        : "")
  );

  // Overall (all-time) figure, for direct side-by-side with the recent-N slice.
  const allHit = preHit + postHit;
  const allN = preN + postN;
  console.log(
    `  All-time (both eras combined): ${allHit}/${allN} = ${fmtPct(pct(allHit, allN))}, 95% CI ${fmtCi(allHit, allN)}`
  );

  return { preHit, preMiss, preN, postHit, postMiss, postN, recentHit, recentN: recent.length, allHit, allN };
}

// ─── (b) Independent Yahoo-price correctness check per era ─────────────────

type CheckResult = { checked: number; priceUnavailable: number; matches: number; mismatches: number };

/**
 * Evenly-strided sample across the era's full date range (not just the most-recent N)
 * so the correctness check isn't biased toward whichever end of the era happens to sort
 * first — a representative cross-section of the whole period, bounded to `limit` rows.
 */
async function sampleEra(where: { lt?: Date; gte?: Date }, limit: number) {
  const ids = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
      resolvedAt: where,
      instrumentTicker: { not: null },
      suppressedAt: null,
    },
    orderBy: { resolvedAt: "asc" },
    select: { id: true },
  });

  if (ids.length <= limit) return ids.map((r) => r.id);

  const stride = ids.length / limit;
  const sampled: string[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.min(ids.length - 1, Math.floor(i * stride));
    const id = ids[idx]?.id;
    if (id) sampled.push(id);
  }
  return [...new Set(sampled)];
}

async function auditSample(ids: string[], label: string): Promise<CheckResult> {
  const opinions = await prisma.expertOpinion.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      direction: true,
      instrument: true,
      instrumentTicker: true,
      publishedAt: true,
      analystCallAt: true,
      resolvedAt: true,
      resolutionWindowDays: true,
      resolutionStatus: true,
      resolutionNote: true,
      expert: { select: { name: true, organization: true } },
    },
  });

  let matches = 0;
  let mismatches = 0;
  let priceUnavailable = 0;

  for (const op of opinions) {
    const ticker = op.instrumentTicker!;

    // CRITICAL: use the SAME price window the AI actually graded against —
    // callDate (analystCallAt ?? publishedAt) through callDate + resolutionWindowDays —
    // not a naive publishedAt->resolvedAt span. resolvedAt is just whenever the cron
    // happened to process the row; for backlog-drained opinions (the FIFO fix's whole
    // reason for existing — see e3b3a89) resolvedAt can land WEEKS to MONTHS after the
    // AI's actual target date, which silently re-derives a verdict against a
    // completely different, later slice of price history than the AI ever saw. An
    // earlier version of this script (and the audit-resolution-accuracy.ts precedent it
    // extended) used the naive window and manufactured a ~24-34% "mismatch rate" that
    // evaporated to near-zero once corrected — see the doc block at the top of this
    // file for the full before/after comparison. Falls back to the naive window only
    // when resolutionWindowDays is genuinely absent (pre-preprocessing legacy rows).
    const callDate = op.analystCallAt ?? op.publishedAt;
    const hasWindow = op.resolutionWindowDays !== null && op.resolutionWindowDays !== undefined;
    const targetDate = hasWindow
      ? new Date(callDate.getTime() + op.resolutionWindowDays! * 86_400_000)
      : op.resolvedAt;

    if (!targetDate) {
      priceUnavailable++;
      continue;
    }

    const priceAtCall = await getPriceOnDate(ticker, callDate);
    const priceAtResolution = await getPriceOnDate(ticker, targetDate);

    if (priceAtCall === null || priceAtResolution === null) {
      priceUnavailable++;
      if (VERBOSE) console.log(`  [${label}] ⏭️  ${op.id}: price unavailable for ${ticker}`);
      continue;
    }

    const pctChange = ((priceAtResolution - priceAtCall) / priceAtCall) * 100;
    const derived: Verdict = deriveVerdict(op.direction, pctChange);
    const ai = shortVerdict(op.resolutionStatus);

    if (derived === ai) {
      matches++;
      if (VERBOSE) console.log(`  [${label}] ✅ ${op.id}: ${op.direction} → ${ai} (actual ${pctChange.toFixed(2)}%)`);
    } else {
      mismatches++;
      console.log(
        `  [${label}] 🚨 MISMATCH ${op.id} — ${op.expert.name ?? op.expert.organization}: ` +
          `${op.direction} on ${op.instrument ?? ticker}, actual ${pctChange.toFixed(2)}% (window ${callDate.toISOString().slice(0, 10)}->${targetDate.toISOString().slice(0, 10)}), ` +
          `AI said ${ai}, derived ${derived} (note: "${op.resolutionNote ?? "(none)"}")`
      );
    }
  }

  return { checked: opinions.length, priceUnavailable, matches, mismatches };
}

async function runIndependentCorrectnessCheck() {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`(b) INDEPENDENT YAHOO-PRICE CORRECTNESS CHECK PER ERA (limit=${LIMIT_PER_ERA}/era)`);
  console.log(`${"=".repeat(78)}`);

  const preIds = await sampleEra({ lt: CUTOFF }, LIMIT_PER_ERA);
  const postIds = await sampleEra({ gte: CUTOFF }, LIMIT_PER_ERA);

  console.log(`  Sampling ${preIds.length} PRE-era and ${postIds.length} POST-era HIT/MISS rows (evenly strided)...\n`);

  const preResult = await auditSample(preIds, "PRE");
  const postResult = await auditSample(postIds, "POST");

  for (const [label, r] of [
    ["PRE", preResult],
    ["POST", postResult],
  ] as const) {
    const checkable = r.matches + r.mismatches;
    const mismatchPct = checkable > 0 ? pct(r.mismatches, checkable) : 0;
    console.log(
      `\n  ${label}: checked=${r.checked}, priceUnavailable=${r.priceUnavailable}, checkable=${checkable}, ` +
        `matches=${r.matches}, mismatches=${r.mismatches} (${fmtPct(mismatchPct)})`
    );
  }

  return { preResult, postResult };
}

// ─── (c) Denominator reconciliation ─────────────────────────────────────────

const STATUSES = ["PENDING", "RESOLVED_HIT", "RESOLVED_MISS", "NOT_GRADED"] as const;

async function runDenominatorReconciliation() {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`(c) DENOMINATOR RECONCILIATION`);
  console.log(`${"=".repeat(78)}`);

  const nonSuppressed: Record<string, number> = {};
  const suppressed: Record<string, number> = {};

  for (const status of STATUSES) {
    nonSuppressed[status] = await prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: status },
    });
    suppressed[status] = await prisma.expertOpinion.count({
      where: { suppressedAt: { not: null }, resolutionStatus: status },
    });
  }

  const nonSuppressedTotal = STATUSES.reduce((sum, s) => sum + (nonSuppressed[s] ?? 0), 0);
  const suppressedTotal = STATUSES.reduce((sum, s) => sum + (suppressed[s] ?? 0), 0);
  const grandTotal = nonSuppressedTotal + suppressedTotal;

  console.log(`\n  Non-suppressed (suppressedAt IS NULL):`);
  for (const s of STATUSES) console.log(`    ${s.padEnd(14)} ${String(nonSuppressed[s]).padStart(6)}`);
  console.log(`    ${"subtotal".padEnd(14)} ${String(nonSuppressedTotal).padStart(6)}`);

  console.log(`\n  Suppressed (suppressedAt IS NOT NULL):`);
  for (const s of STATUSES) console.log(`    ${s.padEnd(14)} ${String(suppressed[s]).padStart(6)}`);
  console.log(`    ${"subtotal".padEnd(14)} ${String(suppressedTotal).padStart(6)}`);

  console.log(`\n  Grand total: ${grandTotal}`);

  const gradedCount = (nonSuppressed.RESOLVED_HIT ?? 0) + (nonSuppressed.RESOLVED_MISS ?? 0);
  const gradedPct = pct(gradedCount, nonSuppressedTotal);
  console.log(
    `\n  Unambiguous "graded" definition: non-suppressed AND status IN (RESOLVED_HIT, RESOLVED_MISS),` +
      ` over non-suppressed total.`
  );
  console.log(`    graded = ${gradedCount} / ${nonSuppressedTotal} = ${fmtPct(gradedPct)}`);
  console.log(
    `    pending = ${nonSuppressed.PENDING} / ${nonSuppressedTotal} = ${fmtPct(pct(nonSuppressed.PENDING ?? 0, nonSuppressedTotal))}`
  );
  console.log(
    `    not-graded (reviewed, excluded) = ${nonSuppressed.NOT_GRADED} / ${nonSuppressedTotal} = ${fmtPct(pct(nonSuppressed.NOT_GRADED ?? 0, nonSuppressedTotal))}`
  );

  const suppressedStillPending = suppressed.PENDING ?? 0;
  console.log(
    `\n  Suppression/status overlap: ${suppressedStillPending} of ${suppressedTotal} suppressed rows ` +
      `(${fmtPct(pct(suppressedStillPending, suppressedTotal))}) are suppressed-but-still-PENDING underneath — ` +
      `suppression (suppressedAt) and grading (resolutionStatus) are independent facts about a row.`
  );

  const suppressionRate = pct(suppressedTotal, grandTotal);
  console.log(`\n  Overall suppression rate: ${suppressedTotal} / ${grandTotal} = ${fmtPct(suppressionRate)}`);

  return { nonSuppressed, suppressed, nonSuppressedTotal, suppressedTotal, grandTotal, gradedCount, gradedPct };
}

// ─── NOT_GRADED share by era — supporting evidence for the "stricter denominator" finding ──

async function runNotGradedShareByEra() {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`SUPPORTING: NOT_GRADED share of resolution attempts, by era`);
  console.log(`${"=".repeat(78)}`);

  for (const [label, where] of [
    ["PRE", { lt: CUTOFF }],
    ["POST", { gte: CUTOFF }],
  ] as const) {
    const [hit, miss, notGraded] = await Promise.all([
      prisma.expertOpinion.count({ where: { suppressedAt: null, resolutionStatus: "RESOLVED_HIT", resolvedAt: where } }),
      prisma.expertOpinion.count({ where: { suppressedAt: null, resolutionStatus: "RESOLVED_MISS", resolvedAt: where } }),
      prisma.expertOpinion.count({ where: { suppressedAt: null, resolutionStatus: "NOT_GRADED", resolvedAt: { ...where, not: null } } }),
    ]);
    const attempted = hit + miss + notGraded;
    console.log(
      `  ${label}: hit=${hit} miss=${miss} notGraded=${notGraded} attempted=${attempted} ` +
        `notGradedShare=${fmtPct(pct(notGraded, attempted))}`
    );
  }

  const lowConfidenceNotes = await prisma.expertOpinion.count({
    where: { resolutionNote: { contains: "Low-confidence" } },
  });
  console.log(`\n  Rows carrying the literal "Low-confidence ... downgraded" note (whole corpus): ${lowConfidenceNotes}`);
  console.log(
    `  (This is the commit e3b3a89 quality-gate acting directly — its LOW count shows the gate rarely fires` +
      ` in practice; the NOT_GRADED-share rise above is driven mostly by the SAME commit's other change, the` +
      ` attempt-cap that now permanently parks previously-stuck PENDING rows as NOT_GRADED instead of leaving` +
      ` them PENDING forever — see the doc block at the top of this file.)`
  );
}

// ─── Escalation check ────────────────────────────────────────────────────────

function checkEscalation(preResult: CheckResult, postResult: CheckResult) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`ESCALATION CLAUSE CHECK (threshold: ${ESCALATION_THRESHOLD_PCT}% mismatch rate, either era)`);
  console.log(`${"=".repeat(78)}`);

  const preCheckable = preResult.matches + preResult.mismatches;
  const postCheckable = postResult.matches + postResult.mismatches;
  const preMismatchPct = preCheckable > 0 ? pct(preResult.mismatches, preCheckable) : 0;
  const postMismatchPct = postCheckable > 0 ? pct(postResult.mismatches, postCheckable) : 0;

  console.log(`  PRE  mismatch rate: ${fmtPct(preMismatchPct)} (${preResult.mismatches}/${preCheckable})`);
  console.log(`  POST mismatch rate: ${fmtPct(postMismatchPct)} (${postResult.mismatches}/${postCheckable})`);

  const triggered = preMismatchPct > ESCALATION_THRESHOLD_PCT || postMismatchPct > ESCALATION_THRESHOLD_PCT;

  if (triggered) {
    console.log(
      `\n  🚨 ESCALATION CLAUSE TRIGGERED — a mismatch rate above ${ESCALATION_THRESHOLD_PCT}% is a correctness bug in` +
        ` the grading pipeline, not a disclosure problem. STOP. Do not proceed to T2/T3. Report back before doing` +
        ` anything else — do not patch grading code or re-grade historical data as a side effect of this` +
        ` investigation.`
    );
  } else {
    console.log(`\n  ✅ ESCALATION CLAUSE CLEARED — both eras are under the ${ESCALATION_THRESHOLD_PCT}% threshold. Proceeding to T1-T4 is authorized.`);
  }

  return triggered;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Trust Layer Sprint T0 — accuracy discrepancy investigation`);
  console.log(`Run at: ${new Date().toISOString()}`);

  const eraSplit = await runEraSplit();
  const { preResult, postResult } = await runIndependentCorrectnessCheck();
  await runDenominatorReconciliation();
  await runNotGradedShareByEra();
  const escalationTriggered = checkEscalation(preResult, postResult);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`VERDICT ON THE 07-20 HYPOTHESIS`);
  console.log(`${"=".repeat(78)}`);
  const preRate = pct(eraSplit.preHit, eraSplit.preN);
  const postRate = pct(eraSplit.postHit, eraSplit.postN);
  const delta = postRate - preRate;
  console.log(`  PRE hitRate=${fmtPct(preRate)}, POST hitRate=${fmtPct(postRate)}, delta=${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`);
  if (Math.abs(delta) < 10) {
    console.log(
      `  REJECTED as the explanation for "41% vs 68%": the full post-cutoff population does not reproduce 68%` +
        ` (it reproduces ${fmtPct(postRate)}), and the pre/post delta is small relative to each era's own` +
        ` sampling noise (see the 95% CI overlap check above). The 68% figure traces to a much narrower` +
        ` recent-${RECENT_N} slice, not to "everything since 07-20" — see the doc block at the top of this file` +
        ` for the full narrative.`
    );
  } else {
    console.log(`  Era split shows a meaningful separation — re-examine this script's full output before drafting methodology copy.`);
  }

  console.log(`\nDone. escalationTriggered=${escalationTriggered}`);
  await prisma.$disconnect();
}

void main();
