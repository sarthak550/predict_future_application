/**
 * Fix markets that have "How many" / "What will" titles but are incorrectly typed as BINARY.
 * Converts them to NUMERIC with sensible defaults.
 * Run with: npx tsx scripts/fix-numeric-markets.ts
 */
import { prisma } from "../lib/prisma";

const NUMERIC_TITLE_PATTERNS = /^(how many|how much|what will|what percentage|what is the|what are the|how long|how far|how high|how low|what percent)/i;

// Sensible defaults based on question context
function guessNumericParams(title: string): { unit: string; minValue: number; maxValue: number; precision: number } {
  const lower = title.toLowerCase();

  if (lower.includes("runs") || lower.includes("score") || lower.includes("points")) {
    return { unit: "points", minValue: 0, maxValue: 200, precision: 0 };
  }
  if (lower.includes("seats") || lower.includes("wins")) {
    return { unit: "seats", minValue: 0, maxValue: 300, precision: 0 };
  }
  if (lower.includes("jobs") || lower.includes("people") || lower.includes("million")) {
    return { unit: "million", minValue: 0, maxValue: 100, precision: 1 };
  }
  if (lower.includes("flights") || lower.includes("products") || lower.includes("days")) {
    return { unit: "count", minValue: 0, maxValue: 100, precision: 0 };
  }
  if (lower.includes("construction sites") || lower.includes("adopt")) {
    return { unit: "sites", minValue: 0, maxValue: 10000, precision: 0 };
  }
  if (lower.includes("dividend") || lower.includes("yield") || lower.includes("percent")) {
    return { unit: "%", minValue: 0, maxValue: 20, precision: 2 };
  }

  return { unit: "value", minValue: 0, maxValue: 100, precision: 0 };
}

async function main() {
  const markets = await prisma.market.findMany({
    where: {
      marketType: "BINARY",
    },
    select: {
      id: true,
      title: true,
    },
  });

  const toFix = markets.filter((m) => NUMERIC_TITLE_PATTERNS.test(m.title));

  console.log(`Found ${toFix.length} BINARY markets that should be NUMERIC:\n`);

  for (const market of toFix) {
    const params = guessNumericParams(market.title);
    console.log(`  "${market.title.slice(0, 70)}..."`);
    console.log(`    → NUMERIC: ${params.unit}, range ${params.minValue}-${params.maxValue}, precision ${params.precision}`);

    await prisma.market.update({
      where: { id: market.id },
      data: {
        marketType: "NUMERIC",
        unit: params.unit,
        minValue: params.minValue,
        maxValue: params.maxValue,
        precision: params.precision,
      },
    });
  }

  console.log(`\nFixed ${toFix.length} markets.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
