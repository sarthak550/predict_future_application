# Sprint Board

> Human-readable view of `.claude/sprint-board.json`. Auto-maintained by the CEO/CTO/QA agents — do not edit by hand.

**Current sprint:** 53
**Status:** Sprint 53 QA COMPLETE (6/6) — Create-tab fix bundle: draft persistence + schema version, strict resolveAt validation, dead StepResolution/ResolutionMode dropped, eligibility gate inlined on PUBLIC option (top HostEligibilityCard removed), duplicate MC options blocked, inline char-count hints. ~215 dead lines removed. Pending user device smoke-test. Sprint 52 QA COMPLETE (4/4) — CombinedAnalystCard merge + See-all removal + tighter inter-card gap + Pulse pills redesign with question/crowd-%/urgency-tint. Sprint 51 COMPLETE (5/5). Sprint 50 COMPLETE (6/6 — Top 3 Analysts moved from Feed to Finance). Sprint 49 COMPLETE (9/9). Legal review on SEBI Research Analyst public naming still required before production deploy. Sprint 48 COMPLETE (F1 timing reliability — retry, cache downgrade, empty-state, client timeout). Sprint 47 COMPLETE (F1 detail modal — full driver grid with lap times, gaps, tire data). Sprint 46 COMPLETE (Sports poll trust fix — all 3 tickets passed QA). Sprint 45 COMPLETE (F1 race card). Sprint 44 COMPLETE (Finance instrument filter overhaul). Sprint 43 COMPLETE. Sprints 38–42 COMPLETE (security/correctness hardening, 54 tickets). Sprints 12, 25–34 COMPLETE.

---

## Legend

| Symbol | Meaning |
|---|---|
| pending | waiting for CTO |
| in-progress | CTO implementing |
| qa-review | waiting for QA verdict |
| done | QA passed |
| failed | QA blocked, CTO must fix |

| Priority | Label |
|---|---|
| critical | CRIT |
| high | HIGH |
| medium | MED |
| low | LOW |

---

## Sprint 7

| ID | Pri | Status | Title |
|---|---|---|---|
| S7-T1 | CRIT | done | Feed: Inline poll voting directly on news cards |
| S7-T2 | CRIT | done | Market detail: sticky betting panel (bottom sheet or fixed footer) |
| S7-T3 | CRIT | done | Onboarding: first-run tooltip walkthrough for new users |
| S7-T4 | HIGH | done | Streak and daily engagement mechanic |
| S7-T5 | HIGH | done | Sports tab: tap a match to see linked markets and create a prediction |
| S7-T6 | HIGH | done | Profile: P&L summary card — net points won/lost across resolved markets |
| S7-T7 | HIGH | done | Share a market: native share sheet with deep link URL |
| S7-T8 | HIGH | done | Markets tab: sort controls and trending markets surface |

---

## Sprint 8

| ID | Pri | Status | Title |
|---|---|---|---|
| S8-T1 | CRIT | done | Groups tab: replace placeholder with functional group browse and join flow |
| S8-T2 | CRIT | done | Resolution payoff: win/loss modal with points delta when a market resolves |
| S8-T3 | CRIT | done | Notifications: make each notification tappable and route to the relevant screen |
| S8-T4 | HIGH | done | Leaderboard tab: restore as a full-screen dedicated tab visible in the nav |
| S8-T5 | HIGH | done | Public user profiles: tap a username anywhere to view their stats |
| S8-T6 | HIGH | done | Create market: post-submission success screen and draft recovery UX |
| S8-T7 | MED | done | Feed: skeleton loading cards on initial load instead of a blank spinner |
| S8-T8 | MED | done | Market detail: resolution rationale and resolver identity in the resolved view |

---

## Sprint 9

| ID | Pri | Status | Title |
|---|---|---|---|
| S9-T1 | CRIT | done | Fix feed userVote persistence: add auth:true to getNews API client call |
| S9-T2 | CRIT | done | Fix Profile Bets tab: wire real positions or remove the dead tab |
| S9-T3 | HIGH | done | Deep-link group join: /join/[inviteCode] mobile route + web stub + app config |
| S9-T4 | HIGH | done | Profile screen: surface Leaderboard and Groups links above the empty-state walls |
| S9-T5 | HIGH | done | Create wizard: Simple vs Advanced split to collapse power-user steps |
| S9-T6 | MED | done | QA process: add mandatory smoke-test checklist to every QA report |
| S9-T7 | CRIT | done | Hotfix: mobile register wallet gap — verify fix, backfill integrity, audit all create-user paths, regression test |

---

## Sprint 10

| ID | Pri | Status | Title |
|---|---|---|---|
| S10-T1 | HIGH | done | Profile empty-state cleanup: suppress hollow cards, add GetStartedCard, reorder activity above P&L, drop Streak tile |

---

## Sprint 11

| ID | Pri | Status | Title |
|---|---|---|---|
| S11-T1 | HIGH | done | Sticky identity strip + Performance Strip line |
| S11-T2 | HIGH | done | Sub-tabs inside Profile (Activity \| Stats \| Markets) — revised again: pill toggle for Activity |
| S11-T3 | HIGH | done | Consolidated Performance card on Stats sub-tab |

---

## Sprint 12

**Status:** COMPLETE — All 4 tickets passed QA (2026-05-16).

| ID | Pri | Status | Title |
|---|---|---|---|
| S12-T1 | CRIT | ✅ done | Leaderboard: dynamic subtitle + sort-order consistency fix |
| S12-T2 | HIGH | ✅ done | Leaderboard: time-window selector (This Week / This Month / All Time) |
| S12-T3 | HIGH | ✅ done | Leaderboard: sticky 'Your Rank' card pinned below selectors |
| S12-T4 | MED | ✅ done | Leaderboard: row chevron, delta badge, and category-aware empty state |

---

## Sprint 13

**Theme:** Finance section foundation — India-first expert opinions data model
**Status:** COMPLETE — all 4 tickets passed QA (2026-05-02).

| ID | Pri | Status | Title |
|---|---|---|---|
| S13-T1 | CRIT | done | Finance section foundation: Prisma schema + seed experts |
| S13-T2 | HIGH | done | Finance AI extraction pipeline: Gemini expert opinion extraction |
| S13-T3 | HIGH | done | Finance news source expansion + FINANCE story tagging |
| S13-T4 | MED | done | Finance Expert Take: mobile story card display |

---

## Sprint 14

**Theme:** Dual polls on Expert Opinions — crowd implication + retrospective trust scoring
**Status:** COMPLETE

| ID | Pri | Status | Title |
|---|---|---|---|
| S14-T1 | CRIT | done | Vote schema + API for Expert Opinion dual polls |
| S14-T2 | HIGH | done | Mobile Poll A (Implication) on Expert Take card |
| S14-T3 | HIGH | done | Mobile Poll B (Retrospective) locked state on Expert Take card |

---

## Sprint 15

**Theme:** Dedicated Finance section in Markets tab — event clusters, sentiment gauge, discovery hooks
**Status:** COMPLETE

| ID | Pri | Status | Title |
|---|---|---|---|
| S15-T1 | CRIT | done | Event-cluster data model + admin seed |
| S15-T2 | CRIT | done | API for Finance Markets feed |
| S15-T3 | HIGH | done | Mobile Finance mode in Markets tab |
| S15-T4 | MED | done | Discovery hooks + Feed FINANCE chip |

---

## Sprint 16

**Theme:** Resolution flow + expert credibility leaderboard — closes the dual-poll trust loop
**Status:** COMPLETE

| ID | Pri | Status | Title |
|---|---|---|---|
| S16-T1 | CRIT | done | Admin resolution flow for Expert Opinions |
| S16-T2 | CRIT | done | Credibility score + expert lookup API |
| S16-T3 | HIGH | done | Expert profile screen (mobile) |
| S16-T4 | HIGH | done | Expert leaderboard + retrospective Poll B full unlock verification |

---

## Sprint 17

**Theme:** Critical fixes + Finance section polish — dead routes, human-in-the-loop oversight, UI credibility
**Status:** COMPLETE — All 6 tickets passed QA on 2026-05-03

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S17-T1 | CRIT | done | Fix broken /story/[id] route + standardize notification deep-links | Build the missing story screen and eliminate all `/stories/` vs `/story/` inconsistencies so ExpertOpinionCard taps and retrospective notifications resolve correctly |
| S17-T2 | CRIT | done | Admin expert-opinion review queue (web UI) | Next.js web admin page at /admin/expert-opinions with HIT/MISS/Suppress actions for pending opinions and Verify/avatar flow for unverified experts, plus the suppress and verify API routes |
| S17-T3 | HIGH | done | Expert avatars: colorful initials fallback + verified badge consistency | Replace flat-grey initials circles with deterministic color-hashed initials across all Expert surfaces and ensure the verified checkmark badge appears everywhere expert name is shown |
| S17-T4 | HIGH | done | Feed -> Finance discovery chip on FINANCE story cards | Render a small tappable chip on FINANCE feed cards with expert opinions that navigates to the Finance tab, restoring the discovery path removed when the full Expert Take section was stripped from the Feed |
| S17-T5 | MED | done | ExpertOpinionCard visual polish + Finance tab empty states | Strengthen card visual hierarchy (prominent byline, larger direction badge, left-edge quote accent bar), add a rich empty-state card for the Finance tab when zero opinions, and show a sentiment delta vs yesterday |
| S17-T6 | MED | done | AI extraction daily cost guardrail | Add an in-memory daily call cap (default 50, configurable via FINANCE_AI_DAILY_CAP env var) to extractExpertOpinions.ts to prevent runaway Gemini spend if Groq degrades |

---

## Sprint 18

**Theme:** Finance tab restructure — pure expert-opinion product
**Status:** COMPLETE — All 4 tickets passed QA on 2026-05-03.

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S18-T1 | HIGH | done | Today's Analyst Sentiment card replaces Sentiment-of-the-day | New GET /api/finance/expert-sentiment route aggregating PENDING opinions from last 7 days; new AnalystSentimentCard in finance-mode.tsx with gauge bar + dominant-lean chip replacing the market-vote-driven SentimentCard |
| S18-T2 | HIGH | done | Event clusters become informational data panels | Add dataPoints Json field to MarketEventCluster, seed all 3 clusters with real data points, remove MarketChip scroll from cluster render, replace with compact data rows + tappable expert-takes footer link |
| S18-T3 | HIGH | done | Drop Other Finance Markets section from Finance tab | Remove unclusteredPage state, MarketSummaryCard loop, and Load more button from finance-mode.tsx; verify FINANCE category chip exists in Markets tab public filter |
| S18-T4 | MED | done | Tag expert opinions to event clusters + scroll-to-section navigation | Add eventClusterId FK to ExpertOpinion, backfill seed tags for RBI/Earnings clusters, update expertTakeCount via FK count, implement scroll-to + cluster filter UX with clear-filter banner |

---

## Sprint 19

**Theme:** Poll A magnitude slider — 5-bucket ordinal scale replaces 3-button row on Expert Opinion cards
**Status:** COMPLETE — S19-T1 passed QA on 2026-05-03.

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S19-T1 | HIGH | done | Magnitude slider Poll A on Expert Opinion cards | Replace BULLISH/NEUTRAL/BEARISH 3-button Poll A with a snapped 5-position slider (STRONG_DROP / MILD_DROP / FLAT / MILD_GAIN / STRONG_GAIN); schema backfill + tallies API shape change + post-vote histogram overlay with median flag |

---

## Sprint 20

**Theme:** Poll A semantic shift — agreement spectrum on analyst's view replaces magnitude prediction
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S20-T1 | HIGH | ✅ | Agreement-axis Poll A — replace magnitude with stance on analyst's view |

---

## Sprint 21

**Theme:** Article body scraping + real AI extraction (replaces fake seed opinions)
**Status:** COMPLETE — all tickets passed QA.

| ID | Pri | Status | Title |
|---|---|---|---|
| S21-T1 | HIGH | ✅ | Article body scraping pipeline — real AI extraction + seed cleanup |

---

## Sprint 22

**Theme:** Finance extraction quality — analyst-call-only via curated source paths + stricter prompt + confidence floor
**Status:** COMPLETE — S22-T1 passed QA on 2026-05-06.

| ID | Pri | Status | Title |
|---|---|---|---|
| S22-T1 | HIGH | ✅ | Extraction quality — curated source paths + stricter analyst-call prompt + confidence floor |

---

## Sprint 23

**Theme:** DRAFT market moderation hole — hide unapproved markets from public, keep visibility for creator
**Status:** COMPLETE

| ID | Pri | Status | Title |
|---|---|---|---|
| S23-T1 | HIGH | ✅ | DRAFT market visibility — hide unapproved from public, surface to creator only |

---

## Sprint 24

**Theme:** Competitive parity with Manifold Markets — calibration transparency, social graph, quests, referrals, leagues, multi-choice markets
**Status:** COMPLETE — all 11 tickets passed QA (2026-05-06)

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S24-T1 | CRIT | ✅ done | Calibration scorecard: per-user accuracy graph + category top-10 leaderboard | New /api/users/[userId]/calibration route surfaces UserStat + UserCategoryStat as a visual bar chart on a new mobile screen; top-10-per-category endpoint + tappable links; zero schema changes |
| S24-T2 | HIGH | ✅ done | Follow system: schema + follow/unfollow API | New Follow model (followerId, followeeId), follow/unfollow POST/DELETE routes, followers/following paginated lists, followerCount/followingCount/isFollowedByMe added to user profile endpoint |
| S24-T3 | HIGH | ✅ done | Follow notifications: push + in-app when followed user creates a market + follow button on profile | notifyFollowers helper + FOLLOWED_USER_MARKET notification wired to market approval path + Expo push; follow/unfollow button with optimistic update on mobile profile screen |
| S24-T4 | HIGH | ✅ done | Daily quests + wallet transaction types DAILY_BONUS and QUEST_REWARD | New DailyQuest model + quest engine (PREDICT_3/5, VOTE_ON_POLL, CREATE_MARKET); QUEST_REWARD wallet transactions; checkAndCompleteQuests wired into position/vote/market creation paths; GET /api/quests/today |
| S24-T5 | HIGH | ✅ done | Streak milestone rewards + daily quests mobile UI | checkStreakMilestone function (7/14/30/60 day payouts via DAILY_BONUS); quests.tsx screen with progress bars; Profile tab entry point; quest-complete toast on bet confirmation |
| S24-T6 | HIGH | ✅ done | Referral rewards: per-user code, WhatsApp share template, credit on first prediction | referralCode + referredById on User; generateReferralCode helper; GET /api/users/me/referral-code; 250 pts REFERRAL_BONUS_REFEREE + REFERRAL_BONUS_REFERRER on first prediction; mobile Invite friends card with Share.share |
| S24-T7 | MED | ✅ done | Monthly leagues: schema — LeagueTier enum, MonthlyLeagueEntry model, seed placement | LeagueTier enum (BRONZE/SILVER/GOLD/PLATINUM/DIAMOND), MonthlyLeagueEntry model, User.currentLeagueTier, seed all active users into BRONZE; GET /api/leagues/current |
| S24-T8 | MED | ✅ done | Monthly leagues: month-end promotion/relegation processing + netPointsMonth accumulation | POST /api/admin/leagues/process-month-end; top-20%/bottom-20% tier logic; nextMonth entry creation; LEVEL_UP notifications; updateLeagueMonthPoints helper wired to MARKET_WIN and quest reward paths |
| S24-T9 | MED | ✅ done | Monthly leagues: mobile UI — tier badge, standings screen, promotion/relegation banners | Tier badge in Profile stats strip; leagues.tsx with tier standings list; one-time promotion/relegation banners; Leagues entry row in Profile tab |
| S24-T10 | MED | ✅ done | Multi-choice markets: schema, creation API, stake flow, mobile UI | MULTIPLE_CHOICE MarketType; MarketOption + MultiChoicePosition models; creation validation (2-10 options); stake route; proportional payout on resolution; mobile create wizard Options step + options-list betting panel |
| S24-T11 | MED | ✅ done | Seed markets from Manifold API for credibility bootstrapping | originPlatform + externalId fields on Market; one-shot import script pages Manifold API, filters to BINARY resolved markets in mapped categories, creates read-only archived markets with attribution badge on mobile MarketCard |

---

## Sprint 25

**Theme:** Credibility & Trust — make the platform feel credible to new users
**Status:** COMPLETE — all 7 tickets passed QA (2026-05-09)

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S25-T1 | HIGH | ✅ | Platform Brier Score — aggregate accuracy trust banner | New GET /api/platform/stats (no auth); totalResolvedMarkets + avgAccuracyScore + topCategoryByAccuracy + totalActiveAnalysts; trust banner on Feed tab; platform avg footnote on public profile |
| S25-T2 | HIGH | ✅ | Verified Analyst Badge — admin-toggled credential with public display | isVerifiedAnalyst Boolean on User; POST /api/admin/users/[userId]/verify-analyst toggle; shared VerifiedBadge component on profile, leaderboard, market detail creator, comment rows |
| S25-T3 | HIGH | ✅ | SEO-Indexed Public Profiles — web page with og: meta for link previews | apps/api/app/profile/[username]/page.tsx server component; no login required; accuracy/predictions/streak/followers/recent markets; og: + twitter: meta; notFound() on unknown user |
| S25-T4 | HIGH | ✅ | "You beat X% of predictors" — percentile ranking on market resolution | computePercentileRank helper; percentileRank Int? on WalletTransaction; appended to resolution notification body; userPercentileRank on GET /api/markets/[marketId]; stat line on mobile resolved market detail |
| S25-T5 | MED | ✅ | Follower Count on Leaderboard — social proof in rank rows | Follow _count join on GET /api/leaderboard; followerCount on ApiLeaderboardEntry; '1.2K followers' secondary line on leaderboard rows for all tabs |
| S25-T6 | MED | ✅ | Phone Verification Bonus — +100 pts trust incentive with OTP flow | phoneVerified + phone on User; in-memory OTP store (PHONE_VERIFY_MODE=dev logs OTP); POST verify-phone + confirm routes; +100 DAILY_BONUS on confirm; dismissable prompt card on Profile tab |
| S25-T7 | MED | ✅ | Category Filter Tabs — horizontal pill filter on Markets and Feed tabs | Shared CategoryFilterBar component; ALL/SPORTS/FINANCE/POLITICS/CRICKET/BOLLYWOOD/STARTUPS/GENERAL pills; client-side filter on Markets tab; same on Feed tab with FINANCE pill navigating to Finance tab |

---

## Sprint 26

**Theme:** Social Layer — make following, commenting, and sharing effortless
**Status:** PENDING

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S26-T1 | HIGH | ✅ done | Position-Linked Comments — 'skin in the game' badge on comment rows | Comment list query joins MarketPosition/MultiChoicePosition; position: { side, amount } on ApiComment; 'Holds YES — 50 pts' pill badge on comment rows across all comment surfaces |
| S26-T2 | HIGH | ✅ done | Comment Tips — micro-reward quality analysis with daily cap | TIP_GIVEN + TIP_RECEIVED wallet types; tipsReceived on Comment + tipsReceivedTotal on User; POST /api/comments/[commentId]/tip; 50 pts/day cap; fixed 5 pt gift icon on comment rows; lifetime tips on analyst profile |
| S26-T3 | HIGH | ✅ done | Follow + Push on Analyst Position — notify when followed analyst makes a call | FOLLOWED_USER_PREDICTION notification type; notifyFollowersOnPosition helper with 3-push/day/followee throttle; wired to binary + multi-choice + numeric position creation paths; all fire-and-forget outside transactions |
| S26-T4 | MED | ✅ done | Shareable Portfolio Link — public URL + mobile share button | GET /api/users/[username]/portfolio (no auth); apps/api/app/portfolio/[username]/page.tsx server component with og: meta; 'Share my portfolio' button in Profile tab using Share.share with predictfuture.app/portfolio URL |
| S26-T5 | MED | ✅ done | Anonymous Calls + Track Record — persistent pseudonym with full accuracy accrual | UserDisplayMode enum (USERNAME/ANONYMOUS) on User; getDisplayName() using sha256(userId)[0:6] pseudonym; applied to all public-facing responses; PATCH /api/users/me/display-mode to toggle; 'Show as anonymous' toggle on Profile tab settings |

---

## Sprint 27

**Theme:** Engagement & Retention — bring users back daily and help them make better decisions
**Status:** COMPLETE — all 2 tickets passed QA (2026-05-09)

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S27-T1 | HIGH | ✅ done | Today's Big Call — admin-curated daily market with 8am push to all users | isBigCallDate + bigCallNotificationOpenedCount on Market; POST /api/admin/markets/[marketId]/mark-big-call; GET /api/markets/big-call/today; POST /api/cron/big-call-notification (CRON_SECRET guarded); prominent card at top of Feed tab |
| S27-T2 | HIGH | ✅ done | Probability Chart Over Lifetime — consensus line on market detail | New MarketProbabilitySnapshot model; hourly cron POST /api/cron/probability-snapshot; snapshot on every position placement; GET /api/markets/[marketId]/probability-history with 7-day hourly / older daily aggregation; pure View-based line chart on market detail screen |

---

## Sprint 28

**Theme:** Finance Tab UX — personalization, performance, and the Crowd-vs-Expert differentiator
**Status:** COMPLETE — All 4 tickets passed QA (2026-05-16)

| ID | Pri | Status | Title | One-line summary |
|---|---|---|---|---|
| S28-T1 | CRIT | ✅ | Finance: Analyst Follow System + My Analysts filter | ExpertFollow schema table; follow/unfollow API; Follow pill on opinion cards; My Analysts horizontal chip row in Finance tab filtering the expert feed |
| S28-T2 | CRIT | ✅ | Finance: Infinite scroll pagination on expert opinions feed | Wire existing nextCursor/hasMore API response fields; 10-item pages; loadMore on scroll-to-bottom; footer spinner; pull-to-refresh resets cursor |
| S28-T3 | HIGH | ✅ | Finance: Direction filter chips + tappable Sentiment Card | Bullish/Bearish/Neutral client-side filter chips above opinion toggle; Analyst Sentiment Card becomes Pressable and pre-filters on tap; filter banner with clear |
| S28-T4 | HIGH | ✅ | Finance: Crowd-vs-Expert comparison card scaffolding | GET /api/finance/crowd-vs-experts endpoint; CrowdVsExpertsCard hidden until 10+ resolved opinions; segmented bar showing crowd vs analyst win rates; seed fixtures for QA |

---

## Sprint 29

**Theme:** Make the Scoreboard Real — close first-impression gaps, activate personalization, give analyst identity a progression arc
**Status:** COMPLETE — All 6 tickets passed QA (2026-05-16). S29-T1 reverted per user: tab bar stays Feed/Finance/Create/Markets/Profile; Leaderboard accessed from Profile.

| ID | Pri | Status | Title |
|---|---|---|---|
| S29-T1 | CRIT | ✅ done | Leaderboard tab visibility (reverted — hidden, accessed via Profile) |
| S29-T2 | CRIT | ✅ done | Leaderboard rank delta — compute and persist weekly rank movement |
| S29-T3 | HIGH | ✅ done | Call Reasoning field — optional free-text rationale on market positions |
| S29-T4 | HIGH | ✅ done | For You feed — personalized news feed weighted by analyst follows |
| S29-T5 | HIGH | ✅ done | Analyst Tier system — Rookie / Analyst / Senior Analyst / Chief Analyst |
| S29-T6 | MED | ✅ done | Phone verification live SMS via MSG91 — wire PHONE_VERIFY_MODE=prod |

---

## Sprint 30

**Theme:** Analyst Identity 2.0 — upvote reasoning, show progression, surface daily call, infinite discovery
**Status:** COMPLETE — All 6 tickets passed QA (2026-05-17). Prisma client regenerated + server restarted to unblock S30-T1; runtime verified totalReasoningUpvotes returns 200.

| ID | Pri | Status | Title |
|---|---|---|---|
| S30-T1 | HIGH | ✅ done | Reasoning upvotes + Best Reasoner badge |
| S30-T2 | HIGH | ✅ done | Tier Progress Bar on Profile + Feed nudge |
| S30-T3 | HIGH | ✅ done | Call Reasoning on public profile + SEO pages |
| S30-T4 | HIGH | ✅ done | Notification unread badge + mark-all-read |
| S30-T5 | MED | ✅ done | Markets tab infinite scroll |
| S30-T6 | MED | ✅ done | Admin Big Call performance dashboard |

---

## Sprint 31

**Theme:** Manifold integration quality + Markets discoverability + Saved markets
**Status:** COMPLETE — All 6 tickets passed QA (2026-05-17). T1 variant typo + T5 stale Prisma client both fixed and runtime-verified.

| ID | Pri | Status | Title |
|---|---|---|---|
| S31-T1 | CRIT | ✅ done | Admin bulk-approve Manifold PENDING_REVIEW markets |
| S31-T2 | HIGH | ✅ done | Global Markets search + Related Markets rail on detail |
| S31-T3 | HIGH | ✅ done | Featured/Trending carousel at top of Markets tab |
| S31-T4 | HIGH | ✅ done | Polish Manifold archive cards |
| S31-T5 | MED | ✅ done | Saved/Bookmarked markets |
| S31-T6 | MED | ✅ done | Import Manifold NUMERIC markets |

---

## Sprint 32

**Theme:** Flagship Event Polls — high-impact upcoming finance/policy events with admin-moderated polls
**Status:** COMPLETE — All 6 tickets passed QA (2026-05-18). T3 (Finance missing from category picker) and T4 (expertCount dropped from response) both fixed inline.

| ID | Pri | Status | Title |
|---|---|---|---|
| S32-T1 | CRIT | ✅ done | Schema + API for flagship events |
| S32-T2 | CRIT | ✅ done | Finance tab Upcoming Events carousel |
| S32-T3 | HIGH | ✅ done | User-create flagship poll flow |
| S32-T4 | HIGH | ✅ done | Expert consensus split on flagship cards |
| S32-T5 | MED | ✅ done | Push notifications for flagship events |
| S32-T6 | MED | ✅ done | Admin surface for flagship events |

---

## Sprint 33

**Theme:** Finance Resolution Loop + Live Consensus Bar
**Status:** COMPLETE — all 4 tickets passed QA.

| ID | Pri | Status | Title |
|---|---|---|---|
| S33-T1 | CRIT | ✅ done | Resolution Loop: push notifications + accurate copy on admin expert-opinion resolve |
| S33-T2 | HIGH | ✅ done | Weekly Calls Digest: server-side digest endpoint + Sunday 09:00 IST cron |
| S33-T3 | HIGH | ✅ done | Weekly Calls Digest: in-feed card at position 2 of Finance tab + detail screen |
| S33-T4 | HIGH | ✅ done | Live Consensus Bar on ExpertOpinionCard — pre/post vote aggregate |

---

## Sprint 34

**Theme:** ExpertOpinionPostCard — Finance feed redesign (LinkedIn-style)
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S34-T1 | HIGH | ✅ done | Redesigned ExpertOpinionPostCard for Finance feed |

### S34-T1 detail

**Files touched:**
- `apps/mobile/src/components/expert-opinion-post-card.tsx` — new standalone card (created)
- `apps/mobile/src/lib/feature-flags.ts` — `USE_POST_CARD = true` flag (created)
- `apps/mobile/src/components/expert-opinion-card.tsx` — flag-gated switch: imports new card, renders it when `USE_POST_CARD` is true; legacy `ExpertOpinionRow` path preserved
- `apps/mobile/src/components/news-feed-card.tsx` — `ExpertTakeSection` now also switches on `USE_POST_CARD` (QA fix)
- `apps/mobile/package.json` — `react-native-view-shot ^5.1.0` added

**QA verdict (2026-05-21): PASS — 7/7 checks green.** NEUTRAL label corrected (was rendering as "HOLD"), all render sites flag-gated, TS clean.

**Old components preserved:** `ExpertOpinionRow` and original `ExpertOpinionCard` layout remain untouched. Set `USE_POST_CARD = false` to revert.

**Acceptance criteria for QA:**
1. Card renders without errors in PENDING state (pending opinion, no votes)
2. Card renders without errors in RESOLVED_HIT and RESOLVED_MISS states — "RESOLVED" stamp visible, verdict badge shows "BUY · HIT" / "SELL · MISS" style label, Poll B surfaced, Poll A hidden
3. Card renders without errors in voted state (Poll A submitted) — consensus bar switches to split mode, histogram + read-only slider visible
4. Follow button taps — toggles Follow/Following, calls `onFollowToggle` callback, spinner during pending
5. Poll A vote submission — slider + Submit Vote button; optimistic update on success; reverts with error message on failure
6. Share button — triggers screenshot capture + Share sheet; no crash on dismiss
7. "more" inline expansion — tap body text or "more" label expands to full quote, no new screen
8. Source strip tap — opens original article URL in browser
9. TypeScript: `cd apps/mobile && npx tsc --noEmit` passes clean (verified by CTO)

---

## Sprint 38

**Theme:** CRITICAL security findings from deep audit — production-blocking
**Status:** COMPLETE (13/13 done)

| ID | Pri | Status | Title |
|---|---|---|---|
| S38-T1 | CRIT | ✅ done | Remove `?userId=` auth bypass on POST /api/markets |
| S38-T2 | CRIT | ✅ done | Harden JWT_SECRET — throw at boot if NEXTAUTH_SECRET unset |
| S38-T3 | CRIT | ✅ done | Gate unauthenticated destructive/SSRF admin routes |
| S38-T4 | CRIT | ✅ done | Fix CRON_SECRET fail-open on 10 cron routes |
| S38-T5 | CRIT | ✅ done | Check `isSuspended` in `getUserIdFromRequest` (Bearer JWT bypass) |
| S38-T6 | CRIT | ✅ done | Fix wallet double-spend races + Postgres CHECK constraint |
| S38-T7 | CRIT | ✅ done | Block multi-choice creator self-resolution (exit-scam prevention) |
| S38-T8 | CRIT | ✅ done | Fix Gemini API key leaking via URL — use header auth |
| S38-T9 | CRIT | ✅ done | Block OTP echo in prod + require MSG91_AUTH_KEY at boot |
| S38-T10 | CRIT | ✅ done | Gate big-call-tap + news/debug + BigCallTap idempotency table |
| S38-T11 | CRIT | ✅ done | Cap AI retry loop for stuck PENDING expert opinions |
| S38-T12 | CRIT | ✅ done | WalletTransaction unique idempotency (`@@unique([walletId, marketId, type, positionId])`) |
| S38-T13 | CRIT | ✅ done | Admin expert-opinion resolve idempotent + AdminAction audit log |

---

## Sprint 39

**Theme:** HIGH severity findings — access control, race conditions, AI hardening, cron idempotency
**Status:** COMPLETE (12/12 done)

| ID | Pri | Status | Title |
|---|---|---|---|
| S39-T1 | HIGH | ✅ done | Enforce `canViewMarket` on market sub-resource endpoints |
| S39-T2 | HIGH | ✅ done | Role-hierarchy guard on admin suspend/cluster-edit routes |
| S39-T3 | HIGH | ✅ done | AI prompt injection hardening (`<article_body>` wrap + sentinel checks) |
| S39-T4 | HIGH | ✅ done | Rate limiting on registration + OTP (in-memory; upgraded to Redis in S42-T7) |
| S39-T5 | HIGH | ✅ done | Zero-winner market refund + numeric tie-breaker cap + remainder cents fix |
| S39-T6 | HIGH | ✅ done | Quest engine double-reward race + tip cap race verification |
| S39-T7 | HIGH | ✅ done | financeStreak UTC/IST fix + expert-sentiment `groupBy` perf |
| S39-T8 | HIGH | ✅ done | Cron idempotency (WeeklyDigestRun, flagshipReminderSentAt) |
| S39-T9 | HIGH | ✅ done | auto-resolve-opinions timeout fix + `notifiedAt` resumable sweep |
| S39-T10 | HIGH | ✅ done | Leaderboard-snapshot cap + probability-snapshot O(n²) retention fix |
| S39-T11 | HIGH | ✅ done | Confirmation dialogs on destructive admin web UI actions |
| S39-T12 | HIGH | ✅ done | stats.ts unbounded market query + auth.ts JWT 5-min TTL cache |

---

## Sprint 40

**Theme:** MEDIUM findings — admin auth standardization, JSON schemas, N+1 fixes, race conditions
**Status:** COMPLETE (10/10 done)

| ID | Pri | Status | Title |
|---|---|---|---|
| S40-T1 | MED | ✅ done | Admin route auth standardization (26 routes → `getUserIdFromRequest`) |
| S40-T2 | MED | ✅ done | AdminAction audit trail on mark-flagship, mark-big-call, verify-analyst |
| S40-T3 | MED | ✅ done | Block suspended users on push-token + side-effect mutators |
| S40-T4 | MED | ✅ done | Zod schemas for Json? fields driving critical business logic |
| S40-T5 | MED | ✅ done | ExpertOpinion `quoteHash` unique + MarketPosition portfolio index |
| S40-T6 | MED | ✅ done | N+1 fixes (analyst tier batch + opinion-resolution accuracy batch) |
| S40-T7 | MED | ✅ done | Expert-opinion vote/lock-vote atomicity (transaction + atomic conditional update) |
| S40-T8 | MED | ✅ done | Push batching (10 parallel chunks) + sync-manifold cap + backfill determinism |
| S40-T9 | MED | ✅ done | Mobile client double-tap guard + ApiClientError 401 handling |
| S40-T10 | MED | ✅ done | Reasoning upvote drift fix + groups launch transaction wrap |

---

## Sprint 41

**Theme:** LOW findings cleanup — dead code, schema polish, env safety, AI caps
**Status:** COMPLETE (4/4 done)

| ID | Pri | Status | Title |
|---|---|---|---|
| S41-T1 | LOW | ✅ done | Dead code cleanup + findFirst orderBy audit |
| S41-T2 | LOW | ✅ done | LeaderboardSnapshot.category enum + WalletTransaction FK SetNull |
| S41-T3 | LOW | ✅ done | Mobile env prod safety (throw on missing EXPO_PUBLIC_API_BASE_URL) |
| S41-T4 | LOW | ✅ done | generateHeadline daily cap + Gemini model env-pin with 404 fallback |

---

## Sprint 42

**Theme:** HOTFIX — regressions from S38–S41 re-audit + complete-fix migration to Redis-backed state
**Status:** COMPLETE (15/15 done)

| ID | Pri | Status | Title |
|---|---|---|---|
| S42-T0 | CRIT | ✅ done | Provision Upstash Redis singleton + smoke endpoint |
| S42-T1 | CRIT | ✅ done | Multi-choice payout P2003 fix (`multiChoicePositionId` FK) |
| S42-T2 | CRIT | ✅ done | Stamp `notifiedAt` on admin expert-opinion resolve |
| S42-T3 | CRIT | ✅ done | ExpertOpinion unique index alignment (plain index, no COALESCE) |
| S42-T4 | HIGH | ✅ done | Prompt injection wrap on 3 remaining AI sites |
| S42-T5 | HIGH | ✅ done | Rate limiting on mobile login + NextAuth authorize |
| S42-T6 | HIGH | ✅ done | Manifold sync uses `externalLastSyncedAt` (not `updatedAt`) |
| S42-T7 | HIGH | ✅ done | Redis-backed rate-limit (replaces per-instance Map) |
| S42-T8 | HIGH | ✅ done | Tip cap row-lock + referral bonus atomic claim |
| S42-T9 | HIGH | ✅ done | Reasoning upvote atomic increment/decrement |
| S42-T10 | HIGH | ✅ done | Shared `callGeminiAI` helper + env-pin + 1-hr cooldown |
| S42-T11 | HIGH | ✅ done | Auto-resolve Phase-0 sweep cap + Redis Expo push budget |
| S42-T12 | MED | ✅ done | Web auth TTL + verify-phone double-credit + bond guarded UPDATE |
| S42-T13 | MED | ✅ done | Admin hardening (avatar URL Zod + GRANT/REVOKE enum) |
| S42-T14 | MED | ✅ done | `wasLastCallRateLimited` sentinel + GET removal + BigCallTap FKs + experts pagination |

---

> Pipeline lesson: During S42 several parallel CTO bundles wrote to centralized files (`schema.prisma`, `sprint-board.json`, `SPRINT.md`) concurrently. The harness has no merge layer — last writer wins. Recovery: `prisma db pull` for schema, manual reconstruction for the board (see backup `.claude/sprint-board.json.pre-reconstruction-backup`). Future sprints: serialize edits to any centralized file. Tracked in agent memory at `feedback_serialize_schema_writes.md`.

---

## Sprint 43

**Theme:** Expert Opinions quality — structural instrument commitment + deterministic validator + instrument-null fix + index-contamination resolver
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S43-T1 | CRIT | done | Opinion quality: structured instrument commitment in AI prompt + deterministic validator backstop |
| S43-T2 | HIGH | done | Instrument extraction: fix NULL persistence bug + extend TICKER_MAP with sectoral keywords |
| S43-T3 | CRIT | ✅ done | checkTickerMap: two-pass stock-first resolution to fix index contamination from article headlines |

---

## Sprint 44

**Theme:** Finance instrument filter overhaul — dynamic catalog, normalization, and searchable picker
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S44-T1 | HIGH | ✅ done | Backend: instrument-catalog API + normalization map |
| S44-T2 | HIGH | ✅ done | Backend: extend TICKER_MAP with silver, currencies, global indices, and commodity gaps |
| S44-T3 | HIGH | ✅ done | Mobile UI: searchable instrument picker replacing hardcoded 5-option list |
| S44-T4 | CRIT | done | Hotfix: instrument filter leaks non-matching opinions + canonical-vs-stored label mismatch |

---

## Sprint 45

**Theme:** Sports F1 rendering bug — collapse driver pairs into a single race card with podium UI
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S45-T1 | CRIT | ✅ done | Backend: Collapse F1 multi-card output into one session entry with leaderboard field |
| S45-T2 | CRIT | ✅ done | Mobile UI: F1 race card with podium renderer — detect leaderboard field and show standings |

---

## Sprint 46

**Theme:** Sports poll trust fix — stop generating stale sports polls, cancel existing ones with refunds
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S46-T1 | CRIT | ✅ done | Prevention: exclude SPORTS from auto-poll generation + story freshness gate |
| S46-T2 | CRIT | ✅ done | Cleanup: cancel + refund existing stale sports polls via one-time script |
| S46-T3 | HIGH | ✅ done | Belt-and-suspenders: strengthen AI prompt SPORTS rejection example |

---

## Sprint 48

**Theme:** F1 timing reliability — retry partial OpenF1 laps, downgrade cache on empty response, mobile empty-state + pull-to-refresh, client timeout
**Status:** IN PROGRESS

| ID | Pri | Status | Title |
|---|---|---|---|
| S48-T1 | CRIT | ✅ done | Backend: retry partial OpenF1 laps + downgrade cache on empty timing response |
| S48-T2 | HIGH | ✅ done | Mobile: empty-state banner + pull-to-refresh when all F1 timing is null |
| S48-T3 | MED | ✅ done | Mobile: 8-second AbortController timeout + one auto-retry on F1 session fetch |

---

## Sprint 47

**Theme:** F1 detail modal — full driver grid with lap times, gap-to-leader, tire compounds, and session-type stat gating
**Status:** COMPLETE

| ID | Pri | Status | Title |
|---|---|---|---|
| S47-T1 | CRIT | ✅ done | Backend: F1 session-detail endpoint with lap times, gaps, and tire data |
| S47-T2 | CRIT | failed | Mobile UI: F1 detail modal — full driver grid with lap times, gaps, tire badges |
| S47-T3 | HIGH | failed | Polish: tire compound colour palette + fastest-lap FL badge + session-type stat gating |

---

## Sprint 49

**Theme:** Analyst Scorecard brand visible everywhere — BigCallCard Top 3 footer + sheet + AnalystCredibilityBadge sweep across all analyst-name render sites
**Status:** AMENDMENT — T8+T9 pending after live user smoke-test. T1-T7 done.
**Brief:** `.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_sprint49.md`
**Polish brief:** `.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_sprint49_polish.md`

| ID | Pri | Status | Title |
|---|---|---|---|
| S49-T1 | CRIT | ✅ done | New API endpoint GET /api/experts/top-weekly |
| S49-T2 | CRIT | ✅ done | AnalystCredibilityBadge shared mobile component (followup: tier on second row, not inline — may need variant for T4) |
| S49-T3 | HIGH | ✅ done | Apply AnalystCredibilityBadge to all analyst-name render sites (sweep) |
| S49-T4 | HIGH | ✅ done | BigCallCard footer row — #1 analyst this week |
| S49-T5 | HIGH | ✅ done | Top 3 analysts bottom sheet with leaderboard link (routes to /expert-leaderboard) |
| S49-T6 | MED | ✅ done | Empty states — no qualifying analysts, no Big Call today |
| S49-T7 | MED | ✅ done | Analytics instrumentation — 6 events on analyst surfaces |
| S49-T8 | HIGH | ✅ done | Move BigCallCard + promotional nudges into FlatList ListHeaderComponent (scrollable) |
| S49-T9 | HIGH | ✅ done | TopAnalystsSheet footer link — route to Finance tab, label to "Browse analyst calls" |

---

## Sprint 50

**Theme:** Strategic redirect — remove Feed BigCallCard (semantic mismatch with Top 3 Analysts), anchor Top 3 inline card under Finance tab's Call of the Week
**Status:** IN PROGRESS
**Brief:** `.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_sprint50.md`

| ID | Pri | Status | Title |
|---|---|---|---|
| S50-T1 | CRIT | ✅ done | Feed: remove BigCallCard, TopAnalystsSheet mount, topExpert state, dead analytics |
| S50-T2 | CRIT | ✅ done | New TopAnalystsCard — inline always-visible 3-row card |
| S50-T3 | HIGH | ✅ done | Wire TopAnalystsCard into Finance tab under BigCallHeroCard |
| S50-T4 | MED | ✅ done | Delete TopAnalystsSheet (unused after T1) |
| S50-T5 | MED | ✅ done | Cleanup: remove 'bigcall_footer' analytics source string |
| S50-T6 | MED | ✅ done | Annotate today-big-call route: retained for push cron |

---

## Sprint 51

**Theme:** Finance tab density polish — compact TopAnalystsCard, collapsible Today's Pulse, Your Week as one-line strip. Reduce pre-feed scroll ~560px → ~310px.
**Status:** IN PROGRESS
**Brief:** `.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_sprint51.md`

| ID | Pri | Status | Title |
|---|---|---|---|
| S51-T1 | CRIT | ✅ done | Compact TopAnalystsCard (~200px → ~120px) |
| S51-T2 | HIGH | ✅ done | PulseRibbon (Today's Pulse) collapsible, default closed, AsyncStorage persisted |
| S51-T3 | HIGH | ✅ done | WeekToggleCard (Your Week) — compact strip with tap-to-expand |
| S51-T4 | HIGH | ✅ done | PulseRibbon: card-ify collapsed state + preview line of first 2 pills |
| S51-T5 | MED | ✅ done | WeekToggleCard: add visible ▲ collapse chevron to expanded state header |

**Lesson locked in brief:** Future CEO tickets attaching feature X to surface Y must explicitly state Y's data invariants and why X is coherent under them — this is what failed in S49.

**Open questions for CTO (answer before T1/T3):** Compute accuracy at query time vs. add derived columns + cron? Is `@gorhom/bottom-sheet` installed? Confirm expert profile Expo Router path. Does `/api/finance/opinions` already return accuracy data? Does `mobileApi.track()` exist?

**Legal flag (user action, not CTO):** Public named SEBI Research Analyst firm ranking triggers outside-counsel review from GTM lock. Build OK; ship gate is separate.

---

## Sprint 52

**Theme:** Experimental — merge Call of the Week + Top Analysts into a single CombinedAnalystCard. Easy revert path (BigCallHeroCard + TopAnalystsCard files untouched).
**Status:** COMPLETE (4/4 done)

| ID | Pri | Status | Title |
|---|---|---|---|
| S52-T1 | HIGH | ✅ done | Merge Call of the Week + Top Analysts into single CombinedAnalystCard (experimental) |
| S52-T2 | MED | ✅ done | Remove See all link from CombinedAnalystCard (Top 3 is enough) |
| S52-T3 | LOW | ✅ done | Tighten inter-card vertical gap on Finance tab (12px → 8px uniform) |
| S52-T4 | HIGH | ✅ done | Pulse pills redesign — 2-line vertical with question + crowd % + urgency tint |

---

## Sprint 53

**Theme:** Create tab immediate-fix bundle — bugs and friction surfaced by the post-S52 code audit before opening Pillar B casual-create work.
**Status:** COMPLETE (6/6 done) — ~215 dead lines removed (2,855 → 2,640).

| ID | Pri | Status | Title |
|---|---|---|---|
| S53-T1 | HIGH | ✅ done | Draft persistence: include mcOptions + flagship fields + schema version |
| S53-T2 | HIGH | ✅ done | resolveAt strict validation (no silent submit-time fixup) |
| S53-T3 | MED | ✅ done | Drop dead StepResolution + collapse ResolutionMode union to constant |
| S53-T4 | HIGH | ✅ done | Eligibility gate inline on PUBLIC option card; drop redundant top HostEligibilityCard |
| S53-T5 | MED | ✅ done | Block duplicate MULTIPLE_CHOICE options in client validation |
| S53-T6 | LOW | ✅ done | Inline character-count hints on title (>=12) and description (>=24) |
