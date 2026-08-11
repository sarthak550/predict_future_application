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
 *
 * **Always-on index capture (2026-08-11) — the "sparse chart" fix.** Founder
 * complaint, with screenshot: the BANKNIFTY 57700 PE 25-Aug-26 premium chart
 * rendered as scattered isolated single-sample bars with big empty stretches.
 * A same-day DATA AUDIT (not re-derived here) confirmed the captured rows
 * were themselves correct (spot parity to the decimal, CE/PE paired, zero
 * gaps WITHIN a capture window) — the problem was pure SPARSITY: capture was,
 * and until this change still is for stocks, 100% demand-driven (open
 * position or "viewed in the last 15 minutes"), so an index chain nobody had
 * open simply had almost no history. `collectAlwaysOnIndexCandidates` below
 * adds a THIRD candidate source — the 5 index underlyings'
 * (`INDEX_OPTION_UNDERLYINGS`, the same shared registry `isIndexUnderlying`
 * already re-exports from, never a locally duplicated list) nearest weekly
 * expiry (`fetchOptionChainExpiries(underlying)[0]` — that function's own
 * contract is "nearest first", verified against its doc) is now captured on
 * EVERY fast-track run during market hours, regardless of whether anyone is
 * looking at it. Marked `alwaysOn: true` on the merged `Candidate` and — like
 * `hasOpenPosition` — NEVER dropped by `capCandidates`'s defensive cap
 * (`FAST_TRACK_MAX_CANDIDATES` still leaves 7 of its 12 slots free for open
 * positions plus genuinely-viewed extra expiries/underlyings on top of the 5
 * always-on ones). Single-stock (slow-track) underlyings are DELIBERATELY
 * left demand-driven, unchanged — this domain's own write-volume ceiling is
 * the ~211-name F&O stock universe, and always-on capture across all of them
 * would be the unbounded-write-volume risk this file's own "Defensive
 * candidate caps" section above already warns against; a stock's chart
 * staying sparse until it's actually traded/viewed remains the accepted
 * tradeoff, matching this file's existing SLOW_TRACK design intent.
 *
 * Write-volume math (5 underlyings, always on, full ATM±10 depth, every
 * market-hour minute — same 375 min/session figure this file's part (a)
 * measurement above used): 5 × 42 rows × 375 min/day ≈ 78,750 rows/day, a
 * ~787,500-row steady state against the prune cron's existing 10-calendar-day
 * fine-grained retention window (`paper-trading-premium-snapshot-prune`,
 * `FINE_GRAINED_RETENTION_DAYS`). That prune cron's own module doc already
 * anticipated exactly this cadence ("the 1-minute fast (index) track writes
 * ~5x the rows/candidate/run the old 5-minute cadence did") when it carved
 * out the 10-day fine-grained tier — this change is what actually realizes
 * that assumption in steady state (previously the fast track only wrote
 * when something was genuinely being viewed, so real volume sat far below
 * the tier's own budget). `OptionPremiumSnapshot`'s existing composite index
 * (`[underlyingSymbol, expiryDate, strikePrice, optionType, capturedAt]`,
 * schema-defined, unchanged) already covers both the premium-history read
 * path and the prune cron's own delete filters at this volume — no schema
 * change needed. No new crontab entry needed either: this rides the exact
 * same every-minute fast-track invocation the interval-parity project
 * already installed.
 *
 * **15-second always-on cadence (2026-08-11, same-day follow-up)** — founder
 * wants real 1-minute CANDLE BODIES on the index premium chart, not flat
 * single-sample dashes. The web side needs zero changes for this: the
 * architecture-simplification pass (commit c83656d, same day) already made
 * `premium-candles.ts`'s aggregation plain first/max/min/last-per-bucket
 * OHLC with no branching on sample count or `captureIntervalSec` — so a
 * 1-minute bucket that receives 4 real samples instead of 1 automatically
 * gets a real body, no client changes required (verified by reading that
 * file: it truly buckets on `capturedAt` alone).
 *
 * `ALWAYS_ON_CAPTURE_INTERVAL_SEC` (15s) replaces `FAST_TRACK_CAPTURE_INTERVAL_SEC`
 * (60s) ONLY for candidates carrying `alwaysOn: true` — the 5 index
 * underlyings' own nearest-weekly-expiry pair. A demand-driven fast-track
 * candidate (an index contract someone's viewing, or holds a position in,
 * at an expiry OTHER than the always-on nearest weekly) still captures once
 * per invocation at the original 60s cadence, unchanged — see
 * `runAlwaysOnRounds` vs. the immediate `captureTrack` call in
 * `runPremiumCapture`. A candidate that's BOTH always-on and separately
 * viewed/held is a single merged `Candidate` (see `mergeCandidates`), so it
 * only ever gets the finer 15s treatment — never double-captured under two
 * different cadences for the same `(underlying, expiry)` key in one run.
 *
 * Mechanically, one cron invocation now runs the always-on candidates
 * through 4 rounds scheduled at fixed ~0/15/30/45s offsets from the
 * invocation's own start time (`ALWAYS_ON_ROUND_OFFSETS_MS`, anchored to a
 * single `runStartedAt` rather than chained wait-then-capture-then-wait, so
 * per-round execution time never accumulates drift across rounds). Each
 * round calls `fetchOptionChain` with `forceFresh: true` (see
 * `optionChain.ts`'s doc on that option) rather than relying on timing
 * alone to outrun the chain cache's own 15s market-hours TTL — the TTL and
 * the round spacing are numerically identical, so a naive wait-based
 * approach would race the boundary and risk 4 identical `lastPrice` samples
 * a round early or late. `forceFresh` removes that race by construction.
 * `ALWAYS_ON_ROUND_HARD_DEADLINE_MS` (58s) bounds the whole sequence so a
 * slow round (upstream latency, a flaky underlying) can never push a write
 * past the next minute's cron invocation — a round that would start after
 * the deadline is skipped, not delayed, and `alwaysOnRoundsSkippedByDeadline`
 * surfaces this in the result for monitoring. `runPremiumCapture` also now
 * guards against genuine RE-ENTRANCY (a prior invocation still in flight
 * when the next minute's cron hits, e.g. after an unusually slow round) with
 * a module-level in-progress flag — `skippedDueToOverlap: true` on the
 * result, never two invocations writing concurrently.
 *
 * Updated write-volume math: the always-on track alone is now 5 × 42 rows ×
 * 4 rounds × 375 min/day ≈ 315,000 rows/day (up from the single-round
 * 78,750/day figure above — a 4x multiplier, exactly the round count, since
 * depth/underlyings/session-length are unchanged). Against the SAME
 * unchanged 10-calendar-day fine-grained retention window that's a
 * ~3,150,000-row steady state for this track (demand-driven fast candidates
 * and the 5-minute stock track add a comparatively small amount on top — low
 * single-digit candidate counts per this file's own "Defensive candidate
 * caps" section). `OptionPremiumSnapshot` already carries a dedicated
 * `[captureIntervalSec, capturedAt]` index (schema-defined, unchanged) that
 * the prune cron's delete filters use directly — confirmed sufficient for
 * this volume; no schema or prune-cron change needed. No crontab change
 * either: still one every-minute invocation, all 4 rounds happen inside that
 * single request.
 */

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import { deriveOptionPositions, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";
import {
  formatNseExpiryDate,
  parseNseExpiryDate,
  INDEX_OPTION_UNDERLYINGS
} from "@predict-future/business-rules/papertrading/optionContract";

import { fetchOptionChain, fetchOptionChainExpiries, getRecentlyViewedContracts, isIndexUnderlying, type OptionChainSnapshot } from "@/lib/marketMoves/optionChain";
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

/** Fast track (index underlyings) — 1-minute cadence during market hours, for demand-driven (non-always-on) candidates only; see module doc's 2026-08-11 section. */
const FAST_TRACK_CAPTURE_INTERVAL_SEC = 60;
/** Slow track (single-stock underlyings) — unchanged 5-minute cadence. */
const SLOW_TRACK_CAPTURE_INTERVAL_SEC = 300;

/**
 * 15-second always-on cadence (2026-08-11) — see module doc. Applies ONLY to
 * `alwaysOn: true` candidates (the 5 index underlyings' own nearest weekly
 * expiry), captured `ALWAYS_ON_ROUND_OFFSETS_MS.length` times per invocation.
 */
const ALWAYS_ON_CAPTURE_INTERVAL_SEC = 15;
/** Fixed offsets (ms) from the invocation's own start — anchored, not chained, so per-round latency never accumulates drift across rounds. */
const ALWAYS_ON_ROUND_OFFSETS_MS = [0, 15_000, 30_000, 45_000];
/** A round scheduled to start after this many ms from invocation start is skipped, not delayed — keeps the whole sequence bounded well inside the ~60s window before the next cron invocation. */
const ALWAYS_ON_ROUND_HARD_DEADLINE_MS = 58_000;

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
  /**
   * 15-second cadence project (2026-08-11) — true when this invocation was
   * skipped in its entirety because a PRIOR invocation was still running
   * (the re-entrancy guard, see module-level `captureInProgress`). Every
   * other field is left at its zero-value default when this is true. Should
   * be rare in steady state (the whole sequence is bounded by
   * `ALWAYS_ON_ROUND_HARD_DEADLINE_MS`, well inside the ~60s window before
   * the next invocation) — a nonzero rate of this over time is a real signal
   * something upstream (NSE latency, DB latency) is running slower than this
   * file's own timing budget assumes.
   */
  skippedDueToOverlap: boolean;
  /** True when this invocation's `now` didn't land on a real 5-minute IST boundary — the slow (stock) track was skipped this run by design, not a failure. */
  slowTrackSkipped: boolean;
  candidateContracts: number;
  fastTrackCandidates: number;
  slowTrackCandidates: number;
  /** Always-on index capture (2026-08-11) — how many of the 5 index underlyings successfully resolved a nearest-weekly-expiry candidate this run; less than 5 signals a chain-fetch problem for one or more underlyings (see collectAlwaysOnIndexCandidates), not a cap/traffic issue. */
  alwaysOnIndexCandidates: number;
  /** Count of purely-viewed (no open position) candidates dropped by the defensive cap this run — 0 in the overwhelmingly common case; a nonzero value here is a real signal this app's usage has outgrown FAST_TRACK_MAX_CANDIDATES/SLOW_TRACK_MAX_CANDIDATES and they should be revisited. */
  candidatesDroppedByCap: number;
  chainFetchFailures: number;
  snapshotsWritten: number;
  errors: number;
  /** 15-second cadence project (2026-08-11) — how many of the (up to) 4 always-on rounds this invocation actually ran; less than the offsets-array length (normally 4) means one or more late rounds were skipped by `ALWAYS_ON_ROUND_HARD_DEADLINE_MS`, see `alwaysOnRoundsSkippedByDeadline`. 0 whenever `alwaysOnIndexCandidates` itself is 0 (nothing to capture). */
  alwaysOnRoundsCompleted: number;
  /** 15-second cadence project (2026-08-11) — count of always-on rounds skipped this invocation because they would have started past the hard deadline. 0 in the overwhelmingly common case; a nonzero value is a real signal this invocation is running slower than the timing budget assumes (see module doc). */
  alwaysOnRoundsSkippedByDeadline: number;
}

interface Candidate {
  underlying: string;
  expiryStr: string; // NSE "DD-MMM-YYYY"
  /** True if ANY account currently holds an open position in this contract — see capCandidates's "never drop real exposure" rule. */
  hasOpenPosition: boolean;
  /** Always-on index capture (2026-08-11) — true for one of the 5 index underlyings' own nearest-weekly-expiry pair, regardless of viewing/positions. Never dropped by capCandidates, same as hasOpenPosition — see module doc. */
  alwaysOn: boolean;
  /** Epoch ms this pair was last requested through the chain endpoint — 0 for a candidate that only ever showed up via an open position or always-on capture. Prioritizes which merely-viewed candidates survive the cap; never decides capture eligibility itself. */
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
 * Always-on index capture (2026-08-11, see module doc) — one candidate per
 * index underlying, pinned to that underlying's OWN nearest weekly expiry
 * (`fetchOptionChainExpiries` is documented "nearest first" — never assumed,
 * that ordering is this function's whole contract). A per-underlying fetch
 * failure (chain endpoint down, no expiries returned) drops just that one
 * underlying for this run — never throws, matching every other function in
 * this file's failure posture — so one flaky underlying can't blank out
 * always-on capture for the other four.
 */
async function collectAlwaysOnIndexCandidates(): Promise<Array<{ underlying: string; expiryStr: string }>> {
  const results = await Promise.all(
    INDEX_OPTION_UNDERLYINGS.map(async (underlying): Promise<{ underlying: string; expiryStr: string } | null> => {
      try {
        const expiries = await fetchOptionChainExpiries(underlying);
        const nearest = expiries[0];
        return nearest ? { underlying, expiryStr: nearest } : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((c): c is { underlying: string; expiryStr: string } => c !== null);
}

/**
 * Merges the three candidate sources into one deduped list carrying
 * `hasOpenPosition`, `alwaysOn`, and `lastViewedAt` — the signals
 * `capCandidates` below needs to decide what survives a defensive cap. A
 * pair present in multiple sources keeps every `true` flag it earned from
 * ANY source (never downgraded) and the MAX `lastViewedAt` across sources.
 */
function mergeCandidates(
  openPositions: Array<{ underlying: string; expiryStr: string }>,
  recentlyViewed: Array<{ underlying: string; expiryStr: string; lastViewedAt: number }>,
  alwaysOn: Array<{ underlying: string; expiryStr: string }>
): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of openPositions) {
    byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: true, alwaysOn: false, lastViewedAt: 0 });
  }
  for (const c of alwaysOn) {
    const existing = byKey.get(candidateKey(c));
    if (existing) {
      existing.alwaysOn = true;
    } else {
      byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: false, alwaysOn: true, lastViewedAt: 0 });
    }
  }
  for (const c of recentlyViewed) {
    const existing = byKey.get(candidateKey(c));
    if (existing) {
      existing.lastViewedAt = Math.max(existing.lastViewedAt, c.lastViewedAt);
    } else {
      byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: false, alwaysOn: false, lastViewedAt: c.lastViewedAt });
    }
  }
  return [...byKey.values()];
}

/**
 * Defensive circuit breaker (see module doc) — every `hasOpenPosition` OR
 * `alwaysOn` candidate always survives, however many there are (real account
 * exposure and the always-on index floor are never sacrificed to a
 * write-volume budget); remaining slots up to `max` are filled by
 * merely-viewed candidates, most-recently-viewed first. Returns the kept
 * list plus how many merely-viewed candidates were dropped.
 */
function capCandidates(candidates: Candidate[], max: number): { kept: Candidate[]; dropped: number } {
  const neverDropped = candidates.filter((c) => c.hasOpenPosition || c.alwaysOn);
  const viewedOnly = candidates.filter((c) => !c.hasOpenPosition && !c.alwaysOn).sort((a, b) => b.lastViewedAt - a.lastViewedAt);

  const remainingSlots = Math.max(0, max - neverDropped.length);
  const keptViewedOnly = viewedOnly.slice(0, remainingSlots);
  const dropped = viewedOnly.length - keptViewedOnly.length;

  return { kept: [...neverDropped, ...keptViewedOnly], dropped };
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
  result: PremiumCaptureRunResult,
  options: { forceFresh?: boolean } = {}
): Promise<Prisma.OptionPremiumSnapshotCreateManyInput[]> {
  const allRows: Prisma.OptionPremiumSnapshotCreateManyInput[] = [];
  for (const candidate of candidates) {
    try {
      const expiryDate = parseNseExpiryDate(candidate.expiryStr);
      if (!expiryDate) {
        result.errors += 1;
        continue;
      }
      const chain = await fetchOptionChain(candidate.underlying, candidate.expiryStr, { forceFresh: options.forceFresh });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 15-second always-on cadence (2026-08-11, see module doc) — runs
 * `alwaysOnCandidates` through `ALWAYS_ON_ROUND_OFFSETS_MS.length` rounds
 * (normally 4), each anchored to a fixed offset from `runStartedAt` rather
 * than chained off the PREVIOUS round's own finish time, so per-round
 * latency (a slow underlying, upstream jitter) never compounds into
 * schedule drift across the sequence. Each round fetches with
 * `forceFresh: true` (bypassing the chain cache's read-side throttle
 * entirely) rather than trusting elapsed wall-clock time to have outrun the
 * cache TTL — the TTL and the round spacing are both 15s, so a timing-only
 * approach would race that boundary. Writes each round's rows immediately
 * (not batched to the end) so a mid-sequence failure still preserves
 * whatever rounds already completed. A round whose target start time has
 * already passed `ALWAYS_ON_ROUND_HARD_DEADLINE_MS` is skipped outright,
 * never delayed — keeps the whole sequence bounded well inside the ~60s
 * window before the next cron invocation.
 */
async function runAlwaysOnRounds(
  alwaysOnCandidates: Candidate[],
  runStartedAt: number,
  result: PremiumCaptureRunResult
): Promise<void> {
  for (const offsetMs of ALWAYS_ON_ROUND_OFFSETS_MS) {
    if (Date.now() - runStartedAt > ALWAYS_ON_ROUND_HARD_DEADLINE_MS) {
      result.alwaysOnRoundsSkippedByDeadline += 1;
      continue;
    }

    const waitMs = runStartedAt + offsetMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);

    const capturedAt = new Date();
    const rows = await captureTrack(alwaysOnCandidates, ALWAYS_ON_CAPTURE_INTERVAL_SEC, capturedAt, result, { forceFresh: true });
    if (rows.length > 0) {
      const written = await prisma.optionPremiumSnapshot.createMany({ data: rows });
      result.snapshotsWritten += written.count;
    }
    result.alwaysOnRoundsCompleted += 1;
  }
}

/**
 * 15-second cadence project (2026-08-11) — process-local re-entrancy guard.
 * `runPremiumCapture` can now take up to `ALWAYS_ON_ROUND_HARD_DEADLINE_MS`
 * (58s) to complete, close to the every-minute cron cadence itself; without
 * this guard an unusually slow invocation overlapping the next one would
 * risk two concurrent runs racing writes/chain-cache state. Single boolean
 * is sufficient — this route runs single-instance (same accepted limitation
 * `optionChain.ts`'s in-module caches already carry).
 */
let captureInProgress = false;

/**
 * Captures one round of ATM ± 10 premium snapshots for every candidate
 * contract, split into three cadence tracks — always-on index (15s × 4
 * rounds), demand-driven index (60s × 1, every invocation), and stock (300s
 * × 1, every real 5-minute IST boundary) — see module doc for the full
 * cadence/volume reasoning. Self-gates on `isNseWeekdayMarketHours()`
 * regardless of when the cron itself fired — a slightly-loose crontab bound
 * (the brief's coarse hour-window filter) never writes off-session ticks.
 * Never throws — per-candidate failures are caught and counted. Guarded
 * against re-entrancy (see `captureInProgress`) — an overlapping invocation
 * returns immediately with `skippedDueToOverlap: true` rather than racing
 * the one already running.
 */
export async function runPremiumCapture(now: Date = new Date()): Promise<PremiumCaptureRunResult> {
  const result: PremiumCaptureRunResult = {
    ranOutsideMarketHours: false,
    skippedDueToOverlap: false,
    slowTrackSkipped: false,
    candidateContracts: 0,
    fastTrackCandidates: 0,
    slowTrackCandidates: 0,
    alwaysOnIndexCandidates: 0,
    candidatesDroppedByCap: 0,
    chainFetchFailures: 0,
    snapshotsWritten: 0,
    errors: 0,
    alwaysOnRoundsCompleted: 0,
    alwaysOnRoundsSkippedByDeadline: 0
  };

  if (captureInProgress) {
    result.skippedDueToOverlap = true;
    return result;
  }

  const runStartedAt = Date.now();
  captureInProgress = true;
  try {
    if (!isNseWeekdayMarketHours(now)) {
      result.ranOutsideMarketHours = true;
      return result;
    }

    const runSlowTrack = isFiveMinuteBoundary(now);
    result.slowTrackSkipped = !runSlowTrack;

    const [openPositionCandidates, recentlyViewedCandidates, alwaysOnIndexCandidates] = await Promise.all([
      collectOpenPositionCandidates(),
      Promise.resolve(collectRecentlyViewedCandidates()),
      collectAlwaysOnIndexCandidates()
    ]);

    const allCandidates = mergeCandidates(openPositionCandidates, recentlyViewedCandidates, alwaysOnIndexCandidates);
    result.candidateContracts = allCandidates.length;
    result.alwaysOnIndexCandidates = alwaysOnIndexCandidates.length;

    const fastRaw = allCandidates.filter((c) => isIndexUnderlying(c.underlying));
    const slowRaw = allCandidates.filter((c) => !isIndexUnderlying(c.underlying));

    const fastCapped = capCandidates(fastRaw, FAST_TRACK_MAX_CANDIDATES);
    const slowCapped = runSlowTrack ? capCandidates(slowRaw, SLOW_TRACK_MAX_CANDIDATES) : { kept: [], dropped: 0 };

    result.fastTrackCandidates = fastCapped.kept.length;
    result.slowTrackCandidates = slowCapped.kept.length;
    result.candidatesDroppedByCap = fastCapped.dropped + slowCapped.dropped;

    // Split the fast track: always-on candidates get the 15s × 4-round
    // treatment below; demand-driven fast candidates (viewed/held at an
    // expiry other than the always-on nearest weekly) keep the original 60s
    // single-round cadence, captured here alongside the stock track.
    const alwaysOnFastCandidates = fastCapped.kept.filter((c) => c.alwaysOn);
    const demandFastCandidates = fastCapped.kept.filter((c) => !c.alwaysOn);

    const capturedAt = new Date();
    const [demandFastRows, slowRows] = await Promise.all([
      captureTrack(demandFastCandidates, FAST_TRACK_CAPTURE_INTERVAL_SEC, capturedAt, result),
      captureTrack(slowCapped.kept, SLOW_TRACK_CAPTURE_INTERVAL_SEC, capturedAt, result)
    ]);
    const immediateRows = [...demandFastRows, ...slowRows];

    if (immediateRows.length > 0) {
      const written = await prisma.optionPremiumSnapshot.createMany({ data: immediateRows });
      result.snapshotsWritten += written.count;
    }

    if (alwaysOnFastCandidates.length > 0) {
      await runAlwaysOnRounds(alwaysOnFastCandidates, runStartedAt, result);
    }

    return result;
  } finally {
    captureInProgress = false;
  }
}
