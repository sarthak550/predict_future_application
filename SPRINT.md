# Sprint Board

> Human-readable view of `.claude/sprint-board.json`. Auto-maintained by the CEO/CTO/QA agents — do not edit by hand.

**Current sprint:** 24
**Status:** Sprint 24 COMPLETE — all 11 tickets passed QA (2026-05-06).

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

| ID | Pri | Status | Title |
|---|---|---|---|
| S12-T1 | CRIT | failed | Leaderboard: dynamic subtitle + sort-order consistency fix |
| S12-T2 | HIGH | failed | Leaderboard: time-window selector (This Week / This Month / All Time) |
| S12-T3 | HIGH | failed | Leaderboard: sticky 'Your Rank' card pinned below selectors |
| S12-T4 | MED | failed | Leaderboard: row chevron, delta badge, and category-aware empty state |

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
| S20-T1 | 🟡 | ✅ | Agreement-axis Poll A — replace magnitude with stance on analyst's view |

---

## Sprint 21

**Theme:** Article body scraping + real AI extraction (replaces fake seed opinions)
**Status:** COMPLETE — all tickets passed QA.

| ID | Pri | Status | Title |
|---|---|---|---|
| S21-T1 | 🟡 | ✅ | Article body scraping pipeline — real AI extraction + seed cleanup |

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
| S23-T1 | 🟡 | ✅ | DRAFT market visibility — hide unapproved from public, surface to creator only |

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
| S24-T9 | MED | ✅ done | Monthly leagues: mobile UI — tier badge, standings screen, promotion/relegation banners | Tier badge in Profile stats strip; leagues.tsx with zone bar and tier standings list; one-time promotion/relegation banners; Leagues entry row in Profile tab |
| S24-T10 | MED | ✅ done | Multi-choice markets: schema, creation API, stake flow, mobile UI | MULTIPLE_CHOICE MarketType; MarketOption + MultiChoicePosition models; creation validation (2-10 options); stake route; proportional payout on resolution; mobile create wizard Options step + options-list betting panel |
| S24-T11 | MED | ✅ done | Seed markets from Manifold API for credibility bootstrapping | originPlatform + externalId fields on Market; one-shot import script pages Manifold API, filters to BINARY resolved markets in mapped categories, creates read-only archived markets with attribution badge on mobile MarketCard |
