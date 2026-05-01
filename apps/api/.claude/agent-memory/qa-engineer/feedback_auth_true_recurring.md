---
name: Recurring CTO blind spot — missing auth:true on api-client methods
description: CTO has missed auth:true on api-client request() calls in multiple sprints; now S12 repeats pattern
type: feedback
---

The CTO has a recurring blind spot around `auth: true` in `packages/api-client/src/index.ts`.

**Why:** The `request()` helper only attaches the Authorization Bearer header when `{ auth: true }` is passed as the third argument. Without it, mobile users never authenticate to that endpoint, so any server-side `getUserIdFromRequest()` call returns null — silently breaking all personalization (userVote, userRank, userContext, etc.).

**Known instances:**
- S9-T1: `getNews()` was missing `auth: true` — userVote was always null after feed refresh. Fixed in S9-T1.
- S12: `getLeaderboard()` at packages/api-client/src/index.ts line 198 is missing `auth: true` — userContext and userRank are permanently null for all mobile users. Found in QA 2026-05-02.

**How to apply:** On every ticket that adds or modifies an api-client method calling a route that requires userId (profile, votes, positions, groups, notifications, leaderboard, hosts), Check B must verify `auth: true` is present. This is now a two-ticket pattern — flag to user as systemic CTO blind spot per escalation policy.
