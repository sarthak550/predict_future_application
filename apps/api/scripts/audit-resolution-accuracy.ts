/**
 * Audits the auto-resolve cron's verdicts against actual Yahoo Finance prices.
 *
 * For a sample of recently resolved opinions with a populated instrumentTicker:
 *   1. Pull priceAtCall + priceAtResolution from Yahoo for the call's window
 *   2. Apply the same HIT / MISS / NOT_GRADED logic the AI claims to follow
 *   3. Compare the derived verdict against the stored resolutionStatus
 *   4. Report mismatches with full context so a human can audit
 *
 * AI thresholds (from evaluateOpinionResolution.ts VERDICT_SYSTEM_PROMPT):
 *   - NOT_GRADED if |pctChange| < 1.5% (no clear signal)
 *   - HIT  if BULLISH and pctChange > 0,  or BEARISH and pctChange < 0
 *   - MISS if BULLISH and pctChange < 0,  or BEARISH and pctChange > 0
 *   - NEUTRAL calls: HIT if |pctChange| < 1.5% (range-bound), MISS otherwise
 *
 * Usage:
 *   npx tsx scripts/audit-resolution-accuracy.ts
 *
 * Env:
 *   AUDIT_DAYS=30    — look back window (default 30)
 *   AUDIT_LIMIT=50   — max opinions to check (default 50)
 *   AUDIT_VERBOSE=1  — print every row, not just mismatches
 */

import { prisma } from "../lib/prisma";
import { getPriceOnDate } from "../lib/finance/priceHistory";

const DAYS = parseInt(process.env.AUDIT_DAYS ?? "30", 10);
const LIMIT = parseInt(process.env.AUDIT_LIMIT ?? "50", 10);
const VERBOSE = process.env.AUDIT_VERBOSE === "1";
const NOISE_PCT = 1.5;

type Verdict = "HIT" | "MISS" | "NOT_GRADED";

function deriveVerdict(direction: string, pctChange: number): Verdict {
  if (Math.abs(pctChange) < NOISE_PCT) {
    // Below the noise floor — NEUTRAL calls are arguably right when range-bound,
    // but the AI treats sub-threshold moves as NOT_GRADED regardless.
    return direction === "NEUTRAL" ? "HIT" : "NOT_GRADED";
  }
  if (direction === "BULLISH") return pctChange > 0 ? "HIT" : "MISS";
  if (direction === "BEARISH") return pctChange < 0 ? "HIT" : "MISS";
  // NEUTRAL with significant move → MISS (analyst said flat, market moved)
  return "MISS";
}

function shortVerdict(s: string): Verdict | "UNKNOWN" {
  if (s === "RESOLVED_HIT") return "HIT";
  if (s === "RESOLVED_MISS") return "MISS";
  if (s === "NOT_GRADED") return "NOT_GRADED";
  return "UNKNOWN";
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);

  const sample = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS", "NOT_GRADED"] },
      resolvedAt: { gte: since },
      instrumentTicker: { not: null },
      suppressedAt: null,
    },
    orderBy: { resolvedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      direction: true,
      quote: true,
      instrument: true,
      instrumentTicker: true,
      publishedAt: true,
      resolvedAt: true,
      resolutionStatus: true,
      resolutionNote: true,
      expert: { select: { name: true, organization: true } },
    },
  });

  if (sample.length === 0) {
    console.log(`No resolved opinions with instrumentTicker in the last ${DAYS}d.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Auditing ${sample.length} resolved opinions from last ${DAYS} days...\n`);

  let matches = 0;
  let mismatches = 0;
  let priceUnavailable = 0;
  const mismatchRows: Array<{
    id: string;
    expert: string;
    direction: string;
    instrument: string;
    ticker: string;
    publishedAt: string;
    resolvedAt: string;
    pctChange: string;
    aiVerdict: Verdict | "UNKNOWN";
    derivedVerdict: Verdict;
    aiNote: string;
    quote: string;
  }> = [];

  for (const op of sample) {
    const ticker = op.instrumentTicker!;
    const priceAtCall = await getPriceOnDate(ticker, op.publishedAt);
    const priceAtResolution = op.resolvedAt
      ? await getPriceOnDate(ticker, op.resolvedAt)
      : null;

    if (priceAtCall === null || priceAtResolution === null) {
      priceUnavailable++;
      if (VERBOSE) {
        console.log(
          `  ⏭️  ${op.id}: prices unavailable for ${ticker} (call=${priceAtCall}, resolve=${priceAtResolution})`
        );
      }
      continue;
    }

    const pctChange = ((priceAtResolution - priceAtCall) / priceAtCall) * 100;
    const derived = deriveVerdict(op.direction, pctChange);
    const ai = shortVerdict(op.resolutionStatus);

    if (derived === ai) {
      matches++;
      if (VERBOSE) {
        console.log(
          `  ✅ ${op.id}: ${op.direction} on ${op.instrument} → ${ai} (actual ${pctChange.toFixed(2)}%)`
        );
      }
    } else {
      mismatches++;
      mismatchRows.push({
        id: op.id,
        expert: op.expert.name ?? op.expert.organization,
        direction: op.direction,
        instrument: op.instrument ?? "?",
        ticker,
        publishedAt: op.publishedAt.toISOString().slice(0, 10),
        resolvedAt: op.resolvedAt?.toISOString().slice(0, 10) ?? "?",
        pctChange: `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%`,
        aiVerdict: ai,
        derivedVerdict: derived,
        aiNote: op.resolutionNote ?? "(none)",
        quote: op.quote.slice(0, 100),
      });
    }
  }

  const checkable = matches + mismatches;
  const matchPct = checkable > 0 ? Math.round((matches / checkable) * 100) : 0;

  console.log(`\n${"=".repeat(72)}`);
  console.log("AUDIT SUMMARY");
  console.log(`${"=".repeat(72)}`);
  console.log(`  Sampled:               ${sample.length}`);
  console.log(`  Prices unavailable:    ${priceUnavailable} (excluded)`);
  console.log(`  Checkable:             ${checkable}`);
  console.log(`  ✅ Match:              ${matches} (${matchPct}%)`);
  console.log(`  🚨 Mismatch:           ${mismatches} (${100 - matchPct}%)`);

  if (mismatchRows.length > 0) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`MISMATCHES — AI verdict differs from price-derived verdict`);
    console.log(`${"=".repeat(72)}`);
    for (const m of mismatchRows) {
      console.log(`\n  [${m.id}]`);
      console.log(`    Expert:        ${m.expert}`);
      console.log(`    Call:          ${m.direction} on ${m.instrument} (${m.ticker})`);
      console.log(`    Window:        ${m.publishedAt}  →  ${m.resolvedAt}   (${m.pctChange})`);
      console.log(`    AI verdict:    ${m.aiVerdict}   ← stored in DB`);
      console.log(`    Derived:       ${m.derivedVerdict}   ← from Yahoo prices`);
      console.log(`    AI note:       ${m.aiNote}`);
      console.log(`    Quote:         "${m.quote}..."`);
    }
  } else {
    console.log(`\n  ✨ No mismatches in this sample.`);
  }

  await prisma.$disconnect();
}

void main();
