---
name: project_google_news_url_decoder_fix
description: Fixed resolveGoogleNewsUrl in lib/news/articleBody.ts — Google News changed link format (CBMi... ids), old redirect-follow/data-n-au parsing no longer resolves them, blocking summaries for all Google-News-sourced stories (India entertainment: 245 India stories/week, 0 summarized).
metadata:
  type: project
---

Fixed 2026-07-14: `resolveGoogleNewsUrl()` in `apps/api/lib/news/articleBody.ts` previously only followed HTTP redirects and parsed `data-n-au`/canonical-link from the interstitial page. Google News's current link format (`https://news.google.com/rss/articles/CBMi...?oc=5`) is NOT a redirect — it's an opaque base64 article id that Google's own frontend resolves via an internal RPC.

**Fix** (3-stage fallback, each degrading to the next):
1. Legacy path unchanged: follow redirects, check `data-n-au` / canonical `<link>` on the interstitial page (still fetched once).
2. New path (primary for current-format ids): extract the base64 id from the URL path, scrape `data-n-a-sg` (signature) + `data-n-a-ts` (timestamp) attributes from that SAME already-fetched interstitial HTML (no extra fetch), then POST to `https://news.google.com/_/DotsSplashUi/data/batchexecute` with an `f.req=[[["Fbv4je","[\"garturlreq\",[...],id,ts,sig]"]]]` payload. Response is `)]}'\n\n<json>`; parse `rows[0][2]` as JSON, take `[1]` for the decoded URL. Total network cost: 1 GET + 1 POST per Google News URL (same as the reference Python decoder it's modeled on, SSujitX/google-news-url-decoder).
3. Last-resort fallback: base64-decode the id directly and regex-scan the decoded bytes for an embedded `https?://` URL (works for some older `AU_yqL...`-style ids that embed the destination in-band; does NOT work for current `CBMi...` ids, which is why it's last).

**Verification**: sandbox environment turned out to have live internet access to `news.google.com` (contrary to assumption) — tested 8 real live Google News URLs pulled fresh from `news.google.com/rss/search?q=...&hl=en-IN&gl=IN&ceid=IN:en`. All 8 resolved to real publisher URLs successfully (zero "Could not resolve Google News redirect URL" errors). 5/8 fetched full article bodies; 3/8 hit downstream 402/403 from the *publisher* (ew.com, exchange4media.com, ndtv.com) — expected and out of scope (NDTV blocking scrapers is a known separate issue, see ndtv 403 note below).

**Non-goal confirmed**: NDTV direct URLs return 403 (scraper block) — separate hard source problem, not URL-resolution related.

**Verification script**: `apps/api/scripts/_gn_test.ts` — standalone, not wired into any route/cron/build. Run with `npx tsx scripts/_gn_test.ts` (uses 3 built-in India-entertainment CBMi URLs) or pass URLs as argv. Left in the repo uncommitted for the coordinator to re-run from EC2 before/after deploy; safe to delete once confirmed there too.

**Status as of fix**: tsc clean, NOT committed, NOT deployed (per explicit instruction). Only `lib/news/articleBody.ts` changed — same function signature/error contract preserved (`fetchArticleBody` callers unaffected).

See also [[project_market_pulse_phase1c_news]] for the broader Google News ingestion pipeline this feeds into.
