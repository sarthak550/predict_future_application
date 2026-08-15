/**
 * Domain-only allowlist for analyst opinion extraction.
 *
 * Moved here (Trust Layer Sprint T3, 2026-08-15) from
 * apps/api/lib/ai/extractExpertOpinions.ts so apps/web's /methodology page can import
 * the SAME constant apps/api's extraction pipeline actually gates on — apps/web cannot
 * import apps/api's server code directly (separate deployable), and the brief's explicit
 * requirement is to "query the current allowlist at implementation time" rather than
 * hardcode a copy that silently goes stale the next time this list changes (it has
 * already changed at least once — see the S74-T1 history below). A shared constant in
 * business-rules is the only way both sides can literally be looking at the same array,
 * not two copies that could drift.
 *
 * S74-T1: previously gated on domain AND a narrow URL path-prefix allowlist (e.g. ET
 * only /markets/expert-view, /opinion/columns/; CNBC TV18 only /views/,
 * /market/expert-views/). That path gate meant general finance NEWS on the same
 * approved domains — the bulk of ET/Mint/CNBC coverage, which regularly contains named
 * analyst/brokerage calls in ordinary market-report stories — never reached the
 * extractor. Root-caused in prod: 424 FINANCE stories/7d, only 81 had opinions (19% hit
 * rate); CNBC TV18 alone was 111 stories/week with 0 opinions because nothing matched
 * the narrow prefixes.
 *
 * The quality bar now lives entirely downstream in validateRawOpinions() and the
 * EXTRACTION_SYSTEM_PROMPT (named-expert-or-institution requirement, numeric-anchor +
 * unit-token check, 0.82 confidence floor, 80-char quote floor, one-direction-per-
 * expert-instrument collapse) — that AI+validator combo is strict enough to hold the
 * quality line on its own (89% hit rate on curated ET Expert View feeds proves it).
 * Do NOT add path gating back here; if quality drifts on newly-opened general-news
 * paths, tighten the validator's numeric-anchor or confidence floor instead.
 *
 * bqprime.com and ndtvprofit.com were removed here — both had zero matching RSS feed
 * in rssSources.ts (dead allowlist entries that never fired). seekingalpha.com was
 * removed — its RSS source is isActive:false (killed in the news-source overhaul), so
 * global/non-Indian expansion is explicitly out of scope. See S74-T3 for the
 * replacement domain (NDTV Profit, once verified live) plus new source additions.
 */
export const ANALYST_OPINION_SOURCES: string[] = [
  "economictimes.indiatimes.com",
  "cnbctv18.com",
  "livemint.com",
  "moneycontrol.com",
];
