/**
 * Shadow portfolios (P3.3) — orchestration for auto-generating and
 * incrementally maintaining one SHADOW Portfolio per Expert with >=1 graded
 * BULLISH call, backed by historical NSE bhavcopy closes.
 *
 * All pure eligibility/simulation/session-mapping math lives in
 * packages/business-rules/src/portfolios/shadow.ts — this file is DB + network
 * orchestration only: load ExpertOpinion/Expert rows, backfill whatever
 * StockEodQuote sessions the eligible calls need (via
 * apps/api/lib/marketMoves/bhavcopy.ts, the same fetcher the live Market Pulse
 * EOD cron uses), ask the engine for a plan, diff it against what's already
 * been written, and persist the difference.
 *
 * Used by:
 *  - apps/api/scripts/backfill-shadow-portfolios.ts (one-time historical backfill, --dry-run default)
 *  - apps/api/app/api/cron/portfolios-shadow/route.ts (nightly incremental run)
 *
 * Idempotency:
 *  - StockEodQuote coverage: createMany/skipDuplicates keyed on the model's
 *    (sessionDate, symbol) unique constraint — re-fetching a session that's
 *    already stored is a cheap no-op write, and already-covered sessions are
 *    skipped before ever hitting the network (see ensureQuoteCoverage).
 *  - Portfolio: found-or-created per Expert, keyed on (kind: SHADOW, ownerExpertId).
 *  - PortfolioTransaction: the full desired transaction list is recomputed
 *    from scratch every run (a fresh chronological cash-simulated replay of
 *    ALL of the expert's currently-eligible calls — see
 *    planShadowTransactions) and diffed against existing EXECUTED rows on
 *    (portfolioId, symbol, side, executionSessionDate); only rows missing
 *    from that diff are written. A second run with no new graded calls and
 *    no new quotes writes zero transactions.
 *
 * KNOWN EDGE CASE (documented, not solved): because EXECUTED rows are never
 * mutated once written (app-layer invariant — see the schema doc on
 * PortfolioTransaction), and the plan is recomputed fresh each run, an
 * out-of-order discovery — a call whose publishedAt is EARLIER than calls
 * that were already written in a prior run, but which itself only became
 * eligible (e.g. got graded) LATER — could in theory produce a plan whose
 * simulated cash timeline differs from what's already persisted (e.g. the
 * newly-discovered earlier BUY "steals" cash a later, already-EXECUTED BUY
 * had used in a previous run's simulation). This cannon be reconciled without
 * either mutating already-EXECUTED rows (disallowed) or re-deriving cash from
 * a source other than the immutable transaction log (which would break the
 * "structurally immutable" design of the whole Portfolio model). In practice
 * this requires an article to be extracted and graded weeks after a
 * chronologically-later call from the same expert already settled, which is
 * rare given the extraction pipeline processes stories close to publication.
 */

import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import { fetchBhavcopySession } from "@/lib/marketMoves/bhavcopy";
import { backfillDailyValues } from "@/lib/portfolios/valuation";
import { prisma } from "@/lib/prisma";

import {
  candidateSessionDates,
  filterShadowEligibleCalls,
  planShadowTransactions,
  shadowPortfolioDescription,
  shadowPortfolioName,
  shadowPortfolioSlugBase,
  type ShadowEligibleCall,
  type ShadowOpinionInput,
  type ShadowPriceLookup,
  type ShadowSkippedCall,
  type ShadowTransactionPlan
} from "@predict-future/business-rules/portfolios/shadow";

/** Hard cap on distinct bhavcopy sessions fetched over the network in a single run — keeps both the one-time backfill and the nightly incremental cron bounded and polite to NSE's archives host. */
const MAX_SESSIONS_PER_RUN = 80;

/** Delay between successive bhavcopy fetches, matching the "be polite" guidance used elsewhere in the Market Pulse pipeline (import-manifold-markets.ts's PAGE_DELAY_MS is the closest existing precedent). */
const FETCH_DELAY_MS = 400;

/** Batch size for StockEodQuote createMany calls — mirrors QUOTE_UPSERT_BATCH_SIZE in the market-moves-movers cron route. */
const QUOTE_INSERT_BATCH_SIZE = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ShadowGenerationOptions {
  /** When true, computes and logs the full plan but performs NO writes (no StockEodQuote inserts, no Portfolio/PortfolioTransaction writes, no valuation backfill). Default false. */
  dryRun?: boolean;
  /** Limit the run to a single expert (matched by Expert.slug) — used by the backfill script's --expert flag. Omit to process every expert. */
  expertSlug?: string;
  /** Overrides MAX_SESSIONS_PER_RUN — exposed for tests, not for normal callers. */
  maxSessionsPerRun?: number;
}

export interface ShadowExpertSummary {
  expertId: string;
  expertName: string;
  expertSlug: string | null;
  /** Calls passing the STATIC eligibility filter (direction/status/symbol), before quote resolution. */
  staticallyEligibleCallCount: number;
  /** BUY+SELL pairs actually planned after quote resolution (2x the number of fully-eligible calls). */
  plannedTransactionCount: number;
  skippedCalls: ShadowSkippedCall[];
  portfolioAction: "created" | "existing" | "none";
  portfolioId: string | null;
  portfolioSlug: string | null;
  transactionsWritten: number;
  transactionsAlreadyPresent: number;
}

export interface ShadowGenerationResult {
  dryRun: boolean;
  expertsScanned: number;
  expertsWithStaticallyEligibleCalls: number;
  expertsWithPortfolios: number;
  portfoliosCreated: number;
  sessionsFetched: number;
  sessionsWithData: number;
  quoteRowsInserted: number;
  sessionFetchBudgetExhausted: boolean;
  transactionsWritten: number;
  transactionsAlreadyPresent: number;
  transactionsSkipped: number;
  errors: { expertId: string; expertName: string; message: string }[];
  perExpert: ShadowExpertSummary[];
}

function priceKey(symbol: string, sessionDate: Date): string {
  return `${symbol}|${sessionDate.toISOString()}`;
}

function txnKey(symbol: string, side: "BUY" | "SELL", executionSessionDate: Date): string {
  return `${symbol}|${side}|${executionSessionDate.toISOString()}`;
}

/**
 * Ensures StockEodQuote coverage for every (symbol, candidate-session-date)
 * pair the given calls' BUY/SELL legs might need, fetching only what's
 * missing from the DB and only as far forward as actually required — an
 * "expanding ring" search: try every unresolved leg's day-0 candidate first,
 * then day-1 for whatever's still unresolved, etc., up to
 * SESSION_SEARCH_FORWARD_CAP. Distinct calendar dates needed by multiple legs
 * (common — many calls share entry/exit weeks) are fetched exactly once.
 * Never throws — a failed fetch for one session is logged and treated as "no
 * data for that session" so the run continues.
 */
async function ensureQuoteCoverage(
  calls: ShadowEligibleCall[],
  options: { dryRun: boolean; maxSessions: number }
): Promise<{
  priceMap: Map<string, number>;
  sessionsFetched: number;
  sessionsWithData: number;
  quoteRowsInserted: number;
  budgetExhausted: boolean;
}> {
  const priceMap = new Map<string, number>();
  const sessionOutcome = new Map<string, "empty" | "fetched">(); // sessionDate ISO -> outcome, dedupes fetches within this run
  let sessionsFetched = 0;
  let sessionsWithData = 0;
  let quoteRowsInserted = 0;
  let budgetExhausted = false;

  type Leg = { symbol: string; instant: Date };
  const legs: Leg[] = [];
  for (const call of calls) {
    legs.push({ symbol: call.symbol, instant: call.publishedAt });
    legs.push({ symbol: call.symbol, instant: call.resolvedAt });
  }
  if (legs.length === 0) {
    return { priceMap, sessionsFetched, sessionsWithData, quoteRowsInserted, budgetExhausted };
  }

  // Seed from existing DB rows across the full candidate window up front — a
  // rerun with everything already covered fetches nothing over the network.
  const allCandidateDates = legs.flatMap((leg) => candidateSessionDates(leg.instant));
  const minDate = new Date(Math.min(...allCandidateDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allCandidateDates.map((d) => d.getTime())));
  const existingQuotes = await prisma.stockEodQuote.findMany({
    where: { sessionDate: { gte: minDate, lte: maxDate } },
    select: { symbol: true, sessionDate: true, close: true }
  });
  for (const q of existingQuotes) {
    priceMap.set(priceKey(q.symbol, q.sessionDate), q.close);
  }
  const knownSessionDates = new Set(existingQuotes.map((q) => q.sessionDate.toISOString()));
  for (const iso of knownSessionDates) sessionOutcome.set(iso, "fetched");

  const resolvedLeg = (leg: Leg, offset: number): boolean => {
    const candidates = candidateSessionDates(leg.instant);
    const sessionDate = candidates[offset];
    return sessionDate !== undefined && priceMap.has(priceKey(leg.symbol, sessionDate));
  };

  outer: for (let offset = 0; offset <= /* SESSION_SEARCH_FORWARD_CAP */ 5; offset++) {
    const unresolvedLegs = legs.filter((leg) => {
      // A leg is "still unresolved" if none of its candidates up to and including this offset matched yet.
      for (let o = 0; o < offset; o++) if (resolvedLeg(leg, o)) return false;
      return true;
    });
    if (unresolvedLegs.length === 0) break;

    const neededDatesThisOffset = new Map<string, Date>();
    for (const leg of unresolvedLegs) {
      const candidates = candidateSessionDates(leg.instant);
      const sessionDate = candidates[offset];
      if (!sessionDate) continue;
      neededDatesThisOffset.set(sessionDate.toISOString(), sessionDate);
    }

    for (const [iso, sessionDate] of neededDatesThisOffset) {
      if (sessionOutcome.has(iso)) continue; // already fetched (or DB-seeded) this run
      if (sessionsFetched >= options.maxSessions) {
        budgetExhausted = true;
        break outer;
      }

      sessionsFetched += 1;

      // NOTE: dry-run still performs the (read-only) bhavcopy fetch — only the
      // DB writes below are skipped. This is deliberate: a dry run whose price
      // lookups were always empty could never preview a realistic transaction
      // plan, defeating its purpose as a pre-flight check. Fetching NSE's
      // public archives CSV is harmless to repeat and costs nothing to undo.
      let session;
      try {
        session = await fetchBhavcopySession(sessionDate);
      } catch (err) {
        console.error(`[shadowGenerator] bhavcopy fetch failed for ${iso}:`, err);
        session = null;
      }

      if (session && session.quotes.length > 0) {
        sessionsWithData += 1;
        sessionOutcome.set(iso, "fetched");

        if (!options.dryRun) {
          const rows = session.quotes.map((q) => ({
            sessionDate,
            symbol: q.symbol,
            companyName: q.companyName,
            prevClose: q.prevClose,
            close: q.close,
            changePercent: q.changePercent,
            volume: Math.round(q.volume),
            deliveryPct: q.deliveryPct
          }));
          for (let i = 0; i < rows.length; i += QUOTE_INSERT_BATCH_SIZE) {
            const batch = rows.slice(i, i + QUOTE_INSERT_BATCH_SIZE);
            try {
              const result = await prisma.stockEodQuote.createMany({ data: batch, skipDuplicates: true });
              quoteRowsInserted += result.count;
            } catch (err) {
              console.error(`[shadowGenerator] StockEodQuote batch insert failed for ${iso} (offset ${i}):`, err);
            }
          }
        }
        for (const q of session.quotes) {
          priceMap.set(priceKey(q.symbol, sessionDate), q.close);
        }
      } else {
        sessionOutcome.set(iso, "empty");
      }

      await sleep(FETCH_DELAY_MS);
    }
  }

  return { priceMap, sessionsFetched, sessionsWithData, quoteRowsInserted, budgetExhausted };
}

/** Concrete ShadowPriceLookup backed by the priceMap ensureQuoteCoverage just built. */
function buildPriceLookup(priceMap: Map<string, number>): ShadowPriceLookup {
  return {
    resolve(symbol: string, instant: Date) {
      for (const sessionDate of candidateSessionDates(instant)) {
        const close = priceMap.get(priceKey(symbol, sessionDate));
        if (close != null) return { sessionDate, close };
      }
      return null;
    }
  };
}

const MAX_SLUG_COLLISION_ATTEMPTS = 50;

/** Collision-checked, deterministic slug for a new shadow Portfolio — mirrors generateUniqueExpertSlug's approach (apps/api/lib/finance/expertSlug.ts) but against Portfolio.slug. */
async function generateUniqueShadowSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_SLUG_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.portfolio.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Finds or creates this expert's SHADOW portfolio. Returns null (creates nothing) when `plan.transactions` is empty — a Portfolio is only created once an expert has at least one FULLY eligible call (static eligibility + resolvable quotes for both legs). */
async function ensurePortfolio(
  expert: { id: string; name: string; slug: string | null },
  hasPlannedTransactions: boolean,
  dryRun: boolean
): Promise<{ portfolio: { id: string; slug: string } | null; action: "created" | "existing" | "none" }> {
  const existing = await prisma.portfolio.findFirst({
    where: { kind: "SHADOW", ownerExpertId: expert.id },
    select: { id: true, slug: true }
  });
  if (existing) return { portfolio: existing, action: "existing" };

  if (!hasPlannedTransactions) return { portfolio: null, action: "none" };

  // Slug resolution is read-only (findUnique probes), so it runs identically in
  // dry-run and live mode — the previewed slug in a dry-run report is the exact
  // slug a live run would assign, not a placeholder.
  const slugBase = shadowPortfolioSlugBase(expert.slug ?? expert.id);
  const slug = await generateUniqueShadowSlug(slugBase);

  if (dryRun) {
    return { portfolio: { id: "(dry-run, not yet created)", slug }, action: "created" };
  }

  const created = await prisma.portfolio.create({
    data: {
      ownerExpertId: expert.id,
      kind: "SHADOW",
      name: shadowPortfolioName(expert.name),
      slug,
      visibility: "PUBLIC",
      description: shadowPortfolioDescription(expert.name),
      startingCapital: 1_000_000,
      publicSince: new Date()
    },
    select: { id: true, slug: true }
  });
  return { portfolio: created, action: "created" };
}

/** Diffs the plan's transactions against already-EXECUTED rows for this portfolio and writes only what's missing. Match key is (portfolioId, symbol, side, executionSessionDate) per the P3.3 design — see the module doc's KNOWN EDGE CASE note for the accepted tradeoff this implies. */
async function writeMissingTransactions(
  portfolioId: string,
  plannedTransactions: ShadowTransactionPlan[],
  dryRun: boolean
): Promise<{ written: number; alreadyPresent: number }> {
  if (plannedTransactions.length === 0) return { written: 0, alreadyPresent: 0 };

  const existing = await prisma.portfolioTransaction.findMany({
    where: { portfolioId, status: "EXECUTED" },
    select: { symbol: true, side: true, executionSessionDate: true }
  });
  const existingKeys = new Set(
    existing
      .filter((tx) => tx.executionSessionDate != null)
      .map((tx) => txnKey(tx.symbol, tx.side, tx.executionSessionDate as Date))
  );

  let written = 0;
  let alreadyPresent = 0;
  for (const tx of plannedTransactions) {
    const key = txnKey(tx.symbol, tx.side, tx.executionSessionDate);
    if (existingKeys.has(key)) {
      alreadyPresent += 1;
      continue;
    }
    if (!dryRun) {
      await prisma.portfolioTransaction.create({
        data: {
          portfolioId,
          symbol: tx.symbol,
          side: tx.side,
          quantity: tx.quantity,
          requestedAt: tx.requestedAt,
          status: "EXECUTED",
          executionSessionDate: tx.executionSessionDate,
          priceAtTx: tx.priceAtTx
        }
      });
    }
    written += 1;
    existingKeys.add(key); // guard against duplicate BUY/SELL legs colliding within the same plan
  }
  return { written, alreadyPresent };
}

/**
 * Runs shadow-portfolio generation: loads every expert's statically-eligible
 * calls, backfills whatever StockEodQuote coverage they need, plans each
 * expert's full transaction history, and writes whatever's missing. Never
 * throws — per-expert failures are caught and counted so one bad expert
 * can't block the rest of the run.
 */
export async function runShadowGeneration(options: ShadowGenerationOptions = {}): Promise<ShadowGenerationResult> {
  const dryRun = options.dryRun ?? false;
  const maxSessionsPerRun = options.maxSessionsPerRun ?? MAX_SESSIONS_PER_RUN;

  const result: ShadowGenerationResult = {
    dryRun,
    expertsScanned: 0,
    expertsWithStaticallyEligibleCalls: 0,
    expertsWithPortfolios: 0,
    portfoliosCreated: 0,
    sessionsFetched: 0,
    sessionsWithData: 0,
    quoteRowsInserted: 0,
    sessionFetchBudgetExhausted: false,
    transactionsWritten: 0,
    transactionsAlreadyPresent: 0,
    transactionsSkipped: 0,
    errors: [],
    perExpert: []
  };

  let expertFilter: { id: string; name: string; slug: string | null } | undefined;
  if (options.expertSlug) {
    const found = await prisma.expert.findUnique({
      where: { slug: options.expertSlug },
      select: { id: true, name: true, slug: true }
    });
    if (!found) {
      result.errors.push({ expertId: "", expertName: "", message: `No expert found with slug "${options.expertSlug}".` });
      return result;
    }
    expertFilter = found;
  }

  const opinions = await prisma.expertOpinion.findMany({
    where: {
      direction: "BULLISH" as OpinionDirection,
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] as OpinionResolutionStatus[] },
      suppressedAt: null,
      ...(expertFilter ? { expertId: expertFilter.id } : {})
    },
    select: {
      id: true,
      expertId: true,
      direction: true,
      resolutionStatus: true,
      instrumentTicker: true,
      publishedAt: true,
      resolvedAt: true,
      suppressedAt: true
    }
  });

  const staticallyEligible = filterShadowEligibleCalls(opinions as ShadowOpinionInput[]);
  if (staticallyEligible.length === 0) {
    return result; // nothing to do — never fetch/write when there's no eligible call at all
  }

  const callsByExpert = new Map<string, ShadowEligibleCall[]>();
  for (const call of staticallyEligible) {
    const list = callsByExpert.get(call.expertId);
    if (list) list.push(call);
    else callsByExpert.set(call.expertId, [call]);
  }

  const experts = expertFilter
    ? [expertFilter]
    : await prisma.expert.findMany({
        where: { id: { in: [...callsByExpert.keys()] } },
        select: { id: true, name: true, slug: true }
      });

  result.expertsScanned = experts.length;
  result.expertsWithStaticallyEligibleCalls = callsByExpert.size;

  // Coverage is computed ONCE across every eligible call from every expert in
  // this run — far cheaper than per-expert fetching since entry/exit dates
  // cluster together across different experts' calls on the same names/weeks.
  const coverage = await ensureQuoteCoverage(staticallyEligible, { dryRun, maxSessions: maxSessionsPerRun });
  result.sessionsFetched = coverage.sessionsFetched;
  result.sessionsWithData = coverage.sessionsWithData;
  result.quoteRowsInserted = coverage.quoteRowsInserted;
  result.sessionFetchBudgetExhausted = coverage.budgetExhausted;
  const priceLookup = buildPriceLookup(coverage.priceMap);

  for (const expert of experts) {
    const calls = callsByExpert.get(expert.id) ?? [];
    if (calls.length === 0) continue;

    try {
      const plan = planShadowTransactions(calls, 1_000_000, priceLookup);

      const { portfolio, action } = await ensurePortfolio(expert, plan.transactions.length > 0, dryRun);
      if (action === "created") result.portfoliosCreated += 1;
      if (action !== "none") result.expertsWithPortfolios += 1;

      let written = 0;
      let alreadyPresent = 0;
      if (portfolio && plan.transactions.length > 0) {
        const diffResult = await writeMissingTransactions(portfolio.id, plan.transactions, dryRun);
        written = diffResult.written;
        alreadyPresent = diffResult.alreadyPresent;
      }

      result.transactionsWritten += written;
      result.transactionsAlreadyPresent += alreadyPresent;
      result.transactionsSkipped += plan.skipped.length;

      result.perExpert.push({
        expertId: expert.id,
        expertName: expert.name,
        expertSlug: expert.slug,
        staticallyEligibleCallCount: calls.length,
        plannedTransactionCount: plan.transactions.length,
        skippedCalls: plan.skipped,
        portfolioAction: action,
        portfolioId: portfolio?.id ?? null,
        portfolioSlug: portfolio?.slug ?? null,
        transactionsWritten: written,
        transactionsAlreadyPresent: alreadyPresent
      });
    } catch (err) {
      result.errors.push({
        expertId: expert.id,
        expertName: expert.name,
        message: err instanceof Error ? err.message : String(err)
      });
      console.error(`[shadowGenerator] expert ${expert.id} (${expert.name}) failed:`, err);
    }
  }

  if (!dryRun && result.transactionsWritten > 0) {
    await backfillDailyValues();
  }

  return result;
}
