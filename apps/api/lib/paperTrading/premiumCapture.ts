/**
 * Trading Terminal UI Overhaul (Sprint A, T3) — premium-history capture
 * orchestration for POST /api/cron/paper-trading-premium-capture.
 *
 * Writes one OptionPremiumSnapshot row per CE/PE quote (that has a lastPrice
 * or a bid/ask), for the UNION of:
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
 *
 * **Interval-parity capture cadence project (2026-08-07)** — founder,
 * verbatim: "option chain charts are not working properly and why the fuck
 * we do have onli 15m and 30 min sticks, why cant we have same as stocks."
 * Root-caused to two independent gaps, both fixed here:
 *
 * (a) BLANK CHARTS — the capture window was ATM ± 5 strikes only, so any
 * contract a trader actually opened outside that narrow band had zero
 * archived history and read as "broken," not "not yet captured." Widened to
 * ATM ± 10 (`STRIKES_AROUND_ATM`) — live-measured against real NSE chains on
 * 2026-08-07 (market open): 11 strikes × CE/PE = 22 usable rows/contract at
 * the old ±5 window, 21 strikes × CE/PE = 42 usable rows/contract at the new
 * ±10 window, consistently across NIFTY/BANKNIFTY/RELIANCE/TCS/SBIN.
 *
 * (b) COARSE CADENCE — 5-minute snapshots can only ever honestly produce
 * 15m/30m+ pseudo-candles (see premium-candles.ts's "≥3 samples per bucket"
 * honesty rule), nowhere near equity/index's 1m-1D parity. Naively moving
 * EVERY candidate to 1-minute cadence at the new ATM±10 window is NOT safe:
 * with no candidate cap at all (today's actual state — candidate count is
 * pure traffic/open-position-driven), a modest 10 concurrently-active
 * (underlying, expiry) pairs would already write 10 × 42 rows × 375
 * market-hour runs/day = 157,500 rows/day from ONE side of the union alone,
 * and there is no ceiling on how high real usage could push that. Trimmed
 * per the brief's own suggested split: 1-MINUTE cadence for the 5 INDEX
 * underlyings only (`FAST_TRACK_*` below) — where real trading activity is
 * genuinely tick-by-tick (scalping NIFTY/BANKNIFTY option premium is the
 * dominant real-world pattern this mirrors) — and the EXISTING 5-minute
 * cadence, unchanged, for single-stock underlyings (`SLOW_TRACK_*`), just
 * with the same wider ATM±10 window. One cron route, one crontab line, fired
 * every minute; the slow (stock) track only actually executes on a real
 * 5-minute IST boundary (`shouldRunSlowTrack`) — since IST is UTC+5:30 and
 * 30 is itself a multiple of 5, a raw `now.getUTCMinutes() % 5 === 0` check
 * lands on the correct IST boundary too, no separate IST-minute helper
 * needed.
 *
 * Defensive candidate caps (`FAST_TRACK_MAX_CANDIDATES` /
 * `SLOW_TRACK_MAX_CANDIDATES`) are NEW — today's candidate selection has no
 * cap at all. They exist purely as a circuit breaker against a real usage
 * spike (or a scripted/bot traffic burst re-viewing many chains), not as the
 * expected steady state: this domain's own documented assumption elsewhere
 * in this file ("Paper Trading trade volumes are low (single-retail-feature
 * scale)") puts REALISTIC concurrent candidate counts in the low single
 * digits per track. A candidate with a genuine OPEN POSITION is NEVER
 * dropped by the cap, regardless of how many there are — real account
 * exposure always wins over a soft write-volume budget; only excess
 * merely-viewed candidates get truncated (most-recently-viewed first).
 *
 * Every written row now also carries `captureIntervalSec` (60 for the fast
 * index track, 300 for the slow stock track) — read by premium-candles.ts's
 * aggregation to decide, per bucket and from the row's own recorded truth,
 * whether a bucket is native-granularity (1 row = 1 honest bar) or a real
 * aggregation still bound by the pre-existing "≥3 samples" honesty floor.
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

/** Strikes shown each side of ATM — widened 2026-08-07 from ±5 to ±10 (blank-chart fix, see module doc part (a)); 21 rows total when the chain has enough depth. */
const STRIKES_AROUND_ATM = 10;
const RECENTLY_VIEWED_WINDOW_MS = 15 * 60_000;

/** Fast track (index underlyings) — 1-minute cadence during market hours. */
const FAST_TRACK_CAPTURE_INTERVAL_SEC = 60;
/** Slow track (single-stock underlyings) — unchanged 5-minute cadence. */
const SLOW_TRACK_CAPTURE_INTERVAL_SEC = 300;

/**
 * Defensive circuit breakers, NEW as of the interval-parity project — see
 * module doc's "Defensive candidate caps" section for the full reasoning and
 * the numbers behind these values. A candidate with an open position is
 * NEVER dropped by either cap (see `capCandidates` below); only excess
 * merely-viewed candidates are truncated, most-recently-viewed first.
 */
const FAST_TRACK_MAX_CANDIDATES = 12;
const SLOW_TRACK_MAX_CANDIDATES = 40;

export interface PremiumCaptureRunResult {
  ranOutsideMarketHours: boolean;
  /** True when this invocation's `now` didn't land on a real 5-minute IST boundary — the slow (stock) track was skipped this run by design, not a failure. */
  slowTrackSkipped: boolean;
  candidateContracts: number;
  fastTrackCandidates: number;
  slowTrackCandidates: number;
  /** Count of purely-viewed (no open position) candidates dropped by the defensive cap this run — 0 in the overwhelmingly common case; a nonzero value here is a real signal this app's usage has outgrown FAST_TRACK_MAX_CANDIDATES/SLOW_TRACK_MAX_CANDIDATES and they should be revisited. */
  candidatesDroppedByCap: number;
  chainFetchFailures: number;
  snapshotsWritten: number;
  errors: number;
}

interface Candidate {
  underlying: string;
  expiryStr: string; // NSE "DD-MMM-YYYY"
  /** True if ANY account currently holds an open position in this contract — see capCandidates's "never drop real exposure" rule. */
  hasOpenPosition: boolean;
  /** Epoch ms this pair was last requested through the chain endpoint — 0 for a candidate that only ever showed up via an open position. Prioritizes which merely-viewed candidates survive the cap; never decides capture eligibility itself. */
  lastViewedAt: number;
}

function candidateKey(c: { underlying: string; expiryStr: string }): string {
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
async function collectOpenPositionCandidates(): Promise<Array<{ underlying: string; expiryStr: string }>> {
  const accountsWithOptionOrders = await prisma.paperOrder.findMany({
    where: { instrumentKind: { in: ["INDEX_OPTION", "STOCK_OPTION"] } },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  const seen = new Map<string, { underlying: string; expiryStr: string }>();
  for (const { accountId } of accountsWithOptionOrders) {
    const orderRows = await prisma.paperOrder.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const orders = orderRows as unknown as PaperEngineOrder[];
    for (const position of deriveOptionPositions(orders)) {
      const candidate = { underlying: position.underlyingSymbol, expiryStr: formatNseExpiryDate(position.expiryDate) };
      seen.set(candidateKey(candidate), candidate);
    }
  }
  return [...seen.values()];
}

function collectRecentlyViewedCandidates(): Array<{ underlying: string; expiryStr: string; lastViewedAt: number }> {
  return getRecentlyViewedContracts(RECENTLY_VIEWED_WINDOW_MS).map((c) => ({ underlying: c.underlying, expiryStr: c.expiry, lastViewedAt: Date.now() }));
}

/**
 * Merges the two candidate sources into one deduped list carrying both
 * `hasOpenPosition` and `lastViewedAt` — the two signals `capCandidates`
 * below needs to decide what survives a defensive cap. A pair present in
 * BOTH sources keeps `hasOpenPosition: true` (never downgraded).
 */
function mergeCandidates(
  openPositions: Array<{ underlying: string; expiryStr: string }>,
  recentlyViewed: Array<{ underlying: string; expiryStr: string; lastViewedAt: number }>
): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of openPositions) {
    byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: true, lastViewedAt: 0 });
  }
  for (const c of recentlyViewed) {
    const existing = byKey.get(candidateKey(c));
    if (existing) {
      existing.lastViewedAt = Math.max(existing.lastViewedAt, c.lastViewedAt);
    } else {
      byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: false, lastViewedAt: c.lastViewedAt });
    }
  }
  return [...byKey.values()];
}

/**
 * Defensive circuit breaker (see module doc) — every `hasOpenPosition`
 * candidate always survives, however many there are (real account exposure
 * is never sacrificed to a write-volume budget); remaining slots up to `max`
 * are filled by merely-viewed candidates, most-recently-viewed first.
 * Returns the kept list plus how many merely-viewed candidates were dropped.
 */
function capCandidates(candidates: Candidate[], max: number): { kept: Candidate[]; dropped: number } {
  const withPosition = candidates.filter((c) => c.hasOpenPosition);
  const viewedOnly = candidates.filter((c) => !c.hasOpenPosition).sort((a, b) => b.lastViewedAt - a.lastViewedAt);

  const remainingSlots = Math.max(0, max - withPosition.length);
  const keptViewedOnly = viewedOnly.slice(0, remainingSlots);
  const dropped = viewedOnly.length - keptViewedOnly.length;

  return { kept: [...withPosition, ...keptViewedOnly], dropped };
}

/** Nearest strike to the chain's own live underlyingValue — same "nearest wins" definition option-chain-browser.tsx uses client-side for its ATM highlight. */
function findAtmStrike(chain: OptionChainSnapshot): number | null {
  if (chain.strikes.length === 0) return null;
  return chain.strikes.reduce((best, s) =>
    Math.abs(s.strikePrice - chain.underlyingValue) < Math.abs(best.strikePrice - chain.underlyingValue) ? s : best
  ).strikePrice;
}

function buildSnapshotRows(
  chain: OptionChainSnapshot,
  expiryDate: Date,
  capturedAt: Date,
  captureIntervalSec: number
): Prisma.OptionPremiumSnapshotCreateManyInput[] {
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
        underlyingValue: chain.underlyingValue,
        captureIntervalSec
      });
    }
  }
  return rows;
}

/**
 * True on a real 5-minute IST boundary — gates the slow (stock) track (see
 * module doc). IST is UTC+5:30; since 30 is itself a multiple of 5, a raw
 * UTC-minute check lands on the correct IST boundary too — no separate
 * IST-minute helper needed. Takes the RAW `now`, not the market-hours-gated
 * value, so it's trivially testable against any Date.
 */
function isFiveMinuteBoundary(now: Date): boolean {
  return now.getUTCMinutes() % 5 === 0;
}

async function captureTrack(
  candidates: Candidate[],
  captureIntervalSec: number,
  capturedAt: Date,
  result: PremiumCaptureRunResult
): Promise<Prisma.OptionPremiumSnapshotCreateManyInput[]> {
  const allRows: Prisma.OptionPremiumSnapshotCreateManyInput[] = [];
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
      allRows.push(...buildSnapshotRows(chain, expiryDate, capturedAt, captureIntervalSec));
    } catch (err) {
      result.errors += 1;
      console.error(`[paperTrading/premiumCapture] candidate ${candidateKey(candidate)} failed:`, err);
    }
  }
  return allRows;
}

/**
 * Captures one round of ATM ± 10 premium snapshots for every candidate
 * contract, split into the fast (index, every invocation) and slow (stock,
 * every real 5-minute IST boundary) tracks — see module doc for the full
 * cadence/volume reasoning. Self-gates on `isNseWeekdayMarketHours()`
 * regardless of when the cron itself fired — a slightly-loose crontab bound
 * (the brief's coarse hour-window filter) never writes off-session ticks.
 * Never throws — per-candidate failures are caught and counted.
 */
export async function runPremiumCapture(now: Date = new Date()): Promise<PremiumCaptureRunResult> {
  const result: PremiumCaptureRunResult = {
    ranOutsideMarketHours: false,
    slowTrackSkipped: false,
    candidateContracts: 0,
    fastTrackCandidates: 0,
    slowTrackCandidates: 0,
    candidatesDroppedByCap: 0,
    chainFetchFailures: 0,
    snapshotsWritten: 0,
    errors: 0
  };

  if (!isNseWeekdayMarketHours(now)) {
    result.ranOutsideMarketHours = true;
    return result;
  }

  const runSlowTrack = isFiveMinuteBoundary(now);
  result.slowTrackSkipped = !runSlowTrack;

  const [openPositionCandidates, recentlyViewedCandidates] = await Promise.all([
    collectOpenPositionCandidates(),
    Promise.resolve(collectRecentlyViewedCandidates())
  ]);

  const allCandidates = mergeCandidates(openPositionCandidates, recentlyViewedCandidates);
  result.candidateContracts = allCandidates.length;

  const fastRaw = allCandidates.filter((c) => isIndexUnderlying(c.underlying));
  const slowRaw = allCandidates.filter((c) => !isIndexUnderlying(c.underlying));

  const fastCapped = capCandidates(fastRaw, FAST_TRACK_MAX_CANDIDATES);
  const slowCapped = runSlowTrack ? capCandidates(slowRaw, SLOW_TRACK_MAX_CANDIDATES) : { kept: [], dropped: 0 };

  result.fastTrackCandidates = fastCapped.kept.length;
  result.slowTrackCandidates = slowCapped.kept.length;
  result.candidatesDroppedByCap = fastCapped.dropped + slowCapped.dropped;

  const capturedAt = new Date();
  const [fastRows, slowRows] = await Promise.all([
    captureTrack(fastCapped.kept, FAST_TRACK_CAPTURE_INTERVAL_SEC, capturedAt, result),
    captureTrack(slowCapped.kept, SLOW_TRACK_CAPTURE_INTERVAL_SEC, capturedAt, result)
  ]);
  const allRows = [...fastRows, ...slowRows];

  if (allRows.length > 0) {
    const written = await prisma.optionPremiumSnapshot.createMany({ data: allRows });
    result.snapshotsWritten = written.count;
  }

  return result;
}
