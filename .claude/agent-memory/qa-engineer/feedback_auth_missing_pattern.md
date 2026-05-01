---
name: Recurring CTO auth failure — missing auth:true on market detail fetch
description: CTO has twice missed adding auth:true to api-client methods that return user-specific data, causing mobile Bearer JWT to never reach the server
type: feedback
---

The CTO has a systemic blind spot around `auth: true` in the api-client and `getUserIdFromRequest` in API route handlers.

**Rule:** Every api-client method that fetches data containing user-specific fields (userPositions, userVote, votes, profile data) MUST pass `{ auth: true }` in request options. Every API route GET handler that personalizes the response (filters by userId, returns user positions, etc.) MUST use `getUserIdFromRequest(request)`, not `getSession()` alone.

**Why:** `getSession()` reads NextAuth cookies — it always returns null for mobile requests that send `Authorization: Bearer <jwt>`. Mobile never sends cookies. `getUserIdFromRequest` tries Bearer first, then falls back to session. If `auth: true` is missing from the api-client call, the Bearer token is never set in the Authorization header at all, so even a correct server implementation would never see the user.

**Known failures and resolutions:**
- S8-T2 (2026-05-01, first submission): `getMarketById` in api-client missing `auth: true`. Market detail GET route uses `getSession()` only — no `getUserIdFromRequest`. Result: `userPositions` always empty on mobile, resolution modal never fires.
- S8-T2 (2026-05-01, resubmission): CTO fixed both issues. `getMarketById` now passes `{ auth: true }`. GET handler now uses `getUserIdFromRequest`. Bonus fixes applied to `news/route.ts` and `news/feed/route.ts` correctly. Passed QA on second attempt.

**How to apply:** On every ticket that touches market detail, profile, votes, positions, or any endpoint that returns per-user data — audit BOTH the api-client method for `auth: true` AND the route handler for `getUserIdFromRequest`. Do not accept a PASS if either is missing.
