/**
 * One-off repair for opinions mis-filed under "closest proxy" indices
 * (founder correction 2026-08-10: "Nifty Infra and Nifty Capital Goods are
 * not same"). The extraction keyword map used to force-map:
 *   "capital goods"      -> fabricated "Nifty Capital Goods" + ^CNXCAPITAL, remapped to ^CNXINFRA
 *   "consumer durables"  -> "Nifty Consumer Durables" + NIFTYCONDUR.NS, remapped to ^CNXFMCG
 * so capital-goods opinions linked to the Infrastructure index page and
 * consumer-durables opinions to FMCG. The map entries are now removed
 * (see extractInstrument.ts's TICKER_REMAP doc comment); this script fixes
 * the rows already written:
 *   - instrument "Nifty Capital Goods" -> instrument "Capital Goods sector",
 *     ticker null (NSE has NO capital-goods index — the old label named an
 *     index that does not exist).
 *   - instrument "Nifty Consumer Durables" -> ticker null, name kept (the
 *     NSE index is real; it just has no verified data feed, so no link).
 *   - any other stragglers still carrying ^CNXCAPITAL / NIFTYCONDUR.NS -> ticker null.
 *
 * DRY_RUN by default; --live to write. Idempotent.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LIVE = process.argv.includes("--live");

async function main() {
  console.log(`[fix-proxy-index-opinions] Starting (${LIVE ? "LIVE" : "DRY RUN — no writes"})...`);

  const capitalGoods = await prisma.expertOpinion.findMany({
    where: { instrument: { equals: "Nifty Capital Goods", mode: "insensitive" } },
    select: { id: true, instrument: true, instrumentTicker: true, quote: true },
  });
  console.log(`[fix-proxy-index-opinions] "Nifty Capital Goods" rows: ${capitalGoods.length}`);
  for (const op of capitalGoods) {
    console.log(`  ${LIVE ? "[fix]" : "[would-fix]"} id=${op.id} ticker=${op.instrumentTicker} -> instrument="Capital Goods sector" ticker=null (quote: "${op.quote?.slice(0, 60)}...")`);
  }

  const consumerDurables = await prisma.expertOpinion.findMany({
    where: {
      instrument: { equals: "Nifty Consumer Durables", mode: "insensitive" },
      instrumentTicker: { not: null },
    },
    select: { id: true, instrumentTicker: true, quote: true },
  });
  console.log(`[fix-proxy-index-opinions] "Nifty Consumer Durables" rows with a ticker: ${consumerDurables.length}`);
  for (const op of consumerDurables) {
    console.log(`  ${LIVE ? "[fix]" : "[would-fix]"} id=${op.id} ticker=${op.instrumentTicker} -> ticker=null (name kept — real NSE index, no verified feed)`);
  }

  const stragglers = await prisma.expertOpinion.findMany({
    where: {
      instrumentTicker: { in: ["^CNXCAPITAL", "NIFTYCONDUR.NS"] },
      NOT: { instrument: { in: ["Nifty Capital Goods", "Nifty Consumer Durables"], mode: "insensitive" } },
    },
    select: { id: true, instrument: true, instrumentTicker: true },
  });
  console.log(`[fix-proxy-index-opinions] Straggler rows on the dead proxy tickers: ${stragglers.length}`);
  for (const op of stragglers) {
    console.log(`  ${LIVE ? "[fix]" : "[would-fix]"} id=${op.id} instrument="${op.instrument}" ticker=${op.instrumentTicker} -> ticker=null`);
  }

  if (LIVE) {
    const a = await prisma.expertOpinion.updateMany({
      where: { instrument: { equals: "Nifty Capital Goods", mode: "insensitive" } },
      data: { instrument: "Capital Goods sector", instrumentTicker: null },
    });
    const b = await prisma.expertOpinion.updateMany({
      where: { instrument: { equals: "Nifty Consumer Durables", mode: "insensitive" }, instrumentTicker: { not: null } },
      data: { instrumentTicker: null },
    });
    const c = await prisma.expertOpinion.updateMany({
      where: { instrumentTicker: { in: ["^CNXCAPITAL", "NIFTYCONDUR.NS"] } },
      data: { instrumentTicker: null },
    });
    console.log(`[fix-proxy-index-opinions] Wrote: capitalGoods=${a.count} consumerDurables=${b.count} stragglers=${c.count}`);
  } else {
    console.log("[fix-proxy-index-opinions] Dry run only. Re-run with --live to persist.");
  }
}

main()
  .catch((err) => {
    console.error("[fix-proxy-index-opinions] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
