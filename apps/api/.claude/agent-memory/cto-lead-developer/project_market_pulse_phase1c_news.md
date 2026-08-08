---
name: project_market_pulse_phase1c_news
description: Market Pulse Phase 1c implemented (2026-07-13) — Google News RSS replaces raw filing text as primary read surface; not yet deployed (db push/reship/APK owned by user).
metadata:
  type: project
---

Built per `.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_market_pulse_phase1c_google_news.md`. tsc clean in both apps/api and apps/mobile. NOT deployed — user runs `prisma db push` + crontab + reship + APK.

**New backend files:**
- `apps/api/lib/marketMoves/googleNews.ts` — per-ticker Google News RSS fetch+parse. Query: `"<company minus trailing Ltd/Limited/Pvt Ltd suffix>" (share OR shares OR stock) when:2d` against `news.google.com/rss/search?...&hl=en-IN&gl=IN&ceid=IN:en`. Duplicates `decodeGoogleNewsSource` from `lib/news/rssProvider.ts` (deliberate, keeps marketMoves/ self-contained). Relevance guard = ticker or company-name most-distinctive-token, both matched as WHOLE WORDS via `containsWholeWord()` (see QA fix note below — NOT `.includes()`). 48h recency guard. Top-3-per-ticker cap. dedupeKey = sha1(ticker:normalizedHeadline). 8s AbortController timeout. Never throws.
- `apps/api/lib/marketMoves/newsUniverse.ts` — `buildNewsUniverse()`: top-10-per-direction MarketMoverSnapshot ∪ last-24h MarketMoveEvent tickers with eventType != OTHER_MATERIAL (cap 40), movers prioritized, hard cap 60.
- `apps/api/lib/marketMoves/marketHours.ts` — added `isNewsRefreshWindow()` (Mon-Fri 08:00-21:00 IST), separate from the narrower `isNseWeekdayMarketHours()` used by the movers/announcements crons.
- `apps/api/app/api/cron/market-moves-news/route.ts` — CRON_SECRET-gated, sequential per-ticker fetch w/ 400ms spacing, upserts `MarketMoveNews` on dedupeKey. Intended cadence: every 30 min via EC2 crontab, 08:00-21:00 IST.
- `apps/api/app/api/finance/market-moves/news/route.ts` — public GET, base64url cursor `{publishedAt, id}`, same convention as `events/route.ts`.
- Schema: `model MarketMoveNews` added to `apps/api/prisma/schema.prisma` ONLY (after `MarketMoveNotificationPreference`, ~line 1557). `apps/web/prisma/schema.prisma` deliberately NOT touched — confirmed via grep it has zero MarketMove* models already (stale/orphaned per prior sprint finding), so no sync needed despite the brief's Decision 5 mentioning a sync step. `npx prisma generate` already run.

**Types/client:**
- `packages/types/src/index.ts` — added `ApiMarketMoveNews` + `ApiMarketMoveNewsResponse`, placed right after the existing `ApiMarketMoversResponse` block (~line 1869).
- `packages/api-client/src/index.ts` — added `getMarketMoveNews(params)` right after `getMarketMovers()` (~line 878).

**Mobile:** `apps/mobile/src/components/market-moves-tab.tsx` — added Zone 2 (`NewsCard`: ticker chip + bold headline + publisher + relative time, tap → `Linking.openURL`), rendered directly under the Top Movers strip. Wrapped the pre-existing `AnnouncementCard` feed in a collapsed-by-default "Regulatory Filings" disclosure (plain ▼/▲ Text glyph swap, same style as `PulseRibbon` in finance-mode.tsx — no Ionicons chevron used for that pattern in this codebase). Persisted via `AsyncStorage` key `market_moves_filings_collapsed`, same precedent pattern as `finance_section_collapsed_pulse`. Both zones independently loading/error/empty-stated — filings render fine even if news cron hasn't run yet (empty-news card + filings toggle both always visible).

**Scope respected:** did not touch `lib/ai/extractExpertOpinions.ts` or `lib/news/rss-ingestion-service.ts` (parallel workstream owns those; they showed as pre-existing uncommitted diffs in git status, not touched by this work).

**QA fix round (2026-07-13):** relevance guard's `.includes()` substring matching was a bypass — ticker "LT" matched inside "resu-LT-s" ("results"); picking the company name's FIRST ≥3-char token meant PSU banks/insurers (named almost entirely out of generic words) passed on "bank"/"state"/"life"/"new", so an unrelated RBI/budget/election headline wrongly matched State Bank of India, Bank of Baroda, Bank of India, LIC, New India Assurance. Fixed with `containsWholeWord()` (regex `\b...\b`, metachars escaped via `escapeRegExp`) + a `GENERIC_COMPANY_STOPWORDS` set + `mostDistinctiveNameToken()` (longest non-stopword token ≥4 chars; returns `null` — no fallback to a generic word — when every token is generic, e.g. "Bank Of India", forcing reliance on the ticker match alone). Added `stripAmpersand()` applied to both sides before matching so ticker "LT"/"M&M" still match headlines written as "L&T"/"M&M" without reintroducing the substring bypass (only removes the literal `&` connector char, doesn't relax word-boundary checking otherwise). Empirically re-tested with 15 cases via a standalone tsx script (8 negative incl. every QA-reported bypass, 7 positive incl. Asian Paints/Cupid/ITDC/Reliance Industries/L&T/M&M) — 15/15 passed. Also fixed a minor cold-launch UX flash: `market-moves-tab.tsx`'s "Regulatory Filings" disclosure now gates rendering on a `filingsRestored` flag so a previously-expanded user doesn't see a collapsed-then-jump-open frame before AsyncStorage resolves.

This is the 3rd hit of the `.includes()`-without-word-boundary bug class in this repo (1st: S74-T2 `hasPlausibleAnalystSignal`). See [[feedback_keyword_prefilter_word_boundaries]] — treat ANY `.includes()`/`indexOf()` gate over free text as suspect by default; use `\b<word>\b` regex (with metachar escaping) instead.

See also [[project_market_pulse_phase1]] for Phase 1 context (NSE/BSE fetchers, marketHours.ts origin, TickerChip).
