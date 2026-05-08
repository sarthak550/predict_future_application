---
name: Sprint 24 — Competitive parity with Manifold Markets
description: 11 tickets; T1-T7 done, T8 qa-review (leagues month-end), T9-T11 pending as of 2026-05-06
type: project
---

Sprint 24 contains 11 tickets derived from competitive analysis vs Manifold Markets.

S24-T1 (CRIT) — COMPLETE (qa-review 2026-05-06). Calibration scorecard. Zero schema changes. Key implementation notes:
- /api/users/[userId]/calibration: reads UserStat + UserCategoryStat directly; returns 404 if user not found; Cache-Control: public, max-age=60.
- /api/leaderboard extended: top=true + category + limit query params trigger a fast UserCategoryStat sort path (max 50, default 10); Cache-Control: public, max-age=300. Invalid categories fall through gracefully to the standard all-tab path.
- Mobile calibration/[userId].tsx: plain View bars (no charting lib), overall accuracy hero number, per-category coloured bar chart, category links (>=5 predictions threshold).
- Mobile leaderboard/category/[category].tsx: flat list with rank badges (gold/silver/bronze for top 3), pull-to-refresh.
- Public user profile screen (user/[username].tsx): "View calibration scorecard" tappable row added below stats card, navigates to /calibration/[userId].
- ApiUserCalibration + ApiCategoryTopEntry + ApiCategoryTopResponse types added to packages/types.
- getUserCalibration(userId) + getCategoryTop(params) added to api-client (both unauthenticated).
- TypeScript: zero errors across all packages.

**Ticket sequence and build dependencies:**

S24-T1 (CRIT) — Calibration scorecard. No schema change. Reads UserStat + UserCategoryStat into a new GET /api/users/[userId]/calibration route. New mobile screen apps/mobile/src/app/calibration/[userId].tsx with horizontal category bars. Category top-10 endpoint extends existing /api/leaderboard.

S24-T2 (HIGH) — COMPLETE (qa-review 2026-05-06). Follow schema. Manual SQL migration 20260506120000_add_follow_table applied and marked resolved. New routes: POST/DELETE /api/users/[userId]/follow, GET /api/users/[userId]/followers, GET /api/users/[userId]/following, GET /api/users/[userId] (new public user-by-ID endpoint). User profile includes followerCount, followingCount, isFollowedByMe. Upsert semantics for follow/unfollow idempotency. ApiFollowStatus + ApiFollowerEntry types added. api-client: followUser, unfollowUser, getFollowers, getFollowing methods added. Note: existing public profile remains at GET /api/profile/[username] (username-based); the new [userId] route is ID-based for the follow system's needs.

S24-T3 (HIGH) — Follow notifications. Depends on S24-T2. New NotificationType: FOLLOWED_USER_MARKET. notifyFollowers helper (capped at 500 followers, fire-and-forget). Wired to market approval path. Expo push via sendFollowerPushNotifications. Mobile follow/unfollow button on profile screen.

S24-T4 (HIGH) — COMPLETE (qa-review 2026-05-06). Daily quests engine. Schema: DailyQuest model (unique: userId+date+questType; date stored as IST 'YYYY-MM-DD' string); WalletTransactionType enum extended with DAILY_BONUS + QUEST_REWARD; NotificationType extended with QUEST_COMPLETED. Applied via `prisma db push` (shadow DB had P3006 drift — all prior migrations marked as resolved). Quest definitions: PREDICT_3 (+50 pts, goal 3), PREDICT_5 (+100 pts, goal 5), VOTE_ON_POLL (+25 pts, goal 1), CREATE_MARKET (+75 pts, goal 1). Engine in apps/api/lib/quests/engine.ts: getOrCreateTodayQuests (upsert all 4 types), checkAndCompleteQuests (counts real MarketPosition/Vote/Market rows for IST day bounds). Wired inside transaction at: positions/route.ts (PREDICTION), vote/route.ts (POLL_VOTE), lib/markets/create.ts (MARKET_CREATE). Quest reward creates WalletTransaction(QUEST_REWARD) + credits wallet + creates QUEST_COMPLETED Notification, all inside the caller tx. GET /api/quests/today: returns live progress counts + quest rows; opens its own short $transaction for getOrCreateTodayQuests then queries counts in parallel. ApiDailyQuestEntry + ApiDailyQuests types added to packages/types. getQuestsToday() (auth:true) added to api-client. Zero TS errors across all packages.

S24-T5 (HIGH) — Depends on S24-T4. Streak milestone payouts (7/14/30/60 days) via DAILY_BONUS. Duplicate guard via WalletTransaction history. Mobile quests.tsx screen. Profile tab Daily Quests entry row. questRewards field in position API response for toast.

S24-T6 (HIGH) — COMPLETE (qa-review 2026-05-06). Referral rewards. Schema: referralCode String? @unique + referredById String? (self-relation "Referrer") on User; REFERRAL_BONUS_REFEREE + REFERRAL_BONUS_REFERRER added to WalletTransactionType; REFERRAL_REWARD added to NotificationType. Applied via `prisma db push --accept-data-loss` (nullable unique constraint on new column). generateReferralCode() in apps/api/lib/referrals/code.ts: first-4-alphanumeric prefix of username + 4 random chars, collision retry x5, fallback to 8 random chars. backfillReferralCodes() in apps/api/lib/referrals/backfill.ts: idempotent per-user loop; called at end of seed.ts. Both register routes (web + mobile) now: (a) generate a referralCode on create, (b) accept optional referralCode body field and silently resolve referredById if valid — invalid codes ignored. GET /api/users/me/referral-code: lazily generates code if null; returns {referralCode, referralCount, totalEarned}. Referral credit in positions/route.ts: after quest engine try/catch, second try/catch checks totalPositions === 1 + idempotency guard (REFERRAL_BONUS_REFEREE existence on refereeWallet) → +250 pts to both wallets + REFERRAL_REWARD notification to referrer. ApiReferralInfo type in packages/types. getMyReferralCode() (auth:true) in api-client. InviteFriendsCard component on Profile tab: useApiQuery(referralFetcher) on mount, code display box, "Share via WhatsApp" (Share.share with template message), referral stats line.

S24-T7 (MED) — COMPLETE (qa-review 2026-05-06). League schema. New: LeagueTier enum (BRONZE/SILVER/GOLD/PLATINUM/DIAMOND) added to prisma/schema.prisma. MonthlyLeagueEntry model (fields: id, userId, month 'YYYY-MM', tier, startingTier, netPointsMonth, finalRank Int?, promoted Boolean, relegated Boolean, createdAt, updatedAt; unique: userId+month; index: month+tier+netPointsMonth DESC). User.currentLeagueTier LeagueTier? added (nullable for users with no predictions). Applied via `prisma db push`. Seed: seedMonthlyLeagues() places ALL users into BRONZE for current IST month + sets currentLeagueTier=BRONZE (called after refreshUserStats in main). GET /api/leagues/current (auth required): auto-creates entry if missing via upsert at User.currentLeagueTier tier (fallback BRONZE); returns {month, tier, netPointsMonth, rank} where rank = higherCount+1. AppLeagueTier string-union + ApiLeagueEntry type added to packages/types. getMyCurrentLeague() (auth:true) added to api-client. Zero TS errors across all packages. Note: finalRank field used (not `rank`) in MonthlyLeagueEntry — T8 updateMany must use `finalRank` when assigning ranks at month-end.

S24-T8 (MED) — COMPLETE (qa-review 2026-05-06). Month-end processing. Key files:
- apps/api/lib/leagues/processing.ts: updateLeagueMonthPoints(userId, deltaPoints, tx) — upserts MonthlyLeagueEntry for current IST month. Fallback tier = User.currentLeagueTier ?? BRONZE. MUST be wrapped in try/catch by callers (S24-T4/T5 rule).
- apps/api/lib/leagues/monthEnd.ts: processLeagueMonthEnd(month) + getLeagueStandings(params). processLeagueMonthEnd: iterates TIER_ORDER, sorts entries, assigns finalRank, marks promoted/relegated (top 20%/bottom 20%, min 5 users to apply movement), upserts nextMonth entries, updates User.currentLeagueTier, bulk createMany notifications (LEVEL_UP for promoted, SYSTEM for relegated). Idempotency: checks for existing promoted/relegated=true rows for the month.
- apps/api/app/api/admin/leagues/process-month-end/route.ts: POST, ADMIN-only, body {month?} defaults to previous IST month.
- apps/api/app/api/leagues/standings/route.ts: GET ?tier=&month=&cursor=, no auth, 20-per-page cursor pagination.
- LEVEL_UP was already in NotificationType enum — no schema push needed.
- updateLeagueMonthPoints wired in payouts.ts (after MARKET_WIN credit, netGain = payout - stake) and in quests/engine.ts (after QUEST_REWARD and DAILY_BONUS streak milestone credits).
- ApiLeagueTierStandingEntry + ApiLeagueStandingsPage added to packages/types. getLeagueStandings() + processLeagueMonthEnd() added to api-client.

S24-T9 (MED) — Depends on S24-T7 and S24-T8. Mobile leagues.tsx screen with tier badge (color-coded), zone bar, tier standings list, promotion/relegation one-time banners (AsyncStorage seen-state). Profile tab Leagues entry row.

S24-T10 (MED) — Multi-choice markets. Largest schema change: MULTIPLE_CHOICE in MarketType enum, new MarketOption model, new MultiChoicePosition model, Market.sumToHundred field. resolveMultiChoiceMarket proportional payout function. Mobile create wizard Options step. Market detail options-list betting panel. Must run after all schema drift is resolved (S23-T1 must be done).

**Why:** Calibration scorecard (T1) ships first because it requires zero schema changes and directly delivers the brand promise. Follow and quests/referrals are sequenced next because they drive retention and viral growth. Leagues require the quest reward wiring from T4/T5 to populate netPointsMonth accurately. Multi-choice is last because of migration risk.

**How to apply:** When implementing T4, ensure the checkAndCompleteQuests call is inside the Prisma transaction that creates the MarketPosition/Vote/Market row. When implementing T8 updateLeagueMonthPoints, use upsert — a user's MonthlyLeagueEntry for the current month may not exist yet (created on first point accumulation, not on registration). The expo-server-sdk is already installed in apps/api — confirmed via resolution.ts usage.
