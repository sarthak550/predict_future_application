/**
 * Refreshes stale negative-cache InstrumentAlias rows for indices that have
 * SINCE become resolvable (founder report 2026-08-10: "Nifty Infra" opinions
 * not clickable despite the new index instrument pages).
 *
 * WHY THIS EXISTS: InstrumentAlias deliberately keeps resolved=false rows as
 * a negative cache ("we checked, unresolvable") so resolveInstrumentAlias
 * never re-attempts a known-failing lookup. That design is correct for
 * genuinely-dead tickers — but it also means extending
 * KNOWN_INDEX_IDENTITIES (Index Universe Sprint A, 2026-08-09) fixes FUTURE
 * lookups while every rawName already cached as unresolvable stays dead
 * forever. This script is the one sanctioned way to re-open exactly those
 * verdicts: it re-checks each resolved=false row ONLY against the static
 * KNOWN_INDEX_IDENTITIES / INDEX_UNIVERSE maps (no network, no fuzzy match,
 * no equity re-resolution) and flips the rows that now have a known identity.
 * Wrong/dead tickers (e.g. "^NIFTY200" — the real NIFTY 200 ticker is
 * "^CNX200") correctly stay negative.
 *
 * DRY_RUN by default; pass --live to write. Idempotent: refreshed rows are
 * resolved=true and fall out of the candidate query.
 *
 * Usage (from apps/api, DATABASE_URL of the target DB in env):
 *   npx tsx scripts/refresh-stale-index-aliases.ts          # preview
 *   npx tsx scripts/refresh-stale-index-aliases.ts --live   # apply
 */
import { PrismaClient } from "@prisma/client";

import { INDEX_UNIVERSE } from "@predict-future/business-rules/finance/indexUniverse";

const prisma = new PrismaClient();
const LIVE = process.argv.includes("--live");

/** Mirrors lib/finance/instrumentAlias.ts's KNOWN_INDEX_IDENTITIES keying (Yahoo ticker), plus the two pre-universe entries. */
const TICKER_IDENTITIES: Record<string, { symbol: string; canonicalName: string }> = {
  "^NSEI": { symbol: "NIFTY", canonicalName: "NIFTY 50" },
  "^NSEBANK": { symbol: "BANKNIFTY", canonicalName: "NIFTY BANK" },
  ...Object.fromEntries(
    INDEX_UNIVERSE.map((e) => [e.yahooTicker, { symbol: e.symbol, canonicalName: e.displayName }]),
  ),
};

/** Label-shaped rawNames (rows created from opinions with no ticker) match on the lowercased NSE display name. */
const NAME_IDENTITIES: Record<string, { symbol: string; canonicalName: string }> = Object.fromEntries(
  INDEX_UNIVERSE.map((e) => [e.displayName.toLowerCase(), { symbol: e.symbol, canonicalName: e.displayName }]),
);

function identityFor(rawName: string): { symbol: string; canonicalName: string } | null {
  return TICKER_IDENTITIES[rawName] ?? NAME_IDENTITIES[rawName.toLowerCase()] ?? null;
}

async function main() {
  console.log(`[refresh-stale-index-aliases] Starting (${LIVE ? "LIVE" : "DRY RUN — no writes"})...`);

  const stale = await prisma.instrumentAlias.findMany({
    where: { resolved: false },
    select: { id: true, rawName: true },
  });
  console.log(`[refresh-stale-index-aliases] ${stale.length} resolved=false row(s) in the negative cache.`);

  const refreshable = stale
    .map((row) => ({ row, identity: identityFor(row.rawName) }))
    .filter((x): x is { row: (typeof stale)[number]; identity: { symbol: string; canonicalName: string } } => x.identity != null);

  console.log(
    `[refresh-stale-index-aliases] ${refreshable.length} row(s) now resolve via KNOWN_INDEX_IDENTITIES/INDEX_UNIVERSE (${stale.length - refreshable.length} stay negative — genuinely unresolvable or wrong tickers):`,
  );
  for (const { row, identity } of refreshable) {
    console.log(`  ${LIVE ? "[fix]" : "[would-fix]"} rawName="${row.rawName}" -> resolved=true symbol=${identity.symbol} ("${identity.canonicalName}")`);
  }

  if (LIVE) {
    const now = new Date();
    for (const { row, identity } of refreshable) {
      await prisma.instrumentAlias.update({
        where: { id: row.id },
        data: {
          resolved: true,
          symbol: identity.symbol,
          canonicalName: identity.canonicalName,
          resolutionSource: "KNOWN_INDEX",
          resolvedAt: now,
        },
      });
    }
    console.log(`[refresh-stale-index-aliases] Wrote ${refreshable.length} row(s).`);
  } else {
    console.log("[refresh-stale-index-aliases] Dry run only. Re-run with --live to persist.");
  }
}

main()
  .catch((err) => {
    console.error("[refresh-stale-index-aliases] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
