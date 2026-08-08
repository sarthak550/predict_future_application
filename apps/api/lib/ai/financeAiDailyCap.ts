/**
 * Shared daily AI-call budget for the finance pipeline.
 *
 * Originally lived only inside lib/ai/extractExpertOpinions.ts and gated JUST the
 * extraction pipeline. That meant FINANCE_AI_DAILY_CAP (500 in prod, .env.prod) was
 * NOT actually a whole-pipeline budget — the auto-resolve-opinions cron (preprocess
 * + resolve phases, lib/ai/evaluateOpinionResolution.ts) made Groq/Gemini calls with
 * no daily ceiling of its own at all, bounded only by CRON_PREPROCESS_LIMIT /
 * CRON_RESOLVE_LIMIT (row counts per run, not AI-call counts). Extracted here and
 * wired into BOTH call sites so FINANCE_AI_DAILY_CAP is what it always should have
 * been: one shared ceiling on total finance-AI spend per day, regardless of which
 * phase (extraction, resolution preprocessing, resolution verdicts) is calling.
 *
 * In-memory — resets on process restart, and does not coordinate across multiple
 * instances. Fine for this app's single-container EC2 deployment (see
 * project_ec2_prod_ops); would need a Redis/DB-backed counter to be correct under
 * horizontal scaling.
 */

let _dailyCallCount = 0;
let _dailyCallDate = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

export function getFinanceAiDailyCap(): number {
  const raw = process.env.FINANCE_AI_DAILY_CAP;
  if (!raw) return 50;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

/** Current count, for logging/reporting — does not mutate state. */
export function getFinanceAiDailyCallCount(): number {
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
 * Checks whether another finance AI call is within today's budget, and if so,
 * atomically (synchronously — no await between check and increment) counts it.
 * `context` is a short human-readable label for the log line only (e.g. a story
 * id, or "resolve:<opinionId>") — callers from different phases share the same
 * counter but can still be told apart in logs.
 */
export function checkAndIncrementFinanceAiDailyCap(context: string): boolean {
  rolloverIfNeeded();
  const cap = getFinanceAiDailyCap();
  if (_dailyCallCount >= cap) {
    console.warn(`[financeAiDailyCap] Daily AI cap reached (${_dailyCallCount}/${cap}). Skipping: ${context}.`);
    return false;
  }
  _dailyCallCount++;
  return true;
}
