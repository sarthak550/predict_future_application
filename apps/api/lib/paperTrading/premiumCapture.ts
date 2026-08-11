/**
 * Trading Terminal UI Overhaul (Sprint A, T3) — premium-history capture
 * orchestration for POST /api/cron/paper-trading-premium-capture.
 *
 * Writes one OptionPremiumSnapshot row per CE/PE quote (that has a lastPrice
 * or a bid/ask). Index-underlying coverage is GATED by the
 * `PREMIUM_CAPTURE_ALL_EXPIRIES` env flag (default OFF — see the
 * "Feature-flagged" section far below for the full launch story):
 *   - Flag ON: every listed expiry of all 5 index underlyings, always-on,
 *     tiered near/far by days-to-expiry.
 *   - Flag OFF (default, current production behavior): each index
 *     underlying's nearest weekly expiry only, always-on, PLUS any index
 *     open position or recently-viewed index contract (restored bc90714
 *     behavior).
 * Either way, the UNION also always includes:
 *   - Every (underlyingSymbol, expiryDate) with at least one open option
 *     position across any account, on a SINGLE-STOCK underlying (index
 *     positions are handled by the gated section above).
 *   - Every single-stock (underlyingSymbol, expiryDate) requested through
 *     the chain endpoint in roughly the last 15 minutes
 *     (getRecentlyViewedContracts).
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
 * 15m/30m+ pseudo-candles. Every single-stock underlying still runs this
 * original 5-minute demand-driven cadence (`SLOW_TRACK_*` below) — the 5
 * index underlyings graduated off it entirely, see below.
 *
 * **Always-on index capture (2026-08-11) — the "sparse chart" fix**, then
 * **15-second cadence (2026-08-11, same-day follow-up)** — superseded by the
 * all-expiry project immediately below. Both prior passes captured only the
 * NEAREST WEEKLY expiry per index underlying, always-on at 15s × 4
 * rounds/minute. Kept only as prior-art context; every mechanism from those
 * passes (`alwaysOn` flag, single-expiry-per-underlying selection) has been
 * replaced by the tiered ALL-EXPIRY design below, not layered on top of it.
 *
 * **All-expiry index capture (2026-08-11, third same-day pass)** — founder,
 * verbatim: "No, I want all expiry data." Rejects the nearest-weekly-only
 * scope of the two passes above: a trader holding, or wanting to chart, ANY
 * listed index expiry — not just the front weekly — had zero history for it.
 *
 * MECHANICAL FACT CHECKED, FOUND FALSE — the brief driving this pass assumed
 * "one NSE chain fetch per underlying returns ALL expiries in the same
 * payload, so widening scope costs zero extra fetches." Verified live against
 * `/api/option-chain-v3` before writing a line of this section: omitting the
 * `expiry` query param returns `{}` (no `records` at all), and passing one
 * expiry returns ONLY that expiry's rows (`records.data` is 100% one
 * `expiryDates` value, confirmed by inspecting every row). There is no
 * bulk-fetch shortcut — this endpoint is fundamentally one HTTP fetch per
 * (underlying, expiry) pair, confirmed on 2026-08-11 against live NIFTY/
 * BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50 chains. `fetchOptionChainExpiries`
 * (the `/api/option-chain-contract-info` endpoint) is the only "one call
 * returns everything" shortcut that actually exists, and it returns expiry
 * DATES only, no strikes/quotes.
 *
 * Real expiry counts, live-measured 2026-08-11 (today's date; NSE lists
 * expiries out to multi-year LEAPS on NIFTY, confirmed not a fluke by
 * re-fetching): NIFTY 18, BANKNIFTY 6, FINNIFTY 3, MIDCPNIFTY 3, NIFTYNXT50
 * 3 — 33 total (underlying, expiry) pairs across the 5 index underlyings.
 * Capturing all 33 at the old 15s × 4-round cadence would be ~2.08M
 * rows/day (33 × 42 rows/candidate-round × 4 rounds/min × 375 min/day) — a
 * ~6.6x jump from the nearest-weekly-only design's 315,000/day, AND it would
 * mean 33 sequential NSE fetches every 15 seconds, which live timing below
 * shows does not fit in the budget. Rejected in favor of tiering by
 * proximity, matching how real trading activity actually concentrates:
 *
 * NEAR TIER (`NEAR_TERM_MAX_DAYS`, 40 calendar days) — real weeklies and the
 * active-month monthlies, i.e. the contracts that actually move — kept at
 * the full 15-second × 4-round cadence (`ALWAYS_ON_NEAR_CAPTURE_INTERVAL_SEC`).
 * Live-measured 2026-08-11: 9 of the 33 pairs fall in this tier today.
 *
 * FAR TIER — everything beyond 40 days (quarterlies, half-yearlies, LEAPS
 * out to 2031) — captured once per invocation only, at 60-second cadence
 * (`ALWAYS_ON_FAR_CAPTURE_INTERVAL_SEC`). Rationale: a dead multi-year LEAP
 * contract sampled 4x/minute writes 4 identical `lastPrice` rows — same flat
 * candle, 4x the storage, for a contract nobody is scalping. Live-measured
 * 2026-08-11: 24 of the 33 pairs, and — confirmed by actually reading their
 * quotes, not assumed — even the farthest (24-Jun-2031) still carries real
 * (if thin, ~12-strike) bid/ask data, so "all expiry data" is honestly
 * meaningful all the way out, not empty shells; tiering the cadence keeps
 * that promise true without paying 4x for contracts that don't move.
 *
 * OPEN-POSITION PROMOTION — any index expiry with a currently-open position,
 * however far out, is treated as near-tier regardless of its actual date
 * distance (`hasOpenPosition` check in the near/far split below) — a trader
 * holding a LEAP position gets the same 15s cadence as a front-weekly
 * scalper. This makes the brief's "open positions always get 15s" rule
 * automatic rather than a special case: since near+far tiers already cover
 * literally every listed index expiry, ANY index position is by construction
 * already inside one of the two tiers — the only real work is the
 * promotion when it would otherwise have landed in the far (60s) tier.
 * SINGLE-STOCK open positions are explicitly NOT promoted to any index-style
 * cadence — they stay on `SLOW_TRACK_CAPTURE_INTERVAL_SEC` (5 minutes),
 * unchanged. Extending 15s treatment to a stock position would mean adding a
 * whole new per-position NSE fetch path outside the already-capped,
 * demand-driven slow track (see `SLOW_TRACK_MAX_CANDIDATES`) — a real scope
 * expansion the brief did not ask for and this pass deliberately declines,
 * consistent with the pre-existing "stock stays demand-driven" design
 * decision from the 2026-08-11 always-on-index pass above.
 *
 * DEMAND-DRIVEN INDEX TRACK REMOVED — the old design had a THIRD index path
 * ("viewed in the last 15 minutes, at whatever expiry"), needed because
 * always-on capture only covered the nearest weekly. Now that near+far
 * tiers cover literally every listed index expiry, that path is fully
 * subsumed: no (underlying, expiry) pair a user can view is NOT already one
 * of the 33 always-on candidates. Removed rather than left as dead code —
 * `getRecentlyViewedContracts` is now consumed ONLY for the single-stock
 * slow track, where it's still load-bearing (stock capture stays
 * demand-driven, unchanged). Deleted alongside it: the `alwaysOn` candidate
 * flag, the 3-way `mergeCandidates`, and `FAST_TRACK_MAX_CANDIDATES` — that
 * cap existed to guard against unbounded VIEWING traffic (bot/scripted
 * re-viewing), a vector that doesn't apply to a tier whose membership is now
 * derived from live NSE expiry lists and real account positions, not user
 * traffic.
 *
 * TIMING, live-measured 2026-08-11 against real NSE chains (`forceFresh`,
 * the same option every production round uses): a single fetch averages
 * ~600ms (curl subprocess + Akamai handshake + response). 33 SEQUENTIAL
 * fetches (the original one-fetch-at-a-time design applied naively to the
 * wider set) took ~20.6s for one pass — fine for far-tier's once-per-minute
 * cadence in isolation, but far-tier's 24 fetches alone, run sequentially
 * INSIDE round 0 the way the old single-track design would have nested it,
 * measured ~15.75s — that would push round 1's 15s-offset target ~5s late,
 * compounding across rounds toward the 58s deadline on a slower day.
 * `FAR_TIER_FETCH_CONCURRENCY` (3) fixes this: `runFarTierOnce` and
 * `runNearTierRounds` run CONCURRENTLY (`Promise.all` in `runPremiumCapture`,
 * not nested), and far-tier's own 24 fetches run 3-at-a-time instead of
 * strictly sequential — live-measured 2026-08-11: ~4.9s for all 24 (a 3.2x
 * speedup over sequential), with the SAME 4 deterministic failures both ways
 * (FINNIFTY/MIDCPNIFTY/NIFTYNXT50's farthest listed expiry each 404s — a
 * real gap between what `/api/option-chain-contract-info` lists as a future
 * expiry and what `/api/option-chain-v3` has actual contract data for yet,
 * not a concurrency-induced failure — confirmed by re-running both at
 * concurrency 1 and 3 and diffing the failing pairs, identical both times).
 * The single-stock slow track (up to `SLOW_TRACK_MAX_CANDIDATES`,
 * sequential, unchanged) ALSO now runs concurrently alongside near/far
 * rather than sequentially before them — the OLD single-track code awaited
 * the slow track's fetch before starting the always-on round loop, which on
 * a real 5-minute boundary (up to 40 sequential stock fetches, ~24s worst
 * case) would have already eaten into round 0's timing budget before the
 * round loop's own `runStartedAt`-anchored clock even got a chance to run;
 * this pass fixes that pre-existing risk as a side effect of the restructure
 * (all three tracks share one `runStartedAt` and run via a single
 * `Promise.all`).
 *
 * Full live-measured invocation (near-tier round loop + far-tier concurrent
 * pass, both anchored to one `runStartedAt`, matching the exact structure
 * shipped here): round 0 at +3ms→+5.6s, far-tier done at +15.75s (never
 * blocking round 1), round 1 at +15.0s→+20.6s, round 2 at +30.0s→+35.8s,
 * round 3 at +45.0s→+50.4s. TOTAL: ~50.4s, a ~7.6s (13%) margin inside
 * `ALWAYS_ON_ROUND_HARD_DEADLINE_MS` (58s) — tight but real, and the
 * pre-existing deadline-skip guard (`nearTierRoundsSkippedByDeadline`)
 * degrades gracefully (skips a late round rather than corrupting the
 * schedule) if a slower day erodes that margin further. Worth monitoring,
 * not worth over-engineering further today.
 *
 * WRITE-VOLUME MATH, live-measured (not assumed) by running the exact
 * ATM±10 windowing this file uses against all 33 real chains: near tier (9
 * candidates) = 378 usable rows/round × 4 rounds/min × 375 min/day =
 * 567,000 rows/day. Far tier (24 candidates, several genuinely thin —
 * farthest LEAPS carry as few as 2-24 usable rows, not the full 42) = 590
 * usable rows/round × 1 round/min × 375 min/day = 221,250 rows/day. TOTAL:
 * ~788,250 rows/day — well under the ~2.08M/day a naive "all 33 at 15s×4"
 * design would have written (the tiering is a real ~62% reduction, not
 * theoretical), and also under the brief's own rough 1.5-2M/day estimate
 * (which assumed the naive design, before this tiering was worked out).
 * `createMany` batch sizes stay tiny in practice — 378 and 590 rows/round,
 * nowhere near needing manual chunking; Postgres/Neon handles either in one
 * round trip.
 *
 * STORAGE, measured (not hand-waved) via `pg_relation_size` on local dev
 * Postgres after seeding 500,000 synthetic rows matching this table's real
 * column shapes and value distributions, then `VACUUM ANALYZE`: ~402
 * bytes/row table+indexes combined (64MB/502,335 table-only ≈ 134
 * bytes/row, 128MB/502,335 indexes ≈ 268 bytes/row across the 3 existing
 * indexes). Against `FINE_GRAINED_RETENTION_DAYS` (10 days, unchanged, still
 * covers both this file's 15s and 60s cadences since both are <=60s) and
 * this file's own measured ~788,250 rows/day, steady state ≈ 7,882,500 rows
 * ≈ 3.17 GB for the fine-grained tier — roughly 2.5x the nearest-weekly-only
 * design's ~1.27GB fine-grained steady state, but still under the ~5GB
 * flag-prominently threshold. WORTH FLAGGING AS A WATCH ITEM regardless
 * (Neon quota is an existing tracked concern per prior sprints' project
 * notes) — this is the single largest jump in this table's steady-state
 * size since the column existed, even though it doesn't cross the hard
 * threshold. Recommendation only, not acted on here per the brief's own
 * constraint: if this needs tightening later, the cheapest lever is
 * shortening `FINE_GRAINED_RETENTION_DAYS` below 10, not touching capture
 * scope (the whole point of this pass was NOT to narrow scope).
 *
 * `OptionPremiumSnapshot`'s existing `[captureIntervalSec, capturedAt]`
 * index (schema-defined, unchanged) already covers the prune cron's delete
 * filter at this volume. The prune cron's own `deleteMany` had NO batching
 * at all before this pass — a single unbounded delete against a table now
 * writing ~788K rows/day into its fine-grained tier is a bigger single
 * transaction than the prior design ever produced, so this pass ALSO adds
 * chunked deletion there (see that route's own doc) — that fix stays live in
 * BOTH modes below (see next section), it's a robustness improvement, not
 * part of the gated feature.
 *
 * **Feature-flagged behind PREMIUM_CAPTURE_ALL_EXPIRIES (2026-08-11, same-day
 * launch decision)** — founder, verbatim, after seeing the storage math
 * above: "IF this feature is gonna cost so much space then we can have the
 * complete code base but block this for now, given it's working absolutely
 * fine, we can launch it later." Translation: keep every line of the
 * all-expiry design above, but make it opt-in, default OFF, flippable at
 * launch time with an env var and a container recreate — NO code change
 * needed to launch later.
 *
 * `PREMIUM_CAPTURE_ALL_EXPIRIES` — parsed `=== "true"` (this codebase's
 * established boolean-env-gate convention, matching
 * `FEED_FILTER_SUMMARY_READY` in stories/queries.ts and news/queries.ts),
 * default OFF (unset, empty, or any value other than the literal string
 * `"true"` all resolve to OFF — the safe default for an unset var in every
 * deploy environment that hasn't been told about this flag yet).
 *
 * FLAG ON — exactly the all-expiry design documented above, zero
 * difference: `collectIndexExpiryCandidates` fetches every listed expiry of
 * all 5 index underlyings, tiered near/far by `NEAR_TERM_MAX_DAYS` +
 * open-position promotion, no cap (deterministic membership). ~788,250
 * rows/day, ~3.17GB fine-grained steady state (both figures as measured
 * above).
 *
 * FLAG OFF (default) — restores the EXACT previous shipped behavior from
 * commit bc90714 (the last commit before the all-expiry rewrite), not a
 * fresh reinvention: pulled from git history and adapted to fit inside the
 * new near/far-tier function shapes rather than duplicating them.
 *   - `collectNearestWeeklyIndexCandidates` — bc90714's
 *     `collectAlwaysOnIndexCandidates`, renamed: one candidate per index
 *     underlying, its OWN nearest weekly expiry
 *     (`fetchOptionChainExpiries(underlying)[0]`), always-on.
 *   - Index open positions are promoted into the SAME near-tier round loop
 *     regardless of expiry — this was already true structurally (open
 *     positions are unioned in before capping, see
 *     `mergeLegacyIndexCandidates`/`capLegacyIndexCandidates` below, restored
 *     from bc90714's `mergeCandidates`/`capCandidates`), so positions never
 *     lose capture in either mode.
 *   - RECENTLY-VIEWED INDEX CONTRACTS — bc90714 had a genuine third path
 *     here: any index (underlying, expiry) viewed through the chain endpoint
 *     in the last 15 minutes, captured at `FAST_TRACK_CAPTURE_INTERVAL_SEC`
 *     (60s, a SEPARATE single-round capture alongside the always-on 15s×4
 *     rounds). Restored from git history per the brief, but ADAPTED rather
 *     than reproduced verbatim: instead of a separate 60s single-round path,
 *     a viewed-but-not-always-on index contract now simply JOINS the near
 *     tier's existing 15s×4 round loop for that invocation (own call, per
 *     the brief's explicit "your call, document it"). Reasoning: (1) it's
 *     strictly better for the user — the founder's own BANKNIFTY-25-Aug
 *     example gets REAL 1-minute candles while being watched, not the old
 *     design's flatter 60s samples; (2) it's simpler — reuses
 *     `runNearTierRounds` as-is with zero new round-scheduling code, versus
 *     resurrecting a whole parallel 60s-single-round track; (3) it's cheap —
 *     viewing is rare (this file's own `RECENTLY_VIEWED_WINDOW_MS` — 15
 *     minutes — combined with `LEGACY_NEAR_TRACK_MAX_CANDIDATES` below
 *     bounds the extra fetches to a handful per invocation, nowhere near
 *     the all-expiry mode's own 15s-track cost).
 *   - `LEGACY_NEAR_TRACK_MAX_CANDIDATES` (12) — restored verbatim from
 *     bc90714's `FAST_TRACK_MAX_CANDIDATES`: guards against unbounded
 *     VIEWING traffic in this mode (a real vector here, unlike ALL_EXPIRIES
 *     mode — see that section above). Never drops an always-on
 *     nearest-weekly candidate or an open position; only trims excess
 *     merely-viewed candidates, most-recently-viewed first. This cap is
 *     INACTIVE (never invoked) when the flag is ON.
 *   - No far tier at all in this mode (`farTierCandidates` is always `[]`) —
 *     `runFarTierOnce` already no-ops on an empty array, so no branch is
 *     needed there.
 *   - Volume: ~315,000 rows/day (bc90714's own measured figure — 5
 *     always-on candidates + a handful of viewed/position extras, all at
 *     42 rows/round × 4 rounds/min × 375 min/day), ~1.27GB fine-grained
 *     steady state at the unchanged 10-day retention. Effectively zero
 *     incremental storage cost versus what was already live in production
 *     before this whole project started.
 *
 * LAUNCH PROCEDURE (when the founder decides to turn this on) — set
 * `PREMIUM_CAPTURE_ALL_EXPIRIES=true` in the API container's env (the same
 * `.env`/`.env.prod` convention every other prod env var in this app
 * already uses) on the EC2 box, then recreate the container — `docker rm` +
 * `docker run` (or the project's equivalent reship step), NOT a plain
 * `docker restart`: Docker snapshots env vars at container CREATION, so a
 * restart alone would keep running with the old (unset) value. No code
 * change, no migration, no crontab change — this doc, the constants below,
 * and both code paths already ship in this same file either way.
 *
 * `allExpiriesEnabled` on `PremiumCaptureRunResult` surfaces which mode ran,
 * directly in the cron's own JSON response — no need to cross-reference env
 * config to tell which behavior a given invocation used.
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

/** Single-stock (slow) track — unchanged 5-minute demand-driven cadence, see module doc. */
const SLOW_TRACK_CAPTURE_INTERVAL_SEC = 300;
const SLOW_TRACK_MAX_CANDIDATES = 40;

/**
 * All-expiry index capture (2026-08-11) — see module doc for the full
 * tiering rationale and the live measurements behind every constant below.
 */
const NEAR_TERM_MAX_DAYS = 40;
const ALWAYS_ON_NEAR_CAPTURE_INTERVAL_SEC = 15;
const ALWAYS_ON_FAR_CAPTURE_INTERVAL_SEC = 60;
/** Fixed offsets (ms) from the invocation's own start — anchored, not chained, so per-round latency never accumulates drift across rounds. */
const ALWAYS_ON_ROUND_OFFSETS_MS = [0, 15_000, 30_000, 45_000];
/** A round scheduled to start after this many ms from invocation start is skipped, not delayed — keeps the whole sequence bounded well inside the ~60s window before the next cron invocation. */
const ALWAYS_ON_ROUND_HARD_DEADLINE_MS = 58_000;
/** Live-measured 2026-08-11: 3-way concurrent far-tier fetch is ~3.2x faster than sequential (4.9s vs 15.75s for 24 candidates) with the identical failure set — see module doc. */
const FAR_TIER_FETCH_CONCURRENCY = 3;

/**
 * Launch gate (2026-08-11, see module doc's "Feature-flagged" section) —
 * default OFF. `=== "true"` parsing matches this codebase's established
 * boolean-env-gate convention (`FEED_FILTER_SUMMARY_READY` in
 * stories/queries.ts and news/queries.ts).
 */
const PREMIUM_CAPTURE_ALL_EXPIRIES = process.env.PREMIUM_CAPTURE_ALL_EXPIRIES === "true";

/** Legacy mode (flag OFF) only, restored verbatim from bc90714's FAST_TRACK_MAX_CANDIDATES — see module doc. Never invoked when the flag is ON (the all-expiry near/far tiers are deterministic, not traffic-driven, so nothing caps them). */
const LEGACY_NEAR_TRACK_MAX_CANDIDATES = 12;

export interface PremiumCaptureRunResult {
  ranOutsideMarketHours: boolean;
  /** True when this invocation was skipped in its entirety because a PRIOR invocation was still running (see module-level `captureInProgress`). Every other field is left at its zero-value default when this is true. */
  skippedDueToOverlap: boolean;
  /** True when this invocation's `now` didn't land on a real 5-minute IST boundary — the slow (stock) track was skipped this run by design, not a failure. */
  slowTrackSkipped: boolean;
  /** ALL_EXPIRIES mode only (see allExpiriesEnabled) — total (underlying, expiry) pairs observed across the 5 index underlyings' live expiry lists this run. Live-measured baseline 2026-08-11: 33 (NIFTY 18 + BANKNIFTY 6 + FINNIFTY 3 + MIDCPNIFTY 3 + NIFTYNXT50 3). A big drop signals a chain-fetch problem for one or more underlyings, not a real product state (an index option chain never has zero expiries). Always 0 in legacy mode — see nearestWeeklyResolved instead. */
  indexExpiriesObserved: number;
  /** Legacy mode only (see allExpiriesEnabled) — how many of the 5 index underlyings resolved a nearest-weekly candidate this run (bc90714's original always-on signal, restored). Always 0 in ALL_EXPIRIES mode. */
  nearestWeeklyResolved: number;
  /** Index expiries captured at 15s x 4-round cadence this run. ALL_EXPIRIES mode: real near-dated expiries (<= NEAR_TERM_MAX_DAYS) plus any far-dated expiry currently holding an open position, promoted regardless of date (live baseline 2026-08-11: 9). Legacy mode: each underlying's nearest-weekly candidate, plus any open-position or recently-viewed index contract, capped at LEGACY_NEAR_TRACK_MAX_CANDIDATES. */
  nearTierCandidates: number;
  /** Index expiries beyond NEAR_TERM_MAX_DAYS with no open position — captured once this run at 60s cadence, FAR_TIER_FETCH_CONCURRENCY-way concurrent. ALL_EXPIRIES mode only (live baseline 2026-08-11: 24) — always 0 in legacy mode (no far tier exists there, see module doc). */
  farTierCandidates: number;
  slowTrackCandidates: number;
  /** Count of merely-viewed (no open position, no always-on status) candidates dropped by a defensive cap this run — 0 in the overwhelmingly common case. Covers the STOCK slow-track cap in both modes, PLUS the legacy-mode index near-track cap (LEGACY_NEAR_TRACK_MAX_CANDIDATES) when the flag is off. ALL_EXPIRIES-mode index tiers are never capped (see module doc — membership is derived from live NSE data + real positions, not user traffic). */
  candidatesDroppedByCap: number;
  chainFetchFailures: number;
  snapshotsWritten: number;
  errors: number;
  /** How many of the (up to) 4 near-tier rounds this invocation actually ran; less than 4 means one or more late rounds were skipped by ALWAYS_ON_ROUND_HARD_DEADLINE_MS — see nearTierRoundsSkippedByDeadline. 0 whenever nearTierCandidates itself is 0. */
  nearTierRoundsCompleted: number;
  /** Count of near-tier rounds skipped this invocation because they would have started past the hard deadline. 0 in the overwhelmingly common case; a nonzero value is a real signal this invocation is running slower than the ~50.4s measured baseline (see module doc). */
  nearTierRoundsSkippedByDeadline: number;
  /** Which mode this invocation ran under — mirrors PREMIUM_CAPTURE_ALL_EXPIRIES, surfaced directly on the result so the cron's own JSON response answers "which behavior just ran" without cross-referencing env config. */
  allExpiriesEnabled: boolean;
}

interface CaptureCandidate {
  underlying: string;
  expiryStr: string; // NSE "DD-MMM-YYYY"
}

/** Stock (slow) track only — carries the signals `capStockCandidates` needs. ALL_EXPIRIES-mode index tiers use the bare `CaptureCandidate` shape; nothing caps them (see module doc). */
interface StockCandidate extends CaptureCandidate {
  hasOpenPosition: boolean;
  lastViewedAt: number;
}

/** Legacy mode (flag OFF) only — restored from bc90714's `Candidate` interface. `alwaysOn` = this underlying's own nearest-weekly expiry (never dropped by the cap, same as `hasOpenPosition`); see `mergeLegacyIndexCandidates`/`capLegacyIndexCandidates`. */
interface LegacyIndexCandidate extends CaptureCandidate {
  hasOpenPosition: boolean;
  alwaysOn: boolean;
  lastViewedAt: number;
}

function candidateKey(c: { underlying: string; expiryStr: string }): string {
  return `${c.underlying}::${c.expiryStr}`;
}

/**
 * Scans every account with at least one option order and collects the
 * (underlyingSymbol, expiryDate) pairs it currently holds an open position in
 * — generalized from optionsExpiry.ts's "expiring today" scan to "any open
 * position, regardless of expiry date" per the brief. Returns pairs across
 * BOTH index and single-stock underlyings — callers split by isIndexUnderlying
 * for their own purposes (index-position promotion vs. the stock slow
 * track's hasOpenPosition signal). Paper Trading trade volumes are low
 * (single-retail-feature scale, same assumption every other read-side query
 * in this domain already makes — see queries.ts), so a per-account replay is
 * cheap here.
 */
async function collectOpenPositionCandidates(): Promise<CaptureCandidate[]> {
  const accountsWithOptionOrders = await prisma.paperOrder.findMany({
    where: { instrumentKind: { in: ["INDEX_OPTION", "STOCK_OPTION"] } },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  const seen = new Map<string, CaptureCandidate>();
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
 * All-expiry index capture (2026-08-11, see module doc) — every listed
 * expiry of every index underlying (`INDEX_OPTION_UNDERLYINGS`, the shared
 * registry, never a locally duplicated list), with `daysToExpiry` computed
 * against `asOfDate` so the near/far split below can be date-driven. A
 * per-underlying fetch failure (chain endpoint down, no expiries returned)
 * drops just that one underlying's expiries for this run — never throws,
 * matching every other function in this file's failure posture.
 */
async function collectIndexExpiryCandidates(
  asOfDate: Date
): Promise<Array<{ underlying: string; expiryStr: string; daysToExpiry: number }>> {
  const todayUtcMidnight = Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate());

  const results = await Promise.all(
    INDEX_OPTION_UNDERLYINGS.map(async (underlying: string) => {
      try {
        const expiries = await fetchOptionChainExpiries(underlying);
        return expiries
          .map((expiryStr) => {
            const expiryDate = parseNseExpiryDate(expiryStr);
            if (!expiryDate) return null;
            const daysToExpiry = Math.round((expiryDate.getTime() - todayUtcMidnight) / 86_400_000);
            return { underlying, expiryStr, daysToExpiry };
          })
          .filter((c): c is { underlying: string; expiryStr: string; daysToExpiry: number } => c !== null);
      } catch {
        return [];
      }
    })
  );
  return results.flat();
}

/**
 * Legacy mode (flag OFF) only — restored from bc90714's
 * `collectAlwaysOnIndexCandidates`, renamed but otherwise unchanged: one
 * candidate per index underlying, pinned to that underlying's OWN nearest
 * weekly expiry (`fetchOptionChainExpiries(underlying)[0]` — that
 * function's own documented contract is "nearest first"). A per-underlying
 * fetch failure drops just that one underlying for this run — never throws,
 * matching every other function in this file's failure posture.
 */
async function collectNearestWeeklyIndexCandidates(): Promise<CaptureCandidate[]> {
  const results = await Promise.all(
    INDEX_OPTION_UNDERLYINGS.map(async (underlying: string): Promise<CaptureCandidate | null> => {
      try {
        const expiries = await fetchOptionChainExpiries(underlying);
        const nearest = expiries[0];
        return nearest ? { underlying, expiryStr: nearest } : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((c): c is CaptureCandidate => c !== null);
}

/**
 * Merges open-position + recently-viewed signals for the STOCK slow track
 * only (index tiers are handled separately — see collectIndexExpiryCandidates
 * and the near/far split in runPremiumCapture). A pair present in both
 * sources keeps `hasOpenPosition: true` (never downgraded) and the MAX
 * `lastViewedAt` across sources.
 */
function mergeStockCandidates(
  openPositions: CaptureCandidate[],
  recentlyViewed: Array<{ underlying: string; expiryStr: string; lastViewedAt: number }>
): StockCandidate[] {
  const byKey = new Map<string, StockCandidate>();
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
 * Defensive circuit breaker for the STOCK slow track only — guards against
 * unbounded VIEWING traffic (bot/scripted re-viewing many chains), a vector
 * that does NOT apply to the index near/far tiers (their membership is
 * derived from live NSE expiry lists + real account positions, never user
 * traffic — see module doc). Every `hasOpenPosition` candidate always
 * survives; remaining slots up to `max` are filled by merely-viewed
 * candidates, most-recently-viewed first.
 */
function capStockCandidates(candidates: StockCandidate[], max: number): { kept: StockCandidate[]; dropped: number } {
  const neverDropped = candidates.filter((c) => c.hasOpenPosition);
  const viewedOnly = candidates.filter((c) => !c.hasOpenPosition).sort((a, b) => b.lastViewedAt - a.lastViewedAt);

  const remainingSlots = Math.max(0, max - neverDropped.length);
  const keptViewedOnly = viewedOnly.slice(0, remainingSlots);
  const dropped = viewedOnly.length - keptViewedOnly.length;

  return { kept: [...neverDropped, ...keptViewedOnly], dropped };
}

/**
 * Legacy mode (flag OFF) only — restored from bc90714's 3-way
 * `mergeCandidates`, scoped to index candidates only (the stock slow track
 * has its own 2-way `mergeStockCandidates` above, unchanged in both modes).
 * A pair present in multiple sources keeps every `true` flag it earned from
 * ANY source (never downgraded) and the MAX `lastViewedAt` across sources.
 */
function mergeLegacyIndexCandidates(
  alwaysOnNearestWeekly: CaptureCandidate[],
  openPositions: CaptureCandidate[],
  recentlyViewed: Array<{ underlying: string; expiryStr: string; lastViewedAt: number }>
): LegacyIndexCandidate[] {
  const byKey = new Map<string, LegacyIndexCandidate>();
  for (const c of alwaysOnNearestWeekly) {
    byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: false, alwaysOn: true, lastViewedAt: 0 });
  }
  for (const c of openPositions) {
    const existing = byKey.get(candidateKey(c));
    if (existing) {
      existing.hasOpenPosition = true;
    } else {
      byKey.set(candidateKey(c), { underlying: c.underlying, expiryStr: c.expiryStr, hasOpenPosition: true, alwaysOn: false, lastViewedAt: 0 });
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
 * Legacy mode (flag OFF) only — restored from bc90714's `capCandidates`,
 * scoped to index candidates. Every `hasOpenPosition` OR `alwaysOn`
 * candidate always survives (real account exposure and the always-on
 * nearest-weekly floor are never sacrificed to a write-volume budget);
 * remaining slots up to `max` are filled by merely-viewed candidates,
 * most-recently-viewed first.
 */
function capLegacyIndexCandidates(candidates: LegacyIndexCandidate[], max: number): { kept: LegacyIndexCandidate[]; dropped: number } {
  const neverDropped = candidates.filter((c) => c.hasOpenPosition || c.alwaysOn);
  const viewedOnly = candidates.filter((c) => !c.hasOpenPosition && !c.alwaysOn).sort((a, b) => b.lastViewedAt - a.lastViewedAt);

  const remainingSlots = Math.max(0, max - neverDropped.length);
  const keptViewedOnly = viewedOnly.slice(0, remainingSlots);
  const dropped = viewedOnly.length - keptViewedOnly.length;

  return { kept: [...neverDropped, ...keptViewedOnly], dropped };
}

/** Nearest strike to the chain's own live underlyingValue — same "nearest wins" definition option-chain-browser.tsx uses client-side for its ATM highlight. Per-expiry: each fetchOptionChain call returns ONLY that expiry's own strikes (verified live 2026-08-11 — see module doc's "MECHANICAL FACT CHECKED" section), windowed here against the shared live underlyingValue (correct by construction — ATM is defined against the current spot, which is the same number regardless of which expiry is being windowed). */
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

/**
 * Fetches + windows every candidate, writing rows into `allRows`. Runs
 * `concurrency` fetches in flight at once (default 1 — the original
 * strictly-sequential no-hammer behavior, still used for the near-tier
 * rounds and the stock slow track). Only the far-tier pass opts into
 * `concurrency: FAR_TIER_FETCH_CONCURRENCY` — see module doc for the
 * live-measured 3.2x speedup and confirmation that concurrency doesn't
 * change which fetches fail.
 */
async function captureTrack(
  candidates: CaptureCandidate[],
  captureIntervalSec: number,
  capturedAt: Date,
  result: PremiumCaptureRunResult,
  options: { forceFresh?: boolean; concurrency?: number } = {}
): Promise<Prisma.OptionPremiumSnapshotCreateManyInput[]> {
  const allRows: Prisma.OptionPremiumSnapshotCreateManyInput[] = [];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, candidates.length || 1));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex++];
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
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return allRows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Near-tier index rounds (2026-08-11, see module doc) — runs `nearCandidates`
 * through `ALWAYS_ON_ROUND_OFFSETS_MS.length` rounds (normally 4), each
 * anchored to a fixed offset from `runStartedAt` rather than chained off the
 * PREVIOUS round's own finish time, so per-round latency (a slow underlying,
 * upstream jitter) never compounds into schedule drift across the sequence.
 * Each round fetches with `forceFresh: true` (bypassing the chain cache's
 * read-side throttle entirely) rather than trusting elapsed wall-clock time
 * to have outrun the cache TTL — the TTL and the round spacing are both 15s,
 * so a timing-only approach would race that boundary. Writes each round's
 * rows immediately (not batched to the end) so a mid-sequence failure still
 * preserves whatever rounds already completed. A round whose target start
 * time has already passed `ALWAYS_ON_ROUND_HARD_DEADLINE_MS` is skipped
 * outright, never delayed.
 */
async function runNearTierRounds(
  nearCandidates: CaptureCandidate[],
  runStartedAt: number,
  result: PremiumCaptureRunResult
): Promise<void> {
  if (nearCandidates.length === 0) return;

  for (const offsetMs of ALWAYS_ON_ROUND_OFFSETS_MS) {
    if (Date.now() - runStartedAt > ALWAYS_ON_ROUND_HARD_DEADLINE_MS) {
      result.nearTierRoundsSkippedByDeadline += 1;
      continue;
    }

    const waitMs = runStartedAt + offsetMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);

    const capturedAt = new Date();
    const rows = await captureTrack(nearCandidates, ALWAYS_ON_NEAR_CAPTURE_INTERVAL_SEC, capturedAt, result, { forceFresh: true });
    if (rows.length > 0) {
      const written = await prisma.optionPremiumSnapshot.createMany({ data: rows });
      result.snapshotsWritten += written.count;
    }
    result.nearTierRoundsCompleted += 1;
  }
}

/**
 * Far-tier index pass (2026-08-11, see module doc) — captures `farCandidates`
 * exactly once per invocation at `ALWAYS_ON_FAR_CAPTURE_INTERVAL_SEC` (60s)
 * cadence, fetching `FAR_TIER_FETCH_CONCURRENCY`-way concurrent rather than
 * sequential — live-measured 2026-08-11 at ~4.9s for 24 real candidates vs
 * ~15.75s sequential, with an identical failure set at both concurrency
 * levels. Runs concurrently ALONGSIDE `runNearTierRounds` (see
 * `runPremiumCapture`'s `Promise.all`), never nested inside round 0 — nesting
 * it there was the original naive design and measured as pushing round 1's
 * 15s-offset target ~5s late.
 */
async function runFarTierOnce(farCandidates: CaptureCandidate[], result: PremiumCaptureRunResult): Promise<void> {
  if (farCandidates.length === 0) return;

  const capturedAt = new Date();
  const rows = await captureTrack(farCandidates, ALWAYS_ON_FAR_CAPTURE_INTERVAL_SEC, capturedAt, result, {
    forceFresh: true,
    concurrency: FAR_TIER_FETCH_CONCURRENCY
  });
  if (rows.length > 0) {
    const written = await prisma.optionPremiumSnapshot.createMany({ data: rows });
    result.snapshotsWritten += written.count;
  }
}

/**
 * Single-stock slow track (unchanged cadence/candidate-selection logic,
 * restructured 2026-08-11 to run CONCURRENTLY with the index near/far tiers
 * instead of sequentially before them — see module doc's TIMING section for
 * why the old sequential-before ordering was a pre-existing latent risk on
 * real 5-minute boundaries).
 */
async function runSlowTrackOnce(slowCandidates: StockCandidate[], result: PremiumCaptureRunResult): Promise<void> {
  if (slowCandidates.length === 0) return;

  const capturedAt = new Date();
  const rows = await captureTrack(slowCandidates, SLOW_TRACK_CAPTURE_INTERVAL_SEC, capturedAt, result);
  if (rows.length > 0) {
    const written = await prisma.optionPremiumSnapshot.createMany({ data: rows });
    result.snapshotsWritten += written.count;
  }
}

/**
 * Process-local re-entrancy guard. `runPremiumCapture` can now take up to
 * `ALWAYS_ON_ROUND_HARD_DEADLINE_MS` (58s) to complete, close to the
 * every-minute cron cadence itself; without this guard an unusually slow
 * invocation overlapping the next one would risk two concurrent runs racing
 * writes/chain-cache state. Single boolean is sufficient — this route runs
 * single-instance (same accepted limitation `optionChain.ts`'s in-module
 * caches already carry).
 */
let captureInProgress = false;

/**
 * Captures premium snapshots for every candidate contract, split into three
 * concurrent tracks — near-tier index (15s × 4 rounds), far-tier index (60s
 * × 1, ALL_EXPIRIES mode only), and single-stock (300s × 1, every real
 * 5-minute IST boundary) — see module doc for the full tiering/timing/volume
 * reasoning. Index candidate selection is GATED by `PREMIUM_CAPTURE_ALL_EXPIRIES`
 * (module-level, read once at import time — see module doc's
 * "Feature-flagged" section): ON builds near/far tiers from every listed
 * expiry; OFF (default) restores the pre-all-expiry bc90714 behavior
 * (nearest-weekly-per-underlying always-on + open positions + recently-viewed,
 * all in the near tier, no far tier). The single-stock track and the
 * near/far ROUND-EXECUTION machinery (`runNearTierRounds`/`runFarTierOnce`)
 * are identical in both modes — only candidate SELECTION differs. Self-gates
 * on `isNseWeekdayMarketHours()` regardless of when the cron itself fired —
 * a slightly-loose crontab bound (the brief's coarse hour-window filter)
 * never writes off-session ticks. Never throws — per-candidate failures are
 * caught and counted. Guarded against re-entrancy (see `captureInProgress`)
 * — an overlapping invocation returns immediately with
 * `skippedDueToOverlap: true` rather than racing the one already running.
 */
export async function runPremiumCapture(now: Date = new Date()): Promise<PremiumCaptureRunResult> {
  const result: PremiumCaptureRunResult = {
    ranOutsideMarketHours: false,
    skippedDueToOverlap: false,
    slowTrackSkipped: false,
    indexExpiriesObserved: 0,
    nearestWeeklyResolved: 0,
    nearTierCandidates: 0,
    farTierCandidates: 0,
    slowTrackCandidates: 0,
    candidatesDroppedByCap: 0,
    chainFetchFailures: 0,
    snapshotsWritten: 0,
    errors: 0,
    nearTierRoundsCompleted: 0,
    nearTierRoundsSkippedByDeadline: 0,
    allExpiriesEnabled: PREMIUM_CAPTURE_ALL_EXPIRIES
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

    const [openPositionCandidates, recentlyViewedCandidates] = await Promise.all([
      collectOpenPositionCandidates(),
      Promise.resolve(collectRecentlyViewedCandidates())
    ]);
    const openPositionKeySet = new Set(openPositionCandidates.map(candidateKey));
    const indexOpenPositions = openPositionCandidates.filter((c) => isIndexUnderlying(c.underlying));
    const indexRecentlyViewed = recentlyViewedCandidates.filter((c) => isIndexUnderlying(c.underlying));

    let nearTierCandidates: CaptureCandidate[];
    let farTierCandidates: CaptureCandidate[];

    if (PREMIUM_CAPTURE_ALL_EXPIRIES) {
      // ALL_EXPIRIES mode — see module doc. Every listed index expiry lands
      // in EXACTLY one of near/far — near if it's within NEAR_TERM_MAX_DAYS
      // OR currently holds an open position (promoted regardless of date),
      // far otherwise. No cap: membership is deterministic (live NSE data +
      // real positions), not traffic-driven.
      const indexExpiryCandidates = await collectIndexExpiryCandidates(now);
      result.indexExpiriesObserved = indexExpiryCandidates.length;

      nearTierCandidates = [];
      farTierCandidates = [];
      for (const c of indexExpiryCandidates) {
        const candidate = { underlying: c.underlying, expiryStr: c.expiryStr };
        const isNearByDate = c.daysToExpiry <= NEAR_TERM_MAX_DAYS;
        const hasOpenPosition = openPositionKeySet.has(candidateKey(candidate));
        (isNearByDate || hasOpenPosition ? nearTierCandidates : farTierCandidates).push(candidate);
      }
    } else {
      // Legacy mode (default, flag OFF) — restored from bc90714, see module
      // doc. Nearest-weekly-per-underlying (always-on) + index open
      // positions + recently-viewed index contracts, all joining the SAME
      // 15s near-tier round loop, capped by LEGACY_NEAR_TRACK_MAX_CANDIDATES
      // (never dropping an always-on or open-position candidate). No far
      // tier at all in this mode.
      const nearestWeekly = await collectNearestWeeklyIndexCandidates();
      result.nearestWeeklyResolved = nearestWeekly.length;

      const legacyMerged = mergeLegacyIndexCandidates(nearestWeekly, indexOpenPositions, indexRecentlyViewed);
      const legacyCapped = capLegacyIndexCandidates(legacyMerged, LEGACY_NEAR_TRACK_MAX_CANDIDATES);
      result.candidatesDroppedByCap += legacyCapped.dropped;

      nearTierCandidates = legacyCapped.kept.map((c) => ({ underlying: c.underlying, expiryStr: c.expiryStr }));
      farTierCandidates = [];
    }

    result.nearTierCandidates = nearTierCandidates.length;
    result.farTierCandidates = farTierCandidates.length;

    // Single-stock slow track: open positions + recently-viewed, STOCK
    // underlyings only — index is fully covered by the near/far split above.
    const stockOpenPositions = openPositionCandidates.filter((c) => !isIndexUnderlying(c.underlying));
    const stockRecentlyViewed = recentlyViewedCandidates.filter((c) => !isIndexUnderlying(c.underlying));
    const stockMerged = mergeStockCandidates(stockOpenPositions, stockRecentlyViewed);
    const slowCapped = runSlowTrack ? capStockCandidates(stockMerged, SLOW_TRACK_MAX_CANDIDATES) : { kept: [] as StockCandidate[], dropped: 0 };
    result.slowTrackCandidates = slowCapped.kept.length;
    result.candidatesDroppedByCap += slowCapped.dropped;

    // All three tracks run CONCURRENTLY, sharing one runStartedAt-anchored
    // clock — see module doc's TIMING section for why sequential-before was
    // a latent risk on 5-minute boundaries in the prior single-track design.
    await Promise.all([
      runNearTierRounds(nearTierCandidates, runStartedAt, result),
      runFarTierOnce(farTierCandidates, result),
      runSlowTrackOnce(slowCapped.kept, result)
    ]);

    return result;
  } finally {
    captureInProgress = false;
  }
}
