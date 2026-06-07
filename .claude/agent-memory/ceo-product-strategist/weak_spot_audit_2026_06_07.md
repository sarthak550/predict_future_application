---
name: Weak Spot Audit — 2026-06-07
description: CEO weak-spot audit conducted 2026-06-07. 9 weak spots across product, business model, competitive, engagement, trust, operations, UX, and strategic focus. Sprint 49 headline tickets recommended.
type: project
---

## Audit Context

Full codebase review: schema (1199 lines), all API routes, mobile tab structure, sprint board (211 tickets, current sprint 48). Cross-referenced against GTM positioning ("India's Analyst Scorecard") locked 2026-05-06.

---

## WEAK SPOT 1: The Product's Whole Reason for Existing Is Not the Tab Bar

**Severity: CRITICAL**

The locked GTM thesis is "India's Analyst Scorecard — rate analyst calls, see who was right." The Finance tab exists and delivers this. But the tab bar is: Feed | Finance | Create | Markets | Profile. Three of five tabs (Feed, Create, Markets) are generic prediction-market infrastructure that exists in every competitor. The Finance tab — the only thing that differentiates this product vs Manifold/Twitter — is buried as tab 2 of 5, labeled with a generic icon, and requires multiple taps to reach analyst opinions. New users who open the app and hit the Feed tab see news cards they could read on Inshorts. There is no "this is an analyst credibility scorecard" moment in the first 30 seconds.

**Business cost if unaddressed:** Every new user's first session teaches them this is a news app with polls. They churn before they ever find the analyst scorecard mechanic. The GTM wedge never activates.

**Directional fix:** Finance tab becomes tab 1. The onboarding slides need to be rewritten around the analyst call-rating mechanic — the current 3-slide onboarding says "Make predictions on today's news. Earn virtual points when you're right" (literal quote from onboarding.tsx), which is exactly what Manifold says. The "India's Analyst Scorecard" positioning should appear on screen 1 of the onboarding, not nowhere.

---

## WEAK SPOT 2: The Analyst Leaderboard — The Core Product Hook — Is Not in the Tab Bar

**Severity: CRITICAL**

The expert-leaderboard screen exists (`/expert-leaderboard.tsx`). The "who called it right" analyst credibility ranking is the central value proposition in the GTM strategy. It is the press hook, the viral mechanic, the retention reason. It is not in the tab bar. It is reachable via a deep link from the Finance tab or expert search — meaning a user must already know it exists. The user/analyst leaderboard (all-time credibility) is similarly buried: it requires navigating to Profile > scroll far > find leaderboard link.

**Business cost if unaddressed:** The #1 reason someone shares this app — "look who was actually right about Nifty" — has no surface-level entry point. The entire viral loop depends on a screen users may never find.

**Directional fix:** Replace the generic "Markets" tab with an "Analysts" tab showing the expert credibility leaderboard as the primary surface. Markets can be accessed within Finance or via a deep search. Analyst leaderboard should be reachable in one tap from the home state.

---

## WEAK SPOT 3: Zero Shareable Moment After a Call Is Proven Right

**Severity: HIGH**

The schema has `percentileRank` on `WalletTransaction` (added Sprint 25), `tipsReceivedTotal` on User, `ReasoningUpvote` model — all the right data is there. But when an expert opinion resolves `RESOLVED_HIT` or a user position wins, there is no native share card generated. The SPRINT.md mentions P&L card sharing as a "growth lever" in the GTM strategy. After 48 sprints there is still no shareable win card. No image, no stat, nothing the user can copy into a WhatsApp group that says "I called this at 70%, here's my track record."

**Business cost if unaddressed:** The primary organic growth loop — a winning prediction as a social proof share — never fires. CAC stays high. The product spreads by word of mouth but without a tangible artifact to pass around.

**Directional fix:** Sprint 49 ticket: when a market resolves and the user wins, generate a static-render share card (title, their call, accuracy percentage vs crowd, analyst tier badge). Native share sheet. This is a 1-3 day CTO task with massive viral leverage.

---

## WEAK SPOT 4: The Expert Opinion Pipeline Is a Single Point of Failure

**Severity: HIGH**

The platform's content quality depends entirely on an AI preprocessing pipeline: `auto-resolve-opinions` cron, `retry-stuck-opinions` cron, `finance-opinions-catchup` cron, `recalculate-analyst-tiers` cron. Sprint 43 added quality hardening. Sprint 46 had to clean up stale sports polls. The schema has `preprocessAttempts`, `resolutionAttempts`, `lastPreprocessAttemptAt` — these are all indicators of a pipeline that frequently gets stuck or produces bad outputs. There is no admin dashboard showing: "here are the 47 opinions that have been stuck in PENDING for 30+ days." There is no alert. There is no SLA.

**Business cost if unaddressed:** Expert opinions that never resolve leave open calls on the platform indefinitely. Users who see an analyst call from 3 months ago still marked "PENDING" conclude the platform is abandoned. Credibility collapse.

**Directional fix:** Build a simple admin opinion health dashboard: count of PENDING > 14 days, count of preprocessAttempts > 3 with no resolution, last successful auto-resolve run. One page, no charts, just counts with "retry all stuck" button.

---

## WEAK SPOT 5: iOS Does Not Exist

**Severity: HIGH**

App version is 0.1.0, Android-only, no iOS bundle in EAS. The GTM target user is "Indian finance-engaged urban consumer, 22-38, smartphone-native, Zerodha/Groww user." iPhone penetration among urban Indians in this demographic is approximately 35-45% (rising steeply in the 25-35 cohort that has investment income). The Finance Twitter / WhatsApp influencer audience the GTM plan relies on for first 1,000 users skews heavily toward iPhone. Building the analyst credibility platform for the most credibility-conscious Indian finance audience while blocking out iPhone users is a structural acquisition gap.

**Business cost if unaddressed:** The GTM seeding plan fails on its own terms. Finance Twitter influencers cannot share the app because their audience cannot install it.

**Directional fix:** iOS build is not a product feature — it is table stakes for GTM. The Expo stack already has `bundleIdentifier: com.predictfuture.mobile` configured. This is an operational sprint (EAS Submit, Apple Developer account, TestFlight), not a feature sprint. Should run parallel to Sprint 49.

---

## WEAK SPOT 6: Groups Have No Discovery or Virality Mechanism

**Severity: HIGH**

Groups exist in the schema and mobile app. The Groups tab is hidden from the tab bar (`href: null`). The only way to join a group is an invite code. The only way to find the invite code entry point is to scroll deeply into the Profile screen. There is no public group directory. There is no "popular groups this week" surface. There is no mechanism to share a group that does not require the other person to already have the app and know where to navigate.

**Business cost if unaddressed:** Groups are the highest-retention mechanic in prediction-market products (Manifold's private groups, Polymarket's rooms). Peer accountability and competition inside a group turns casual users into daily actives. This mechanic exists but is effectively off.

**Directional fix:** Restore Groups as a visible tab. Add a public group directory with member counts. Make invite link sharing a one-tap action from the group screen. This was partly addressed in Sprint 8 but the tab was subsequently hidden.

---

## WEAK SPOT 7: The Web App Is a Ghost Town

**Severity: MEDIUM**

`apps/web` has a landing page, auth pages, dashboard, feed, markets, groups, leaderboard, admin, and profile — a full web product. The web app still uses its own duplicate API routes (separate from `apps/api`), its own `getSession` auth, and its own data access patterns. The README explicitly calls this a "migration in progress." The landing page says "Predict Future" with generic copy ("Make predictions on today's news") — the "India's Analyst Scorecard" repositioning from 2026-05-06 has not propagated to the web landing page (confirmed by reading apps/web/app/page.tsx: still shows the pre-repositioning product description). The SEO public profile pages built in Sprint 25 were the main web-first growth surface. Those exist. But the entire web product is underinvested while mobile gets 48 sprints of attention.

**Business cost if unaddressed:** The press/SEO play depends on SEO-indexed public analyst profiles on the web. If the web landing page tells a different story than the mobile app, journalists who see the web version do not understand the product. The organic search funnel for "who predicted Nifty correctly" never fires.

**Directional fix:** Update the web landing page copy to match the locked "India's Analyst Scorecard" positioning. This is a 2-hour copywriting task, not a sprint — but it is currently blocking the press play.

---

## WEAK SPOT 8: Notification Reasons Are Thin — No Push Loop for Non-Predictors

**Severity: MEDIUM**

The `NotificationType` enum has 14 notification types. The cron system sends: big-call push, flagship reminder, weekly digest. That is the entire outbound re-engagement stack. There is no notification when an analyst you follow makes a new call. There is no "X people also predicted YES on this call you made" social proof push. There is no "the market you predicted on closes in 2 hours" urgency push. The tab bar polls for unread count every 30 seconds (confirmed in `_layout.tsx`) — this is a battery drain with no user benefit given the thin notification reasons.

**Business cost if unaddressed:** D7 retention depends on a reason to return. The current reasons are: streak reminder (if streak active), weekly digest (low engagement for push), and big-call push (once daily). A user who has not participated in 3 days has zero reasons to open the app. This is the primary D7 churn driver.

**Directional fix:** Add two high-signal push types: (1) "An analyst you follow just made a call on [instrument]" — requires wiring `ExpertFollow` to `ExpertOpinion` creation event; (2) "Your call on [market] resolves in 1 hour" — closing-window alert. Both are 1-2 day backend + push tasks.

---

## WEAK SPOT 9: The F1 Sprint Cadence — Strategic Focus Risk

**Severity: MEDIUM**

Sprints 44-48 have delivered: F1 race card (S45), F1 detail modal with lap times and tire badges (S47), F1 timing retry + pull-to-refresh + 8s timeout (S48). Seven tickets across 4 sprints. F1 is not the GTM wedge. F1 is not the target user's primary interest (the target user is the Zerodha/Groww user on Finance Twitter, not the Formula One subreddit). Sports polls were explicitly excluded from auto-generation (Sprint 46) because they were generating stale, unreliable content. Yet the engineering team has shipped more F1 UI polish in the last month than social/sharing/iOS work combined. This is classic founder-team divergence: building what is technically interesting rather than what drives the thesis.

**Business cost if unaddressed:** The team's next 4-6 sprints could close the iOS gap, add the shareable win card, restore the analyst leaderboard to the nav, and build closing-window push notifications. Instead, if the pattern continues, Sprint 49 ships F1 qualifying history charts or cricket scorecard enhancements. The product drifts further from its own stated strategy.

**Directional fix:** Declare a moratorium on Sports vertical investment for 60 days. Sprint 49-51 should have zero F1/cricket tickets unless they are directly tied to the analyst credibility scorecard (e.g., an F1 analyst made a call about Verstappen's championship, let's surface that). Reallocate the engineering attention to items 1-5 above.

---

## Sprint 49 Recommendations — Top 3 Headlines

**Why these three:** They are the highest-leverage moves that unblock the GTM strategy in a single sprint. All three produce user-visible outcomes within 5 days of shipping.

### TICKET 49-T1 (CRITICAL): Reposition the Tab Bar + Onboarding to Lead with the Analyst Scorecard

Swap tab order: Finance (tab 1, renamed "Analysts") | Feed (tab 2) | Create (tab 3) | Profile (tab 4). Add an "Analysts" tab that surfaces the expert credibility leaderboard as its primary view with the Finance opinion feed below. Rewrite the 3-slide onboarding to: slide 1 = "India's Analyst Scorecard — see who called it right"; slide 2 = "Rate analyst calls — agree or disagree?"; slide 3 = "Make your own call and build your track record." This is the single highest-leverage orientation change. Every new user's first minute now teaches them the actual product.

### TICKET 49-T2 (CRITICAL): Shareable Win Card on Market/Opinion Resolution

When a market resolves and the user was right (or an opinion the user voted on resolves RESOLVED_HIT), generate a share card: analyst tier badge, prediction text, "called it at X% — beat Y% of the crowd." Native share sheet with a static image. This activates the viral loop the GTM plan has been waiting for. The data is already in the schema (percentileRank, analystTier, accuracy). This is a rendering task, not a data task.

### TICKET 49-T3 (HIGH): Expert Follow Push — "Your Followed Analyst Just Made a Call"

Wire ExpertFollow to ExpertOpinion creation: when a new opinion is ingested for an expert a user follows, send a push notification. This creates the social re-engagement loop for Finance Twitter users who follow specific analysts (HDFC Securities, ICICI Direct, etc.). It turns the expert follow graph into a notification trigger — the most defensible daily active use reason on the platform.

---

## What Sprint 49 Outcomes Look Like

- New user opens app, sees "India's Analyst Scorecard" on screen 1, taps into Finance/Analysts tab immediately
- User whose prediction resolves correctly gets a shareable card and posts it to their WhatsApp group
- User who followed Rahul Shah (HDFC Securities) gets a push when he makes a new call, returns to the app

These three outcomes — clear positioning on first open, viral artifact on win, re-engagement on followed analyst action — are the entire top-of-funnel / retention cycle in three tickets.

---

**Written:** 2026-06-07
**Next review:** After Sprint 49 delivery
