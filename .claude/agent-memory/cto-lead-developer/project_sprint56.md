---
name: project-sprint56
description: S56 REQUEST_TO_JOIN — third visibility tier, GroupJoinRequest schema, 6 new API routes, 3 mobile screens, push helpers, analytics events. All 9 tickets complete.
metadata:
  type: project
---

Sprint 56 shipped the REQUEST_TO_JOIN visibility tier end-to-end.

**Why:** Third tier between OPEN (anyone joins) and INVITE_ONLY (code-only). Communities can be discoverable and curated simultaneously.

**Schema (T1):**
- `GroupVisibility` enum: added `REQUEST_TO_JOIN` (additive, no migration data changes)
- New enum `GroupJoinRequestStatus { PENDING APPROVED REJECTED }`
- New model `GroupJoinRequest` with `@@unique([groupId, userId, status])` — allows re-request after rejection
- Migration: `20260607000003_s56_request_to_join` (hand-crafted SQL via migrate deploy)
- Reverse relations on User: `groupJoinRequests` (JoinRequests) + `decidedJoinRequests` (JoinRequestDecider)

**Key architectural decisions:**
- Cancel uses DELETE (RESTful, consistent with no existing POST-for-cancel patterns)
- callerJoinRequest field added to GET /api/groups/:id response (single round trip for mobile CTA)
- pendingRequestCount field added to group detail (owner/admin only, for inbox badge)
- Group detail access: OPEN and REQUEST_TO_JOIN groups are now accessible to non-members (so they can see the CTA). INVITE_ONLY still 403s non-members.
- Race condition on double-approve: caught via Prisma P2002 error code, returns 200 idempotent
- memberCap exceeded on approve: 409 member_cap_reached, request stays PENDING

**New API routes (T2-T5):**
- POST /api/groups/:id/join-request — submit request
- DELETE /api/groups/:id/join-request/:requestId — cancel (requester only)
- POST /api/groups/:id/join-request/:requestId/approve — approve (OWNER/ADMIN)
- POST /api/groups/:id/join-request/:requestId/reject — reject with optional note (OWNER/ADMIN)
- GET /api/groups/:id/join-requests — inbox, paginated, asc order (OWNER/ADMIN)
- GET /api/groups/join-requests/mine — requester's own requests (30-day window)
- Updated GET /api/groups/:id — callerJoinRequest + pendingRequestCount fields
- Updated GET /api/groups/discover — includes REQUEST_TO_JOIN groups, adds visibility field
- Updated POST /api/groups/:id/join — returns 400 request_to_join code for RTJ groups

**Push helper (T9):**
- /apps/api/lib/groups/group-request-push.ts — two functions: notifyOwnersAndAdminsOfNewRequest + notifyRequesterOfDecision
- Fire-and-forget with void + catch pattern, never blocks HTTP response

**Mobile (T6-T8):**
- group/[id].tsx: extended MemberStatus with request_pending + request_rejected; JoinCTA handles all 3 RTJ states; pendingRequestCount badge on kebab; callerJoinRequest used for optimistic state
- group/[id]/requests.tsx: approval inbox sibling screen (sibling pattern, matches members.tsx)
- my-join-requests.tsx: flat list of user's own requests
- groups.tsx: "Pending requests (N)" row in My Groups (hidden when N=0); RTJ discover card navigates to group profile
- create.tsx: three-option visibility picker (Open | Request | Invite only)
- analytics.ts: 4 new events — group_request_submitted/cancelled/approved/rejected

**How to apply:** When debugging join-request issues, check: (1) visibility is REQUEST_TO_JOIN before the POST route will accept the request, (2) callerJoinRequest is a 7-day window (not 30-day), (3) the mine endpoint uses 30-day window.
