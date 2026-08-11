/**
 * BSE Expansion Phase 1 (2026-08-12) — collision check (acceptance-blocking
 * per the assigning brief, mirroring INDEX_UNIVERSE's own collision-check
 * precedent). Computes the `/instruments/[symbol]`-style derived code for
 * every ingested BseIndexEodQuote.indexName (via the SAME
 * deriveIndexSymbol/slugifyIndexName pure functions business-rules already
 * uses for NSE — no second matcher written) and checks it against every
 * existing NSE-side symbol/name universe this app currently owns:
 *
 *   - IndexEodQuote.indexName (NSE's own index universe, all tiers)
 *   - INDEX_UNIVERSE + the 5 tradable underlyings (business-rules)
 *   - StockEodQuote.symbol (NSE equities)
 *   - BondEodQuote (bond names/symbols)
 *
 * Read-only. Run against LOCAL dev first (this ticket's own verification),
 * then the COORDINATOR MUST re-run this identical script against PRODUCTION
 * immediately before deploying anything that derives a BSE index symbol —
 * a new NSE listing between dev-check and deploy is exactly the drift
 * INDEX_UNIVERSE's own module doc already warns about for the identical
 * reason.
 *
 * Usage: npx tsx scripts/check-bse-collisions.ts
 */

import {
  deriveIndexSymbol,
  isIndexUniverseSymbol,
  INDEX_UNIVERSE,
} from "@predict-future/business-rules/finance/indexUniverse";

import { prisma } from "../lib/prisma";

/** The 5 F&O-tradable underlyings' short mnemonic /instruments/ codes — not derivable from their NSE display name, so checked by literal code, same list indexLongTail.ts's own TRADABLE_INDEX_NSE_NAMES documents (here by symbol, not name, since that's what we're diffing against). */
const TRADABLE_UNDERLYING_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);

async function main() {
  const bseIndexNames = await prisma.bseIndexEodQuote.findMany({
    distinct: ["indexName"],
    select: { indexName: true },
  });

  if (bseIndexNames.length === 0) {
    console.log("[check-bse-collisions] No BseIndexEodQuote rows found — run the backfill/cron first.");
    await prisma.$disconnect();
    return;
  }

  const derived = bseIndexNames.map((r) => ({ name: r.indexName, symbol: deriveIndexSymbol(r.indexName) }));

  // Internal self-collision check: two distinct BSE names deriving the same symbol.
  const bySymbol = new Map<string, string[]>();
  for (const { name, symbol } of derived) {
    const list = bySymbol.get(symbol) ?? [];
    list.push(name);
    bySymbol.set(symbol, list);
  }
  const internalDupes = [...bySymbol.entries()].filter(([, names]) => names.length > 1);

  const derivedSymbols = derived.map((d) => d.symbol);

  const [nseIndexNames, stockSymbols, bondRows] = await Promise.all([
    prisma.indexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } }),
    prisma.stockEodQuote.findMany({ where: { symbol: { in: derivedSymbols } }, distinct: ["symbol"], select: { symbol: true } }),
    prisma.bondEodQuote.findMany({ distinct: ["symbol"], select: { symbol: true, displayName: true } }).catch(() => []),
  ]);

  const nseIndexSymbols = new Set(nseIndexNames.map((r) => deriveIndexSymbol(r.indexName)));
  const universeSymbols = new Set(INDEX_UNIVERSE.map((e) => e.symbol));
  const stockSymbolSet = new Set(stockSymbols.map((r) => r.symbol));
  // Bonds are checked both by their raw NSE symbol AS-IS (uppercased, no
  // derivation — e.g. "1018GS2026") and by deriveIndexSymbol applied to their
  // parsed displayName, since either form is a plausible collision surface.
  const bondSymbolSet = new Set([
    ...bondRows.map((r) => r.symbol.trim().toUpperCase()),
    ...bondRows.map((r) => deriveIndexSymbol(r.displayName)),
  ]);

  let collisions = 0;
  for (const { name, symbol } of derived) {
    const hits: string[] = [];
    if (nseIndexSymbols.has(symbol)) hits.push("IndexEodQuote (NSE)");
    if (isIndexUniverseSymbol(symbol) || universeSymbols.has(symbol)) hits.push("INDEX_UNIVERSE");
    if (TRADABLE_UNDERLYING_SYMBOLS.has(symbol)) hits.push("tradable underlying");
    if (stockSymbolSet.has(symbol)) hits.push("StockEodQuote (NSE equity)");
    if (bondSymbolSet.has(symbol)) hits.push("BondEodQuote");
    if (hits.length > 0) {
      collisions++;
      console.log(`[check-bse-collisions] COLLISION: "${name}" -> ${symbol} clashes with ${hits.join(", ")}`);
    }
  }

  console.log(`[check-bse-collisions] Checked ${derived.length} BSE index names.`);
  console.log(`[check-bse-collisions] Internal self-collisions: ${internalDupes.length}`);
  for (const [symbol, names] of internalDupes) {
    console.log(`  ${symbol}: ${names.join(" / ")}`);
  }
  console.log(`[check-bse-collisions] Cross-universe collisions (NSE index/equity/bond): ${collisions}`);
  console.log(collisions === 0 && internalDupes.length === 0 ? "[check-bse-collisions] CLEAN — zero collisions." : "[check-bse-collisions] REVIEW REQUIRED.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[check-bse-collisions] fatal error:", err);
  process.exitCode = 1;
});
