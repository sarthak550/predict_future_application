import type { BondSeries } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Bonds informational layer — server-to-server fetchers, same direct-Prisma
 * convention as lib/finance/instrument.ts: apps/web runs Prisma directly
 * against the shared DB for read-side domain queries rather than hopping
 * HTTP to apps/api. `BondEodQuote` is written by apps/api's
 * market-moves-movers EOD cron pass (see
 * apps/api/lib/marketMoves/bhavcopy.ts + bondName.ts) — this file is
 * read-only.
 *
 * Informational only: no field here is ever paper-tradable — there is
 * deliberately no order-ticket/buy-button surface anywhere downstream of
 * these fetchers. See the Bonds informational-layer brief's "Explicitly OUT
 * of scope" section.
 */

const SPARK_SESSIONS_CAP = 400; // generous ceiling — bonds ingest is young (starts accruing from this ticket's deploy), never near this in practice

export interface BondQuote {
  sessionDate: Date;
  close: number;
  prevClose: number;
  changePercent: number;
  volume: number;
}

export interface BondSparkPoint {
  sessionDate: Date;
  close: number;
}

export interface BondDetail {
  symbol: string;
  series: BondSeries;
  displayName: string;
  quote: BondQuote;
  /** Full accumulated history for this symbol, oldest first — starts only from whenever ingest began; no backfill. */
  spark: BondSparkPoint[];
}

/** Fetches one bond's latest quote + full accumulated price history. Returns null when the symbol has no BondEodQuote rows at all. */
export async function fetchBondDetail(rawSymbol: string): Promise<BondDetail | null> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return null;

  const [latest, sparkRows] = await Promise.all([
    prisma.bondEodQuote.findFirst({
      where: { symbol },
      orderBy: { sessionDate: "desc" },
    }),
    prisma.bondEodQuote.findMany({
      where: { symbol },
      orderBy: { sessionDate: "asc" },
      take: SPARK_SESSIONS_CAP,
      select: { sessionDate: true, close: true },
    }),
  ]);

  if (!latest) return null;

  return {
    symbol: latest.symbol,
    series: latest.series,
    displayName: latest.displayName,
    quote: {
      sessionDate: latest.sessionDate,
      close: latest.close,
      prevClose: latest.prevClose,
      changePercent: latest.changePercent,
      volume: latest.volume,
    },
    spark: sparkRows,
  };
}

/**
 * Extracts a GS symbol's maturity year for the listing page's sort (e.g.
 * "1018GS2026" -> 2026). Returns null for GB (no comparable single maturity
 * — SGB tenor/early-redemption windows are out of this ticket's scope, see
 * the brief) or any GS symbol that doesn't match the expected pattern —
 * those fall back to alphabetical-by-symbol ordering.
 */
function parseGsMaturityYear(symbol: string, series: BondSeries): number | null {
  if (series !== "GS") return null;
  const m = /^(\d{3,4})GS(\d{4})$/.exec(symbol);
  return m ? Number(m[2]) : null;
}

export interface BondListingRow {
  symbol: string;
  series: BondSeries;
  displayName: string;
  close: number;
  changePercent: number;
  maturityYear: number | null;
}

export interface BondsListing {
  sessionDate: Date;
  governmentSecurities: BondListingRow[];
  sovereignGoldBonds: BondListingRow[];
}

/** Fetches every bond's latest session, grouped by series. Returns null when BondEodQuote is entirely empty (ingest hasn't run yet). */
export async function fetchBondsListing(): Promise<BondsListing | null> {
  const latestSession = await prisma.bondEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  if (!latestSession) return null;

  const rows = await prisma.bondEodQuote.findMany({
    where: { sessionDate: latestSession.sessionDate },
    orderBy: { symbol: "asc" },
    select: { symbol: true, series: true, displayName: true, close: true, changePercent: true },
  });

  const toRow = (r: (typeof rows)[number]): BondListingRow => ({
    symbol: r.symbol,
    series: r.series,
    displayName: r.displayName,
    close: r.close,
    changePercent: r.changePercent,
    maturityYear: parseGsMaturityYear(r.symbol, r.series),
  });

  const all = rows.map(toRow);

  // GS: nearest-maturity-first (more useful than alphabetical for a bond
  // list — see the brief's T5 acceptance note); unparseable symbols sort
  // last by pushing them to the end via a large sentinel, then alphabetical.
  const governmentSecurities = all
    .filter((r) => r.series === "GS")
    .sort((a, b) => (a.maturityYear ?? Infinity) - (b.maturityYear ?? Infinity) || a.symbol.localeCompare(b.symbol));

  const sovereignGoldBonds = all.filter((r) => r.series === "GB").sort((a, b) => a.symbol.localeCompare(b.symbol));

  return { sessionDate: latestSession.sessionDate, governmentSecurities, sovereignGoldBonds };
}
