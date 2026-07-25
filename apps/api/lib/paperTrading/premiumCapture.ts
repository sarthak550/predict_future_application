/**
 * Trading Terminal UI Overhaul (Sprint A, T3) — premium-history capture
 * orchestration for POST /api/cron/paper-trading-premium-capture.
 *
 * Writes one OptionPremiumSnapshot row per CE/PE quote (that has a lastPrice
 * or a bid/ask) for ATM ± 5 strikes, for the UNION of:
 *   1. Every (underlyingSymbol, expiryDate) with at least one open option
 *      position across any account.
 *   2. Every (underlyingSymbol, expiryDate) requested through the chain
 *      endpoint in roughly the last 15 minutes (getRecentlyViewedContracts).
 *
 * All pure math (ATM-nearest-strike selection) lives inline here — it's a
 * three-line reduce, not worth a business-rules module of its own, and
 * mirrors option-chain-browser.tsx's client-side ATM calculation exactly (same
 * "nearest to underlyingValue" definition) so the captured history's ATM
 * framing matches what the ladder UI itself highlights.
 *
 * DB + upstream orchestration only — no engine writes, no PaperOrder touched.
 * Market data, not account data (see the schema doc on OptionPremiumSnapshot).
 */

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import { deriveOptionPositions, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";
import { formatNseExpiryDate, parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { fetchOptionChain, getRecentlyViewedContracts, isIndexUnderlying, type OptionChainSnapshot } from "@/lib/marketMoves/optionChain";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const ENGINE_ORDER_SELECT = {
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  fillPrice: true,
  totalCosts: true,
  netAmount: true,
  createdAt: true,
  instrumentKind: true,
  underlyingSymbol: true,
  optionType: true,
  strikePrice: true,
  expiryDate: true,
  lotSize: true
} as const;

/** Strikes shown each side of ATM — matches the brief's spec exactly (11 rows total when the chain has enough depth). */
const STRIKES_AROUND_ATM = 5;
const RECENTLY_VIEWED_WINDOW_MS = 15 * 60_000;

export interface PremiumCaptureRunResult {
  ranOutsideMarketHours: boolean;
  candidateContracts: number;
  chainFetchFailures: number;
  snapshotsWritten: number;
  errors: number;
}

interface Candidate {
  underlying: string;
  expiryStr: string; // NSE "DD-MMM-YYYY"
}

function candidateKey(c: Candidate): string {
  return `${c.underlying}::${c.expiryStr}`;
}

/**
 * Scans every account with at least one option order and collects the
 * (underlyingSymbol, expiryDate) pairs it currently holds an open position in
 * — generalized from optionsExpiry.ts's "expiring today" scan to "any open
 * position, regardless of expiry date" per the brief. Paper Trading trade
 * volumes are low (single-retail-feature scale, same assumption every other
 * read-side query in this domain already makes — see queries.ts), so a
 * per-account replay is cheap here.
 */
async function collectOpenPositionCandidates(): Promise<Candidate[]> {
  const accountsWithOptionOrders = await prisma.paperOrder.findMany({
    where: { instrumentKind: { in: ["INDEX_OPTION", "STOCK_OPTION"] } },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  const seen = new Map<string, Candidate>();
  for (const { accountId } of accountsWithOptionOrders) {
    const orderRows = await prisma.paperOrder.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const orders = orderRows as unknown as PaperEngineOrder[];
    for (const position of deriveOptionPositions(orders)) {
      const candidate: Candidate = { underlying: position.underlyingSymbol, expiryStr: formatNseExpiryDate(position.expiryDate) };
      seen.set(candidateKey(candidate), candidate);
    }
  }
  return [...seen.values()];
}

function collectRecentlyViewedCandidates(): Candidate[] {
  return getRecentlyViewedContracts(RECENTLY_VIEWED_WINDOW_MS).map((c) => ({ underlying: c.underlying, expiryStr: c.expiry }));
}

/** Nearest strike to the chain's own live underlyingValue — same "nearest wins" definition option-chain-browser.tsx uses client-side for its ATM highlight. */
function findAtmStrike(chain: OptionChainSnapshot): number | null {
  if (chain.strikes.length === 0) return null;
  return chain.strikes.reduce((best, s) =>
    Math.abs(s.strikePrice - chain.underlyingValue) < Math.abs(best.strikePrice - chain.underlyingValue) ? s : best
  ).strikePrice;
}

function buildSnapshotRows(chain: OptionChainSnapshot, expiryDate: Date, capturedAt: Date): Prisma.OptionPremiumSnapshotCreateManyInput[] {
  const atmStrike = findAtmStrike(chain);
  if (atmStrike === null) return [];

  const atmIndex = chain.strikes.findIndex((s) => s.strikePrice === atmStrike);
  if (atmIndex < 0) return [];
  const start = Math.max(0, atmIndex - STRIKES_AROUND_ATM);
  const end = Math.min(chain.strikes.length, atmIndex + STRIKES_AROUND_ATM + 1);
  const windowStrikes = chain.strikes.slice(start, end);

  const instrumentKind = isIndexUnderlying(chain.underlying) ? "INDEX_OPTION" : "STOCK_OPTION";
  const rows: Prisma.OptionPremiumSnapshotCreateManyInput[] = [];

  for (const strikeRow of windowStrikes) {
    for (const optionType of ["CE", "PE"] as const) {
      const quote = strikeRow[optionType];
      if (!quote) continue;
      const hasUsableQuote = quote.lastPrice != null || (quote.bidPrice != null && quote.askPrice != null);
      if (!hasUsableQuote) continue; // skip a fully-empty quote — no point storing a null row
      rows.push({
        capturedAt,
        underlyingSymbol: chain.underlying,
        instrumentKind,
        expiryDate,
        strikePrice: strikeRow.strikePrice,
        optionType,
        lastPrice: quote.lastPrice,
        bidPrice: quote.bidPrice,
        askPrice: quote.askPrice,
        underlyingValue: chain.underlyingValue
      });
    }
  }
  return rows;
}

/**
 * Captures one round of ATM ± 5 premium snapshots for every candidate
 * contract. Self-gates on `isNseWeekdayMarketHours()` regardless of when the
 * cron itself fired — a slightly-loose crontab bound (the brief's coarse
 * hour-window filter) never writes off-session ticks. Never throws —
 * per-candidate failures are caught and counted.
 */
export async function runPremiumCapture(now: Date = new Date()): Promise<PremiumCaptureRunResult> {
  const result: PremiumCaptureRunResult = {
    ranOutsideMarketHours: false,
    candidateContracts: 0,
    chainFetchFailures: 0,
    snapshotsWritten: 0,
    errors: 0
  };

  if (!isNseWeekdayMarketHours(now)) {
    result.ranOutsideMarketHours = true;
    return result;
  }

  const [openPositionCandidates, recentlyViewedCandidates] = await Promise.all([
    collectOpenPositionCandidates(),
    Promise.resolve(collectRecentlyViewedCandidates())
  ]);

  const candidatesByKey = new Map<string, Candidate>();
  for (const c of [...openPositionCandidates, ...recentlyViewedCandidates]) candidatesByKey.set(candidateKey(c), c);
  const candidates = [...candidatesByKey.values()];
  result.candidateContracts = candidates.length;

  const allRows: Prisma.OptionPremiumSnapshotCreateManyInput[] = [];
  const capturedAt = new Date();

  for (const candidate of candidates) {
    try {
      const expiryDate = parseNseExpiryDate(candidate.expiryStr);
      if (!expiryDate) {
        result.errors += 1;
        continue;
      }
      const chain = await fetchOptionChain(candidate.underlying, candidate.expiryStr);
      if (!chain) {
        result.chainFetchFailures += 1;
        continue;
      }
      allRows.push(...buildSnapshotRows(chain, expiryDate, capturedAt));
    } catch (err) {
      result.errors += 1;
      console.error(`[paperTrading/premiumCapture] candidate ${candidateKey(candidate)} failed:`, err);
    }
  }

  if (allRows.length > 0) {
    const written = await prisma.optionPremiumSnapshot.createMany({ data: allRows });
    result.snapshotsWritten = written.count;
  }

  return result;
}
