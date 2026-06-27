/**
 * READ-ONLY diagnostic: find expert-opinion conflicts — the same expert holding
 * MORE THAN ONE opinion on the SAME instrument within the SAME article, especially
 * with DIFFERENT directions (the "Bullish + Neutral on Bank Nifty" bug).
 *
 * Groups visible (suppressedAt: null) opinions by (storyId, expertId, instrument)
 * where instrument = instrumentTicker (preferred) or instrument name. Reports every
 * group with >1 row, flags groups with >1 DISTINCT direction as CONFLICTS, and
 * categorizes WHY each conflict survives (re-extractable source? stale or fresh rows?).
 *
 * Run BEFORE and AFTER scripts/reextract-all-opinions.ts to measure the fix.
 * Mutates nothing.
 *
 * Usage: npx tsx scripts/find-opinion-conflicts.ts [--list]
 *   --list  print every conflict group (default prints only the first 25)
 */
import { isApprovedFinanceSource } from "../lib/ai/extractExpertOpinions";
import { canonicalInstrumentKey } from "../lib/finance/opinionConflictKey";
import { prisma } from "../lib/prisma";

const LIST_ALL = process.argv.includes("--list");
// "Fresh" = created within the last 6 hours (i.e. likely written by a recent re-extract run).
const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;

async function main() {
  const freshCutoff = new Date(Date.now() - FRESH_WINDOW_MS);

  const opinions = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, storyId: { not: null } },
    select: {
      id: true,
      storyId: true,
      direction: true,
      instrument: true,
      instrumentTicker: true,
      quote: true,
      resolutionStatus: true,
      sourceUrl: true,
      createdAt: true,
      expert: { select: { name: true, organization: true } },
      story: { select: { headline: true, bodyText: true, summary: true } },
    },
  });

  type Row = (typeof opinions)[number];
  const groups = new Map<string, Row[]>();

  for (const o of opinions) {
    const instKey = canonicalInstrumentKey({
      instrumentTicker: o.instrumentTicker,
      instrument: o.instrument,
      quote: o.quote,
      headline: o.story?.headline ?? "",
    });
    if (!instKey) continue;
    const key = `${o.storyId}::${o.expert.name}::${o.expert.organization}::${instKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }

  // Corpus-level freshness: did the re-extract actually write new rows at all?
  const freshTotal = opinions.filter((o) => o.createdAt >= freshCutoff).length;
  const approvedTotal = opinions.filter((o) => isApprovedFinanceSource(o.sourceUrl)).length;

  let multi = 0;
  let conflicts = 0;
  let conflictRows = 0;
  // Conflict categorization buckets:
  let cReextractable = 0; // approved source + has body → re-extract SHOULD have fixed it
  let cNotApproved = 0; // source not in allowlist → re-extract skips it
  let cNoBody = 0; // approved but no bodyText/summary → re-extract can't run
  let cFresh = 0; // at least one row created recently (conflict produced by a RECENT run!)
  let printed = 0;

  for (const [, rows] of groups) {
    if (rows.length <= 1) continue;
    multi++;
    const dirs = new Set(rows.map((r) => r.direction));
    if (dirs.size <= 1) continue;

    conflicts++;
    conflictRows += rows.length;

    const r0 = rows[0]!;
    const approved = isApprovedFinanceSource(r0.sourceUrl);
    const hasBody = Boolean(r0.story?.bodyText ?? r0.story?.summary);
    const anyFresh = rows.some((r) => r.createdAt >= freshCutoff);
    const distinctTickers = new Set(rows.map((r) => r.instrumentTicker ?? r.instrument ?? "?"));

    if (anyFresh) cFresh++;
    if (!approved) cNotApproved++;
    else if (!hasBody) cNoBody++;
    else cReextractable++;

    const reason = !approved
      ? "SOURCE-NOT-APPROVED (re-extract skips)"
      : !hasBody
        ? "NO-BODY (re-extract can't run)"
        : anyFresh
          ? "RE-EXTRACTABLE + FRESH (prompt/backstop may be failing!)"
          : "RE-EXTRACTABLE + STALE (re-extract didn't replace it)";

    if (LIST_ALL || printed < 25) {
      printed++;
      console.log(
        `\n⚠️  [${[...dirs].join(" + ")}]  ${r0.expert.name || r0.expert.organization}  on  ${r0.instrumentTicker ?? r0.instrument}`
      );
      console.log(`   why: ${reason}`);
      console.log(`   tickers in group: ${[...distinctTickers].join(", ")}   source: ${hostOf(r0.sourceUrl)}`);
      console.log(`   story: ${r0.story?.headline?.slice(0, 80)}`);
      for (const r of rows) {
        const fresh = r.createdAt >= freshCutoff ? "FRESH" : "stale";
        console.log(`     - ${r.direction.padEnd(7)} ${r.resolutionStatus.padEnd(13)} ${fresh}  ${r.id}  "${r.quote.slice(0, 60)}…"`);
      }
    }
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Visible opinions scanned:        ${opinions.length}`);
  console.log(`    …created in last 6h (fresh):   ${freshTotal}   ← if ~0, the re-extract wrote nothing`);
  console.log(`    …from approved finance source: ${approvedTotal}`);
  console.log(`  Groups with >1 row:              ${multi}`);
  console.log(`  DIRECTIONAL CONFLICTS:           ${conflicts}  (${conflictRows} rows)`);
  console.log(`  conflict breakdown (mutually exclusive):`);
  console.log(`    ├─ source NOT approved:        ${cNotApproved}   (re-extract skips these)`);
  console.log(`    ├─ approved but NO body text:  ${cNoBody}   (re-extract can't run)`);
  console.log(`    └─ re-extractable:             ${cReextractable}   (re-extract SHOULD have fixed)`);
  console.log(`  of all conflicts, # with a FRESH row: ${cFresh}   ← ONLY these implicate the prompt/backstop`);
  console.log(`═══════════════════════════════════════════`);
  if (!LIST_ALL && conflicts > 25) console.log(`(showed first 25; re-run with --list to see all)`);

  await prisma.$disconnect();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
