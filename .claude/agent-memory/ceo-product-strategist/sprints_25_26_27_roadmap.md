---
name: Sprint 25-26-27 Roadmap — Credibility, Social Layer, Engagement
description: Formal ticket specs approved and written for Sprints 25, 26, 27 (2026-05-09). 14 tickets across three sprint themes.
type: project
---

## Sprint 25 — Credibility & Trust (7 tickets, all pending)

Theme: Make the platform feel credible to new users. All quick wins.

| Ticket | Priority | Key Schema Changes |
|---|---|---|
| S25-T1 Platform Brier Score | high | None — computed from existing UserStat |
| S25-T2 Verified Analyst Badge | high | isVerifiedAnalyst Boolean @default(false) on User |
| S25-T3 SEO-Indexed Public Profiles | high | None — new web page in apps/api/app/profile/[username] |
| S25-T4 "You beat X% of predictors" | high | percentileRank Int? on WalletTransaction |
| S25-T5 Follower Count on Leaderboard | medium | None — Follow _count join on existing leaderboard query |
| S25-T6 Phone Verification Bonus | medium | phoneVerified Boolean + phone String? @unique on User |
| S25-T7 Category Filter Tabs | medium | None — client-side filter on existing category field |

**Why:** These 7 tickets convert the raw technical product built in Sprints 1-24 into a credible, trust-signalling platform. The Platform Brier Score (S25-T1) and Verified Analyst Badge (S25-T2) are the two highest-leverage credibility signals before App Store launch. SEO profiles (S25-T3) are the press/organic SEO play. The percentile mechanic (S25-T4) turns every resolution into a shareable moment.

**How to apply:** S25-T2 (isVerifiedAnalyst) is a prerequisite for S25-T3 (SEO profiles). All other tickets are parallel-safe.

---

## Sprint 26 — Social Layer (5 tickets, all pending)

Theme: Make following, commenting, and sharing effortless.

| Ticket | Priority | Key Schema Changes |
|---|---|---|
| S26-T1 Position-Linked Comments | high | None — joins existing MarketPosition |
| S26-T2 Comment Tips | high | TIP_GIVEN/TIP_RECEIVED WalletTransactionType; tipsReceived on Comment; tipsReceivedTotal on User |
| S26-T3 Follow + Push on Analyst Position | high | FOLLOWED_USER_PREDICTION NotificationType |
| S26-T4 Shareable Portfolio Link | medium | None — new API route + web page |
| S26-T5 Anonymous Calls + Track Record | medium | UserDisplayMode enum; displayMode on User |

**Why:** The social layer is the retention flywheel. S26-T3 (follow+push on analyst position) is the Kalshi Social mechanic that drives D7 reactivation. S26-T1 (position-linked comments) differentiates us from Polymarket's moderation failure — accountability by design. S26-T2 (tips) creates a quality-signalling loop on analyst profiles.

**How to apply:** S26-T3 depends on S24-T2 (Follow system, already complete) and S24-T3 (notifyFollowers helper, already complete). All Sprint 26 tickets are otherwise parallel-safe.

---

## Sprint 27 — Engagement & Retention (2 tickets, both pending)

Theme: Bring users back daily and help them make better decisions.

| Ticket | Priority | Key Schema Changes |
|---|---|---|
| S27-T1 Today's Big Call | high | isBigCallDate DateTime? + bigCallNotificationSentAt DateTime? + bigCallNotificationOpenedCount Int on Market |
| S27-T2 Probability Chart Over Lifetime | high | New MarketProbabilitySnapshot model (marketId, probability, snapshotAt) |

**Why:** S27-T1 (Today's Big Call) is the highest-ROI D1/D7 retention mechanic in the roadmap — one curated daily market at 8am IST creates habit. S27-T2 (probability chart) is the 'Consensus Line' visual that Smarkets and Polymarket both cite as a press hook.

**How to apply:** These two tickets are parallel-safe with each other and with all Sprint 25-26 tickets.

---

## Key Design Decisions Locked in Sprint 25-27 Spec

1. **No external chart library for probability chart**: Use pure View segments or SVG via react-native-svg if already in package.json — same pattern as S24-T1 calibration scorecard. Avoids bundle bloat.
2. **OTP is in-memory only**: No Redis, no SMS provider in Sprint 25. PHONE_VERIFY_MODE=dev logs OTP to console. Wire real SMS (MSG91/Twilio) in a future sprint.
3. **Pseudonym via sha256(userId)[0:6]**: Deterministic, persistent, requires no DB storage. crypto built-in only.
4. **Big Call cron uses CRON_SECRET header**: Same guard pattern applied to both new cron routes (big-call-notification and probability-snapshot). Consistent security posture.
5. **Percentile stored on WalletTransaction**: Avoids a separate table. percentileRank Int? nullable field. Computed at resolution time and stored for fast read on market detail.
6. **Probability snapshots fire on both cron AND every position placement**: Ensures chart updates in real-time on active markets even between hourly cron windows.
7. **All in-transaction side effects wrapped in try/catch**: Systemic rule from S24 strictly applied to all new code in S25-27.
