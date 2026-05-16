---
name: Sprint 26 T5 — Anonymous Calls
description: S26-T5 COMPLETE: UserDisplayMode enum, getDisplayName helper, applied to all public surfaces, PATCH route, mobile toggle
type: project
---

S26-T5 ships anonymous display mode with full accuracy accrual.

**Why:** GJ Open research shows anonymous forecasting reduces social risk for new users; powerful onboarding lever for finance audience.

**Key decisions:**
- Anonymity is display-only — URL discoverability unchanged. `/profile/alice` still resolves by username; response returns pseudonym in `username` field.
- Own-view exception: `/api/profile/me` always returns real username + `displayMode` field. The user never sees themselves as anonymous.
- Pseudonym: `AnonymousAnalyst_{sha256(userId)[0:6].toUpperCase()}` — computed on-the-fly, no DB column for hash.
- Dedicated route `PATCH /api/users/me/display-mode` (also responds to PUT). Zod validation. Wraps in try/catch.

**Files changed:**
- `apps/api/prisma/schema.prisma` — `UserDisplayMode` enum + `User.displayMode` field
- `apps/api/lib/users/displayName.ts` — NEW: `getDisplayName()` helper
- `apps/api/app/api/profile/[username]/route.ts` — apply pseudonym, add `displayMode` to response
- `apps/api/app/api/profile/me/route.ts` — add `displayMode` to own-profile response (real username kept)
- `apps/api/app/api/leaderboard/route.ts` — apply pseudonym to all 3 leaderboard modes + targetEntry
- `apps/api/app/api/markets/[marketId]/route.ts` — apply pseudonym to creator + comment authors
- `apps/api/app/api/markets/[marketId]/comments/route.ts` — apply pseudonym in GET and POST
- `apps/api/app/api/users/[userId]/followers/route.ts` — apply pseudonym
- `apps/api/app/api/users/[userId]/following/route.ts` — apply pseudonym
- `apps/api/app/api/users/[username]/portfolio/route.ts` — `displayName` field uses pseudonym
- `apps/api/app/api/users/me/display-mode/route.ts` — NEW: PATCH + PUT handler
- `apps/api/app/profile/[username]/page.tsx` — SEO page renders pseudonym in title, og: meta, HTML
- `packages/types/src/index.ts` — `AppUserDisplayMode` type, `displayMode?` on `ApiUserProfile`
- `packages/api-client/src/index.ts` — `setDisplayMode()` method
- `apps/mobile/src/app/(tabs)/profile.tsx` — `AnonymousToggleCard` component with confirm dialog, optimistic update

**How to apply:** When adding new public-facing endpoints that surface a username, import and apply `getDisplayName()` from `apps/api/lib/users/displayName.ts`.
