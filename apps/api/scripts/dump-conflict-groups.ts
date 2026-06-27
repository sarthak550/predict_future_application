/**
 * READ-ONLY. Dumps every bull+bear conflict group (same expert, same story, same
 * canonical instrument) as JSON to stdout, with full member quotes, so the grouping
 * can be audited before any bulk suppression. Mutates nothing.
 *
 * Usage: npx tsx scripts/dump-conflict-groups.ts > /tmp/conflict-groups.json
 */
import { canonicalInstrumentKey } from "../lib/finance/opinionConflictKey";
import { prisma } from "../lib/prisma";

async function main() {
  const opinions = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, storyId: { not: null } },
    select: {
      id: true,
      storyId: true,
      direction: true,
      resolutionStatus: true,
      quote: true,
      instrument: true,
      instrumentTicker: true,
      expert: { select: { name: true, organization: true } },
      story: { select: { headline: true } },
    },
  });

  const groups = new Map<string, typeof opinions>();
  for (const o of opinions) {
    const inst = canonicalInstrumentKey({
      instrumentTicker: o.instrumentTicker,
      instrument: o.instrument,
      quote: o.quote,
      headline: o.story?.headline ?? "",
    });
    if (!inst) continue;
    const key = `${o.storyId}::${o.expert.name}::${o.expert.organization}::${inst}`;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }

  const out: unknown[] = [];
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue;
    const dirs = new Set(rows.map((r) => r.direction));
    if (!(dirs.has("BULLISH") && dirs.has("BEARISH"))) continue; // conflicts only
    const r0 = rows[0]!;
    out.push({
      groupKey: key,
      expert: r0.expert.name || r0.expert.organization,
      canonicalInstrument: canonicalInstrumentKey({
        instrumentTicker: r0.instrumentTicker,
        instrument: r0.instrument,
        quote: r0.quote,
        headline: r0.story?.headline ?? "",
      }),
      storyHeadline: r0.story?.headline ?? "",
      memberCount: rows.length,
      members: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        resolutionStatus: r.resolutionStatus,
        storedInstrument: r.instrument,
        storedTicker: r.instrumentTicker,
        reResolved: canonicalInstrumentKey({
          instrumentTicker: r.instrumentTicker,
          instrument: r.instrument,
          quote: r.quote,
          headline: r.story?.headline ?? "",
        }),
        quote: r.quote,
      })),
    });
  }

  process.stdout.write(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
