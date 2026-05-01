---
name: Groups feature implementation notes
description: Architecture decisions for S8-T1 groups feature — discover param, join by ID, auth patterns
type: project
---

S8-T1 (Groups tab) passed QA on 2026-05-01.

Key implementation decisions:
- Discover groups uses `?discover=true` (not `?public=true` as the ticket AC stated). Client and server agree on `discover=true`. This is intentional — there is no `visibility` field on the Group model; all non-archived groups are discoverable.
- `joinGroupById` in the service does NOT enforce a visibility gate before joining. This is acceptable because the only place the Join button appears is in the discover tab, which only returns server-curated group IDs. There is no guest-accessible route to enumerate group IDs.
- All group API routes (`/api/groups`, `/api/groups/join`, `/api/groups/[id]`, `/api/groups/create`, `/api/groups/[id]/launch`) use `getUserIdFromRequest` correctly — Bearer JWT from mobile works.
- `getSession` is imported but unused in `create/route.ts`, `[id]/route.ts`, and `[id]/launch/route.ts`. TypeScript does not error on unused imports. Not a bug, but a linting smell worth noting if a lint pass is ever run.
- `joinGroupFlexSchema` in `packages/validation/src/group.ts` uses `z.union` to accept either `{ inviteCode }` or `{ groupId }` — both join paths are covered.

**Why:** Ticket was clean on first CTO submission. No failures found.
**How to apply:** When reviewing future group-related tickets, know that the Group model has no visibility/public flag — discovery is always "groups you're not yet a member of."
