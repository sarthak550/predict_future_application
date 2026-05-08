---
name: Competitive Intelligence — Sprint 25/26 Planning (Refreshed)
description: Full competitive research refreshed 2026-05-08. Manifold feature verdict table + deep dives on Metaculus, Kalshi Social, Polymarket, GJ Open, Smarkets, Indian landscape post-PROGA. Probo fully shut down; Kalshi launched full social layer.
type: project
---

## Research Date: 2026-05-08 (Refreshed — supersedes previous version)

---

## Manifold Feature Verdicts (filtered against our thesis)

| Feature | Fits our thesis? | One-line reason |
|---|---|---|
| Loans | No | DeFi/financial mechanic; zero India-first relevance; adds regulatory surface area with no user benefit in play-money context |
| Bounty Markets | Yes — reframe as "Analyst Research Q&A" | Structured analyst responses with mandatory reasoning field; crowd rewards best analysis; genuine moat feature |
| Comment Tips | Yes — modified (cap daily tips per user) | Tip totals surface on analyst profiles as credibility signal; micro-reward for quality reasoning |
| Market Boosts | No | Pay-to-win corrupts the credibility signal; our moat is authentic analyst ranking, not promoted visibility |
| Topic Cluster Browsing | Yes — Sprint 26 | Build as backend tag system first; needs min 10 markets/topic to have value; Finance/IPO/Cricket clusters align perfectly |
| Category Filters | Yes — Sprint 25 (cheap win) | Finance/Cricket/Politics/Bollywood/Startups filter tabs; critical for the analyst-scorecard positioning |
| Limit Orders | No | Trading-platform framing; cognitive overhead for casual retail user; misaligns with play-money positioning |
| Platform Brier Score | Yes — Sprint 25 P1 | Core of "India's Analyst Scorecard" positioning; must show on every profile; our primary credibility signal |
| Phone Verification Bonus | Yes — Sprint 25 | Trust layer + future SEBI/regulatory compliance signal; +50 pts bonus is low-friction |
| Predictle (daily puzzle) | Yes — Modified (Sprint 26) | Reframe as "Daily Call" — one curated market per day served at 8am; drives D1/D7 habit without full prediction-market cognitive load |

---

## Metaculus — Key Findings

- **Peer Score framing**: Score is "how much better than the average forecaster on the same question" — average always 0. This relative framing ("you beat 73% of analysts on this call") is more motivating than absolute Brier numbers. Directly applicable to our analyst leaderboard.
- **Calibration curves per user**: Every profile shows a calibration chart — when you said 70%, did the event happen 70% of the time? This is a visual, sharable proof of skill. We should build this for analyst profiles.
- **Tournament system with sponsor prizes**: Organizations (Bridgewater, The Economist) co-brand forecasting tournaments. For us: ET Markets co-branded "Market Call Tournament" — analyst accuracy challenge, monthly, co-branded. Zero engineering, pure BD.
- **FutureEval leaderboard (human vs AI)**: Tracks whether pro forecasters beat frontier AI models. Narrative hook for press: "Can India's retail investors beat AI on market calls?" — we can build the same narrative with our leaderboard.
- **Notebooks feature**: Long-form analysis posts attached to questions, separate from comments. For us: "Analyst Brief" — a structured field (thesis, key risk, time horizon) attached to every market call. Richer than a comment, lighter than a research report.
- **No daily retention mechanic confirmed**: Metaculus does not appear to have a daily puzzle/streak loop. This is our differentiator.

---

## Kalshi — Key Findings (Significant: Kalshi launched full social layer in 2025-2026)

- **Kalshi Social — fully shipped**: Personalized "For You" feed, follow traders, real-time notifications when followed traders move, Inner Circle (share your full portfolio view with trusted friends/family via private link). Every user gets a Social profile by default.
- **Inner Circle mechanic**: Private link gives friends real-time view into your trade activity with push alerts. For us: "Follow My Calls" — shareable analyst feed link to WhatsApp. When you make a call, followers get a push. High-virality mechanic.
- **For You feed on mobile**: Personalized by who you follow and your market interests. We need this — right now our feed is chronological. Algorithmic curation based on analyst follows would dramatically improve D7/D30 retention.
- **Community feed with market idea submissions + voting**: Users submit ideas for new markets; community votes on what gets created. For us: crowd-sourced market creation with community upvotes — top-voted ideas get surfaced for admin approval. Reduces our content team burden.
- **Position-linked comments (from Kalshi Ideas)**: Every comment/post tied to whether the commenter holds a position. "Has skin in the game" label forces accountability. This is our "Verified Caller" badge — show on every comment whether the analyst has an active stake in the outcome.
- **Leaderboard with public trader profiles**: Net profit by day/week/month/all-time; trader profiles show recent activity and profitable categories. Third-party copy-trading bots emerged from this public data. For us: public analyst profiles indexed by Google = press hooks + organic SEO.

---

## Polymarket — Key Findings

- **User profiles as standalone shareable media objects**: Profile shows Brier score, win rate, recent calls, P&L. No login required to view. Third-party analytics ecosystem (PolyTrack, PredictingTop, Polycopy, Hashdive) built on public profile data — these sites have their own SEO and audience. For us: public analyst profile URL as "credibility card" is the #1 press and SEO play.
- **Activity feed (real-time trade stream)**: Live feed of what positions are being taken across the platform, tied to market pages. Community can see when large positions move. For us: "Hot Calls" feed — analyst calls sorted by recency and stakes, live.
- **Social feed attempt — cautionary tale**: Polymarket's social feed experiment (text + image posts, Reddit-style upvotes) "turned the platform into a misinformation machine." Their moderation infrastructure was "wholly inadequate." Important lesson: social posts without accountability create noise. Our design counter: every call must be attached to a market (no free-floating text posts). Accountability by design.
- **Badges ecosystem**: Polybaddies, Traders, Polybuilders, Poly Sports. Role-based identity. For us: Analyst tiers (Rookie / Analyst / Senior Analyst / Chief Analyst) based on call volume + accuracy — not just a badge but a persistent rank that shows on every interaction.

---

## Good Judgment Open — Key Findings

- **Three-score system**: Brier Score (raw accuracy), Median Score (vs. the crowd), Relative Brier Score (vs. crowd weighted by participation rate). The Relative score penalizes lurkers — you must actually forecast to rank. Our equivalent: Credibility Score = Accuracy x Participation Rate (active callers rank above passive browsers).
- **Superforecaster pathway = career credential**: Partners include The Economist (11-year collaboration), Harvard, Bridgewater, UBS. The "Superforecaster" designation is used on CVs. For us: "Verified Analyst" designation on Predict Future should be positioned as a credential for finance interviews. Marketing angle: "Add it to your LinkedIn."
- **Rationale badges (25/50/100 rationales written)**: Writing a reasoning field is rewarded with persistent badges. For us: make reasoning mandatory (not optional) on all calls — and badge the people who write the best reasoning (as voted by community). Quality of reasoning matters as much as accuracy.
- **Anonymous forecasting option**: Users can post anonymously but their track record still accrues. For us: allow anonymous market calls but the accuracy record still builds. When anonymous users top the leaderboard, reveal creates narrative moment.
- **Follower/following with badge at 20+ followers**: Social graph with explicit rewards for building audience. For us: "Analyst Reach" metric — number of followers is a credibility dimension alongside accuracy. Someone with 1,000 followers and 60% accuracy is a different profile from someone with 5 followers and 70% accuracy.

---

## Smarkets — Key Findings (Limited relevance — primarily a real-money UK exchange)

- **Live candlestick price charts per market**: Historical probability movement shown as a chart (time-series of odds changes). For us: show probability movement over time on each market — "The Consensus Line." Visual representation of how community opinion shifted as news broke.
- **Position history CSV export**: Users can download their full trade history. For us: analyst portfolio export — downloadable record of all calls, outcomes, accuracy. A professional artifact that can be shared or submitted to employers.
- **Trade Out (one-click position close)**: Automatically calculates opposing bet to close your position and lock in partial win/loss. For us: "Change My Call" — allow users to update their market position before resolution, with the update tracked as a revision (shows on profile as "revised 2 times").
- Smarkets is UK-based, real-money, cricket/sports-focused. No analyst credibility layer. Not a direct competitor. Skip for future research.

---

## Indian Competitive Landscape — Post-PROGA 2025

### Regulatory Reality (Critical Update)
- **PROGA 2025 (Promotion and Regulation of Online Gaming Act)** passed by Rajya Sabha, enacted August 22, 2025. Bans all real-money online games at the federal level.
- Probo shut down real-money operations entirely. ED (Enforcement Directorate) attached Rs 117 crore in Probo assets amid money laundering probe. CEO's own words: "Everyone advised me against this idea."
- Dream11, WinZO, Gameskraft faced ED raids in 2025-2026. Broader crackdown across real-money gaming sector.
- SEBI stated opinion trading instruments are not "securities" — no investor protection applies.
- **Play-money / virtual points model is our legal safe harbor.** No cash = no PROGA exposure = no ED exposure. This is now a genuine strategic moat, not just a positioning choice.

### Surviving Indian Apps (Real-Money, Under Legal Pressure)
- **Real11, SportsBaazi, Fantafeat, PlayerzPot**: All real-money, all under regulatory pressure. No analyst credibility layer on any of them. Sports-first, not finance-first.
- **MPL Opinio**: Connected to MPL wallet (real-money); regulatory exposure. "Player vs player" matchup format ("Will Virat outscore Rohit?") is interesting as a format but legally exposed.
- **Better Opinions (YC W22)**: $2.5M raised, 600K users, 14K events. Real-money YES/NO trading — now legally exposed under PROGA 2025. Never built analyst credibility layer.
- **Exchange 22**: "Buy/sell player shares" stocks-model for sports players. Novel but legally grey and sports-focused.

### The Gap We Fill
No Indian platform has:
1. A play-money / virtual-points model (our legal advantage)
2. A finance-first analyst credibility layer
3. A public, SEO-indexed analyst profile as a portable career credential
4. News-native market creation tied to real sell-side analyst calls

### Displacement Opportunity
34M Probo users displaced. They were comfortable with YES/NO opinion interfaces. Our onboarding friction is lower than Manifold (no market creation required). Sprint 25 must be live before this window closes.

---

## Key Strategic Decisions From This Session

1. **Kalshi Social is the best playbook for our "Follow My Calls" feature**: For You feed + push notifications when followed analysts move = core retention loop. Sprint 25 priority.
2. **Polymarket misinformation cautionary tale**: Do not allow free-floating text posts. Every social interaction must be anchored to a market call. Accountability by design.
3. **Relative score framing beats absolute Brier**: "You beat 73% of analysts on this call" is more motivating and viral than raw score. Apply to all score displays.
4. **GJ Open's participation-weighted scoring**: Credibility Score = Accuracy × Participation Rate. Penalizes lurkers, rewards consistent callers. More accurate representation of analyst quality.
5. **Probability movement chart (consensus line)**: Showing how community probability shifted over a market's life is a compelling visual and a press hook ("Here's how the market saw the YES Bank earnings miss coming").
6. **Analyst Duel mechanic remains a Sprint 26 strategic bet**: MPL Opinio's head-to-head format + our credibility layer = high-narrative, high-shareability format.
7. **Play-money model is now a legal moat, not just a positioning choice**: PROGA 2025 eliminated all real-money competition. First mover in play-money finance-first opinion trading in India.

**Why:** PROGA 2025 reshaped the Indian opinion trading market more decisively than anticipated. The legal risk that was a "known blocker" for real-money competitors has now been triggered. Our positioning as play-money is no longer just conservative — it is now competitively advantaged.
**How to apply:** Sprint 25 scope is locked to analyst credibility features + profile visibility + follow/notification loop. Legal moat should be called out explicitly in press and App Store copy.
