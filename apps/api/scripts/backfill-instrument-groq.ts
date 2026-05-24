/**
 * Backfill instrument + ticker on opinions where the keyword map missed.
 * Uses extractInstrumentFromQuote which falls back to Groq AI for unknown
 * stocks/instruments.
 *
 * Usage:
 *   npx tsx scripts/backfill-instrument-groq.ts
 *
 * Env:
 *   GROQ_API_KEY — required for AI fallback
 *   LIMIT=200    — opinions per run (default 200)
 *   DELAY_MS=400 — between AI calls to respect rate limits (default 400)
 */

import { prisma } from "../lib/prisma";
import { extractInstrumentFromQuote } from "../lib/ai/extractInstrument";

const LIMIT = parseInt(process.env.LIMIT ?? "200", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? "400", 10);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const ops = await prisma.expertOpinion.findMany({
    where: {
      instrument: null,
      suppressedAt: null,
      isSourceAttribution: false,
    },
    select: {
      id: true,
      quote: true,
      story: { select: { headline: true } },
    },
    take: LIMIT,
  });

  console.log(`Found ${ops.length} opinions needing instrument extraction\n`);
  let matched = 0;
  let unknown = 0;
  let errored = 0;

  for (const [i, op] of ops.entries()) {
    const headline = op.story?.headline ?? "";
    try {
      const result = await extractInstrumentFromQuote(op.quote, headline);
      if (result) {
        await prisma.expertOpinion.update({
          where: { id: op.id },
          data: { instrument: result.instrument, instrumentTicker: result.ticker },
        });
        matched++;
        if ((i + 1) % 10 === 0) {
          console.log(`  [${i + 1}/${ops.length}] ${result.instrument} (${result.ticker}) — matched ${matched}, unknown ${unknown}`);
        }
      } else {
        unknown++;
      }
    } catch (err) {
      errored++;
      console.warn(`  [${i + 1}] error: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nSummary: ${matched} matched, ${unknown} unknown, ${errored} errored, ${ops.length} processed`);
  await prisma.$disconnect();
}

void main();
