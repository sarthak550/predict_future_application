/**
 * S43 cleanup — retroactively apply the new deterministic quality gates
 * (Layer 2 from the audit) to existing ExpertOpinion rows.
 *
 * What it does, in order:
 *   1. Re-run the keyword instrument resolver on every visible opinion. If the
 *      old extraction left instrument NULL but the new sectoral keywords now
 *      match the quote, populate instrument + instrumentTicker.
 *   2. Suppress opinions that fail the deterministic gates:
 *      - quote length < 80 chars   → reason: "quote too short"
 *      - instrument still NULL     → reason: "no instrument"
 *      - non-sector quote that lacks a numeric anchor
 *        (no digit run AND no unit token like ₹/Rs/%/points/target/support/resistance)
 *        → reason: "no numeric anchor"
 *
 * Sector quotes (instrumentTicker starting with ^CNX or matching ^NSEBANK)
 * are exempt from the numeric-anchor check — "bullish on capital goods" is a
 * valid gradable call.
 *
 * IMPORTANT — no AI calls.
 * The script calls extractInstrumentFromQuote, which falls back to Groq when
 * the keyword map misses. To keep this cleanup deterministic and free, run
 * it with GROQ_API_KEY="" so the AI fallback short-circuits. Confidence floor
 * (0.82) is NOT applied retroactively — confidence isn't stored as a column.
 *
 * Usage (DRY RUN — recommended first):
 *   GROQ_API_KEY="" npx tsx scripts/cleanup-expert-opinions.ts --dry-run
 *
 * Usage (apply changes):
 *   GROQ_API_KEY="" npx tsx scripts/cleanup-expert-opinions.ts
 */

import { extractInstrumentFromQuote } from "../lib/ai/extractInstrument";
import { prisma } from "../lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");
const MIN_QUOTE_LEN = 80;
const NUMERIC_PATTERN = /\d{2,}/;
const UNIT_PATTERN = /(₹|Rs\.?|%|points|target|support|resistance)/i;

/** Sectoral indices are exempt from the numeric-anchor gate. */
function isSectorTicker(ticker: string | null | undefined): boolean {
  if (!ticker) return false;
  return ticker.startsWith("^CNX") || ticker === "^NSEBANK";
}

/**
 * Returns true if the quote/headline contains a sectoral keyword that resolves
 * to an Indian sectoral index — regardless of what's already stored in the
 * opinion's `instrumentTicker` column. Older opinions written before the S43
 * keyword extension can have a stale non-sector ticker ("Metals" with no
 * proper Yahoo symbol) while the quote is clearly a sectoral call. We use the
 * fresh resolver here so those still get exempted from the numeric-anchor gate.
 */
async function quoteIsSectoral(quote: string, headline: string): Promise<boolean> {
  try {
    const resolved = await extractInstrumentFromQuote(quote, headline);
    return isSectorTicker(resolved?.ticker);
  } catch {
    return false;
  }
}

type Reason = "quote too short" | "no instrument" | "no numeric anchor";

async function main(): Promise<void> {
  console.log(`[cleanup] mode = ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const opinions = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null },
    select: {
      id: true,
      quote: true,
      instrument: true,
      instrumentTicker: true,
      direction: true,
      isSourceAttribution: true,
      story: { select: { headline: true } },
    },
  });

  console.log(`[cleanup] scanning ${opinions.length} visible opinion(s)`);

  let backfilled = 0;
  let suppressed = 0;
  const reasonCounts: Record<Reason, number> = {
    "quote too short": 0,
    "no instrument": 0,
    "no numeric anchor": 0,
  };

  for (const op of opinions) {
    const headline = op.story?.headline ?? "";
    let instrument = op.instrument;
    let instrumentTicker = op.instrumentTicker;

    // 1. Backfill instrument when null using the (now-extended) keyword map.
    if (!instrument) {
      try {
        const extracted = await extractInstrumentFromQuote(op.quote, headline);
        if (extracted) {
          instrument = extracted.instrument;
          instrumentTicker = extracted.ticker;
          backfilled++;
          if (!DRY_RUN) {
            await prisma.expertOpinion.update({
              where: { id: op.id },
              data: { instrument, instrumentTicker },
            });
          }
        }
      } catch (err) {
        console.warn(
          `[cleanup] instrument extraction threw on ${op.id}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    // 2. Apply Layer 2 gates and decide whether to suppress.
    let reason: Reason | null = null;
    if (op.quote.length < MIN_QUOTE_LEN) {
      reason = "quote too short";
    } else if (!instrument) {
      reason = "no instrument";
    } else if (!(NUMERIC_PATTERN.test(op.quote) && UNIT_PATTERN.test(op.quote))) {
      // No numeric anchor in the quote. Exempt if EITHER the stored ticker
      // is sectoral, OR the quote text itself contains a sectoral keyword
      // (handles older opinions whose stored ticker is stale).
      const exempt =
        isSectorTicker(instrumentTicker) || (await quoteIsSectoral(op.quote, headline));
      if (!exempt) {
        reason = "no numeric anchor";
      }
    }

    if (reason) {
      suppressed++;
      reasonCounts[reason]++;
      if (!DRY_RUN) {
        await prisma.expertOpinion.update({
          where: { id: op.id },
          data: { suppressedAt: new Date() },
        });
      }
    }
  }

  console.log("\n[cleanup] summary");
  console.log(`  scanned:    ${opinions.length}`);
  console.log(`  backfilled: ${backfilled} (instrument resolved from quote)`);
  console.log(`  suppressed: ${suppressed}`);
  for (const [r, n] of Object.entries(reasonCounts)) {
    if (n > 0) console.log(`    - ${r}: ${n}`);
  }
  if (DRY_RUN) {
    console.log("\n[cleanup] DRY RUN — no rows were modified.");
    console.log("Re-run without --dry-run to apply.");
  } else {
    console.log("\n[cleanup] done.");
  }
}

main()
  .catch((err) => {
    console.error("[cleanup] fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
