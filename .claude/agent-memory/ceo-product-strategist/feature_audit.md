---
name: Feature Audit
description: Assessed features with User Value x Business Value scores, as of 2026-05-01 strategic review
type: project
---

## High User Value / High Business Value (Double Down)
- Mobile news feed with vertical swipe + insight cards: the core differentiator, extremely well-executed
- AI-generated polls tied to news stories: smart low-friction engagement mechanic
- Host trust scoring system: sophisticated and genuine moat, encodes reputation into the product
- Groups / private markets: highest retention surface in the product

## High User Value / Medium Business Value (Invest Selectively)
- Badges and leaderboard: good gamification, needs more weight in UX to drive behavior
- Binary + numeric markets: good coverage of prediction types
- Challenge + resolution workflow: necessary for integrity, but complex UX

## Medium User Value / Low Business Value (Simplify or Defer)
- Admin panel: necessary but not a user value driver — keep it functional, don't over-invest
- Polls as separate tab from markets: creates UX fragmentation — consider collapsing into feed
- GROUP_VOTE resolution mode: complex, low usage likely — monitor before investing further

## Critical Gaps (Missing High Value Features)
- Real mobile auth (currently using a demo user ID env var) — blocks any real user acquisition
- Onboarding flow: no guided first-run experience to explain points, markets, or host system
- Market detail page on mobile: listed as scaffold/shell, not complete
- Create market on mobile: needs end-to-end testing; complex form for mobile
- Profile page on mobile: scaffold only
- Push notifications: not implemented (critical for market resolution, challenges, outcomes)
- Social sharing: no way to share a market or result externally
