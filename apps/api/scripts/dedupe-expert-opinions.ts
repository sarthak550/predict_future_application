/**
 * Deterministic DB cleanup of expert-opinion conflicts that the AI re-extract
 * backfill can't practically reach (Groq rate limits, exhausted free-tier token
 * budget, non-approved/old sources). Applies the SAME merge rules the extraction
 * prompt + in-memory backstop enforce — directly to the stored rows, no AI calls.
 *
 * Grouping: (storyId, expertId, canonical-instrument). Canonical instrument =
 *   normalizeYahooTicker(instrumentTicker)  ||  instrument  ||  checkTickerMap(quote, headline)
 * (checkTickerMap is the free keyword map — no AI). Rows with no derivable instrument
 * are LEFT ALONE (never grouped on "unknown").
 *
 * Per group with >1 row (mirrors collapseGroup in extractExpertOpinions.ts):
 *   - all SAME direction       -> keep the best row, suppress the rest
 *   - directional + NEUTRAL     -> keep the best DIRECTIONAL row, suppress the rest
 *   - BULLISH + BEARISH         -> suppress ALL (true conflict = artifact; never pick a side)
 * "best" = prefer a RESOLVED (HIT/MISS) row over PENDING, then most votes, then longest
 * quote, then newest createdAt.
 *
 * SAFE BY DEFAULT: dry-run unless --apply. Suppression (reversible) by default; --delete
 * hard-deletes (cascades votes — fine for disposable test data). --undo reverses a prior
 * suppression run (clears suppressedAt where resolutionNote LIKE '[deduped:%]').
 *
 * Usage (from apps/api):
 *   npx tsx scripts/dedupe-expert-opinions.ts                 # dry run, prints plan
 *   npx tsx scripts/dedupe-expert-opinions.ts --apply         # suppress losers
 *   npx tsx scripts/dedupe-expert-opinions.ts --apply --delete
 *   npx tsx scripts/dedupe-expert-opinions.ts --undo          # revert a suppress run
 */
import { canonicalInstrumentKey } from "../lib/finance/opinionConflictKey";
import { prisma } from "../lib/prisma";

const APPLY = process.argv.includes("--apply");
const DELETE = process.argv.includes("--delete");
const UNDO = process.argv.includes("--undo");

type Row = {
  id: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  resolutionStatus: string;
  createdAt: Date;
  quote: string;
  votes: number;
};

const isResolved = (s: string) => s === "RESOLVED_HIT" || s === "RESOLVED_MISS";

/** best-first: resolved > more votes > longer quote > newer */
function rankBest(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    if (isResolved(a.resolutionStatus) !== isResolved(b.resolutionStatus)) {
      return isResolved(a.resolutionStatus) ? -1 : 1;
    }
    if (b.votes !== a.votes) return b.votes - a.votes;
    if (b.quote.length !== a.quote.length) return b.quote.length - a.quote.length;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

async function runUndo() {
  const undone = await prisma.expertOpinion.updateMany({
    where: { suppressedAt: { not: null }, resolutionNote: { startsWith: "[deduped:" } },
    data: { suppressedAt: null },
  });
  console.log(`Cleared suppressedAt on ${undone.count} rows previously deduped.`);
  await prisma.$disconnect();
}

async function main() {
  if (UNDO) return runUndo();

  const opinions = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, storyId: { not: null } },
    select: {
      id: true,
      storyId: true,
      direction: true,
      resolutionStatus: true,
      createdAt: true,
      quote: true,
      instrument: true,
      instrumentTicker: true,
      expert: { select: { name: true, organization: true } },
      story: { select: { headline: true } },
      _count: { select: { votes: true } },
    },
  });

  const groups = new Map<string, typeof opinions>();
  let ungroupable = 0;
  for (const o of opinions) {
    const inst = canonicalInstrumentKey({
      instrumentTicker: o.instrumentTicker,
      instrument: o.instrument,
      quote: o.quote,
      headline: o.story?.headline ?? "",
    });
    if (!inst) {
      ungroupable++;
      continue;
    }
    const key = `${o.storyId}::${o.expert.name}::${o.expert.organization}::${inst}`;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }

  const toSuppress: string[] = [];
  const suppressReason = new Map<string, string>(); // id -> breadcrumb
  let conflictGroups = 0;
  let dupGroups = 0;

  for (const [, raw] of groups) {
    if (raw.length <= 1) continue;
    const rows: Row[] = raw.map((r) => ({
      id: r.id,
      direction: r.direction,
      resolutionStatus: r.resolutionStatus,
      createdAt: r.createdAt,
      quote: r.quote,
      votes: r._count.votes,
    }));

    const dirs = new Set(rows.map((r) => r.direction));
    const r0 = raw[0]!;
    const label = `${r0.expert.name || r0.expert.organization} on ${r0.instrumentTicker ?? r0.instrument}`;

    if (dirs.has("BULLISH") && dirs.has("BEARISH")) {
      // True conflict — suppress every row in the group.
      conflictGroups++;
      console.log(`\n⚔️  CONFLICT [${[...dirs].join("+")}] ${label} — suppressing ALL ${rows.length}`);
      for (const r of rows) {
        toSuppress.push(r.id);
        suppressReason.set(r.id, "[deduped:conflict]");
        console.log(`     ✗ ${r.direction.padEnd(7)} ${r.resolutionStatus.padEnd(13)} votes=${r.votes} ${r.id}`);
      }
      continue;
    }

    // Otherwise keep the best row of the winning direction.
    dupGroups++;
    const winningDir = dirs.has("BULLISH") ? "BULLISH" : dirs.has("BEARISH") ? "BEARISH" : "NEUTRAL";
    const candidates = rows.filter((r) => r.direction === winningDir);
    const survivor = rankBest(candidates)[0]!;
    console.log(`\n· DUP [${[...dirs].join("+")}] ${label} — keep ${winningDir}, drop ${rows.length - 1}`);
    for (const r of rows) {
      if (r.id === survivor.id) {
        console.log(`     ✓ keep ${r.direction.padEnd(7)} ${r.resolutionStatus.padEnd(13)} votes=${r.votes} ${r.id}`);
      } else {
        toSuppress.push(r.id);
        suppressReason.set(r.id, `[deduped:loser-of ${survivor.id}]`);
        console.log(`     ✗ drop ${r.direction.padEnd(7)} ${r.resolutionStatus.padEnd(13)} votes=${r.votes} ${r.id}`);
      }
    }
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Scanned visible opinions:    ${opinions.length}`);
  console.log(`  Ungroupable (no instrument): ${ungroupable}  (left untouched)`);
  console.log(`  Duplicate groups:            ${dupGroups}`);
  console.log(`  Conflict groups:             ${conflictGroups}`);
  console.log(`  Rows to ${DELETE ? "DELETE" : "SUPPRESS"}:            ${toSuppress.length}`);
  console.log(`═══════════════════════════════════════════`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to ${DELETE ? "delete" : "suppress"} the ✗ rows.`);
    await prisma.$disconnect();
    return;
  }

  if (toSuppress.length === 0) {
    console.log(`\nNothing to do.`);
    await prisma.$disconnect();
    return;
  }

  if (DELETE) {
    const res = await prisma.expertOpinion.deleteMany({ where: { id: { in: toSuppress } } });
    console.log(`\n🗑️  Hard-deleted ${res.count} rows (votes cascaded).`);
  } else {
    const now = new Date();
    let done = 0;
    for (const id of toSuppress) {
      await prisma.expertOpinion.update({
        where: { id },
        data: { suppressedAt: now, resolutionNote: suppressReason.get(id) ?? "[deduped]" },
      });
      done++;
    }
    console.log(`\n🔇 Suppressed ${done} rows (reversible: --undo).`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
