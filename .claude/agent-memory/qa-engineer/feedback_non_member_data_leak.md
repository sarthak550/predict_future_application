---
name: feedback-non-member-data-leak
description: Group detail route returns full member roster to non-members when spreading the Prisma object unconditionally — caught in S56-T5
metadata:
  type: feedback
---

When a group detail route opens access to non-members (e.g., for RTJ/OPEN groups so they can see the CTA), the CTO consistently forgets to strip member-only data from the response.

In S56, `apps/api/app/api/groups/[id]/route.ts` fetched the group with `include: { memberships: { include: { user: ... } } }` and then returned `{ ...group }` unconditionally. Non-members received the full member list (userId, username, avatarUrl, reputationScore).

**Why:** The Prisma `include` is used internally to compute `isMember` and `callerMembership`. When it later spreads `...group` into the response, all included relations go with it — the CTO doesn't notice because TypeScript doesn't complain.

**How to apply:** Any time a group detail route is extended to allow non-member access, check that the response shape is gated. Either:
- project only safe fields for non-members (strip `memberships` from response when `!isMember`), or
- use a separate `select` query for the public-facing data and a different query for member-only data.

**Related finding:** S56-T5 FAIL. Same pattern risk exists on any future route that partially opens a previously-member-only resource.
