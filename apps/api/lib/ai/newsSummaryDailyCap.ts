/**
 * Shared daily AI-call budget for news-summary generation, deliberately SEPARATE
 * from FINANCE_AI_DAILY_CAP (lib/ai/financeAiDailyCap.ts).
 *
 * Why a second, independent counter instead of sharing the finance cap: opinion
 * extraction + resolution is the product's moat (see project_finance_core_thesis
 * in agent memory) and must never be starved by a display-quality feature. Stock
 * news / finance-story summaries are valuable but strictly secondary — if this
 * lane's budget runs out, stories simply keep showing headline-only (never
 * blocking, never degrading), whereas if extraction's budget ran out because a
 * summarizer burned through it first, opinions would silently stop being
 * captured. Two independent ceilings make that failure mode structurally
 * impossible instead of relying on call-ordering discipline.
 *
 * Two call sites share THIS one counter (deliberately — see the CEO assignment
 * brief for the "expand stock news" program): the market-moves-news cron's
 * per-ticker Google News headline summarizer (lib/marketMoves/summarizeStockNews.ts)
 * and the general RSS pipeline's FINANCE-category story summarizer
 * (lib/news/rss-ingestion-service.ts). Both are "news summary" spend in the same
 * sense FINANCE_AI_DAILY_CAP treats extraction + resolution as one budget.
 *
 * Env contract: NEWS_SUMMARY_DAILY_CAP unset or <= 0 means the feature is OFF
 * (safe default — a fresh deploy never starts spending AI budget on summaries
 * without an explicit opt-in). Set to a positive integer (e.g. 300) to enable,
 * shared across both call sites.
 *
 * In-memory — resets on process restart, does not coordinate across multiple
 * instances. Same accepted limitation as financeAiDailyCap.ts (single-container
 * EC2 deployment per apps/api).
 */

let _dailyCallCount = 0;
let _dailyCallDate = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

/**
 * Returns the configured daily cap, or 0 (disabled) when NEWS_SUMMARY_DAILY_CAP
 * is unset, blank, or not a positive integer. Unlike getFinanceAiDailyCap(),
 * there is NO non-zero fallback default — this lane must be explicitly opted
 * into via env var, matching the "ship dark" rollout convention already used
 * elsewhere in this codebase (e.g. MARKET_PULSE_FILTER_GIST_ELIGIBLE).
 */
export function getNewsSummaryDailyCap(): number {
  const raw = process.env.NEWS_SUMMARY_DAILY_CAP;
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function isNewsSummaryLaneEnabled(): boolean {
  return getNewsSummaryDailyCap() > 0;
}

/** Current count, for logging/reporting — does not mutate state. */
export function getNewsSummaryDailyCallCount(): number {
  rolloverIfNeeded();
  return _dailyCallCount;
}

function rolloverIfNeeded(): void {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (_dailyCallDate !== todayUtc) {
    _dailyCallCount = 0;
    _dailyCallDate = todayUtc;
  }
}

/**
 * Checks whether another news-summary AI call is within today's budget, and if
 * so, atomically (synchronously — no await between check and increment) counts
 * it. `context` is a short human-readable label for the log line only (e.g. a
 * MarketMoveNews id prefixed "stockNews:" or a Story id prefixed "storyFinance:")
 * so both call sites share one counter but stay distinguishable in logs.
 */
export function checkAndIncrementNewsSummaryDailyCap(context: string): boolean {
  rolloverIfNeeded();
  const cap = getNewsSummaryDailyCap();
  if (cap <= 0) {
    return false;
  }
  if (_dailyCallCount >= cap) {
    console.warn(`[newsSummaryDailyCap] Daily AI cap reached (${_dailyCallCount}/${cap}). Skipping: ${context}.`);
    return false;
  }
  _dailyCallCount++;
  return true;
}
