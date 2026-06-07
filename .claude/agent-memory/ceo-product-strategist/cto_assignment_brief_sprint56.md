---
name: cto-assignment-brief-sprint56
description: Sprint 56 — REQUEST_TO_JOIN (Pillar B) — third visibility tier, join-request model, approval inbox, push notifications, requester-side status surface. Issued 2026-06-07.
metadata:
  type: project
---

## Sprint 56 — Request to Join: Closing the Third Visibility Tier

**Issued:** 2026-06-07
**Theme:** Pillar B, community structure. `REQUEST_TO_JOIN` is the missing middle tier between "anyone can walk in" (`OPEN`) and "invite code only" (`INVITE_ONLY`). It is the right default for communities that want curation without locking discovery. A casual user browsing Explore can find the group and signal interest; the owner decides who gets in. Approval inbox + push notifications make this usable in practice — without the inbox the owner has no clean way to see pending requests; without push neither party has any signal that anything happened. This sprint closes the approval loop end-to-end.

**Pillar clarity:** Pillar B only. No analyst-scorecard surfaces (Pillar A) are touched. SEBI flag unchanged.

**Schema-write constraint:** Only S56-T1 touches `prisma/schema.prisma`. CTO must run the T1 migration before any API or mobile ticket writes code against the new fields/model.

---

## Pre-conditions (CTO must verify before writing code)

1. `GroupVisibility` enum currently has two values: `INVITE_ONLY`, `OPEN`. The schema comment reads `/// S54: Two-tier visibility model. REQUEST_TO_JOIN ships in S55.` — that comment is stale; this is now S56.
2. `GroupMembership` has `bannedAt DateTime?` + `banReason String?` tombstone from S54. No `GroupJoinRequest` model exists yet.
3. `POST /api/groups/:id/join` (current file: `apps/api/app/api/groups/[id]/join/route.ts`) has a single visibility branch: `if (group.visibility !== "OPEN") → 403`. A third branch for `REQUEST_TO_JOIN` must be added.
4. Ban route pattern (`apps/api/app/api/groups/[id]/ban/route.ts`): role-check pattern, caller must be OWNER or ADMIN — follow this exactly for approval/rejection routes.
5. Push pattern: `sendExpoPushNotifications` helper exists in `apps/api/lib/markets/resolution.ts`. User push token field is `expoPushToken` on `User`. Reuse or extract into a shared helper — do not duplicate raw Expo fan-out logic.
6. Mobile `group/[id].tsx` CTA state machine: `MemberStatus` type is `"owner" | "admin" | "member" | "banned" | "none"`. `resolveMemberStatus` derives it from `group.memberships`. Both the type and the resolver must be extended for REQUEST_TO_JOIN states.
7. `apps/mobile/src/app/group/[id]/members.tsx` exists. The approval inbox can live as a sibling screen (`group/[id]/requests.tsx`) or as a tab inside the existing members screen — CTO picks based on existing patterns.

---

## Tickets

### S56-T1 (CRITICAL) — Schema: add REQUEST_TO_JOIN enum value + GroupJoinRequest model

**Files:** `apps/api/prisma/schema.prisma`, new migration file.

**What to build:**

1. Extend `GroupVisibility` enum:
   ```
   enum GroupVisibility {
     INVITE_ONLY
     OPEN
     REQUEST_TO_JOIN
   }
   ```

2. Add new enum `GroupJoinRequestStatus`:
   ```
   enum GroupJoinRequestStatus {
     PENDING
     APPROVED
     REJECTED
   }
   ```

3. Add new model `GroupJoinRequest`:
   ```
   model GroupJoinRequest {
     id            String                 @id @default(cuid())
     groupId       String
     userId        String
     status        GroupJoinRequestStatus @default(PENDING)
     requestedAt   DateTime               @default(now())
     decidedAt     DateTime?
     decidedById   String?
     decisionNote  String?

     group         Group                  @relation(fields: [groupId], references: [id], onDelete: Cascade)
     user          User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
     decidedBy     User?                  @relation("JoinRequestDecider", fields: [decidedById], references: [id])

     @@unique([groupId, userId, status])
     @@index([groupId, status])
   }
   ```

   The `@@unique([groupId, userId, status])` constraint prevents two PENDING requests from the same user to the same group. Note: after a REJECTED request, a user can submit a new PENDING request (new row) because the unique key includes status — this is intentional v1 behavior (no cooldown in S56).

4. Add the reverse relation on `Group`:
   ```
   joinRequests  GroupJoinRequest[]
   ```

5. Add reverse relations on `User` (requester side and decider side).

6. Update the stale comment on `GroupVisibility`:
   ```
   /// Three-tier visibility model. INVITE_ONLY = invite code only. OPEN = anyone joins. REQUEST_TO_JOIN = owner approves.
   ```

**Migration behavior:** Additive only. Existing `OPEN` and `INVITE_ONLY` groups are untouched. No data migration needed.

**Acceptance criteria:**
- `prisma generate` and `prisma migrate dev` succeed without errors.
- `GroupJoinRequestStatus` enum and `GroupJoinRequest` model appear in generated Prisma client.
- Unique index on `(groupId, userId, status)` is present.
- Composite index on `(groupId, status)` is present for inbox query performance.

---

### S56-T2 (CRITICAL) — API: POST /api/groups/:id/join-request + DELETE /api/groups/:id/join-request/:requestId (cancel)

**Files:** New `apps/api/app/api/groups/[id]/join-request/route.ts`, new `apps/api/app/api/groups/[id]/join-request/[requestId]/route.ts`.

**POST /api/groups/:id/join-request — Submit a request**
- Auth required.
- Fetch group by `id`. Return 404 if not found or archived.
- Return 400 with `{ error: "This group does not require a request.", code: "wrong_visibility" }` if `visibility !== "REQUEST_TO_JOIN"`.
- Check caller is not banned (`bannedAt != null` on GroupMembership tombstone) → 409 `{ error: "You have been removed from this group.", code: "banned" }`.
- Check caller is not already a member → 200 idempotent `{ alreadyMember: true }`.
- Check for existing PENDING request from this user → 200 idempotent `{ requestId, status: "PENDING" }`.
- Check for existing APPROVED request (user is technically in an inconsistent state if this happens) → treat as already-member, return 200.
- Create `GroupJoinRequest` row with `status = PENDING`.
- Fire push notification fan-out to all OWNER and ADMIN members of the target group: title "New join request", body "[username] wants to join [Group Name]." — fan-out is bounded by the number of owners/admins (typically 1–5). Use a fire-and-forget void call; do not let push failure block the HTTP response.
- Return 200 `{ requestId, status: "PENDING" }`.

**DELETE /api/groups/:id/join-request/:requestId — Cancel a request**
- Auth required.
- Fetch the `GroupJoinRequest` by `requestId`. Return 404 if not found.
- Verify `request.userId === callerId` → 403 if not.
- If status is not PENDING: return 409 `{ error: "Request already decided.", code: "already_decided" }`.
- Delete the row (hard delete — the request never resulted in membership).
- Return 204.

**Acceptance criteria:**
- Submitting a request to an OPEN group returns 400 with `wrong_visibility`.
- A banned user gets 409.
- A second POST from the same user to the same group returns 200 idempotent (no duplicate row created).
- Push notification fires to all admins/owners of the target group (verify via log in QA).
- Cancel route deletes the row and returns 204.
- Cancel on an already-approved or already-rejected request returns 409.

---

### S56-T3 (CRITICAL) — API: Approval + rejection routes

**Files:** New `apps/api/app/api/groups/[id]/join-request/[requestId]/approve/route.ts`, new `apps/api/app/api/groups/[id]/join-request/[requestId]/reject/route.ts`.

Follow the same auth + role-check pattern as `apps/api/app/api/groups/[id]/ban/route.ts`.

**POST .../approve**
- Auth required. Caller must be OWNER or ADMIN of `params.id` group.
- Fetch `GroupJoinRequest` by `requestId`. Return 404 if not found.
- Verify `request.groupId === params.id` → 400 if mismatched.
- Idempotent: if status is already APPROVED, return 200 `{ approved: true }` with no side effects.
- If status is REJECTED: return 409 `{ error: "Request was already rejected.", code: "already_rejected" }`.
- Check member cap: `SELECT COUNT(*) FROM GroupMembership WHERE groupId = X AND bannedAt IS NULL`. If `count >= memberCap` → return 409 `{ error: "This group is full.", code: "member_cap_reached" }`.
- Atomically in a `$transaction`:
  1. Update `GroupJoinRequest.status = APPROVED`, `decidedAt = now()`, `decidedById = callerId`.
  2. Create `GroupMembership` row for `request.userId` with `role = MEMBER`.
- Fire push notification to the requester: title "You're in!", body "Your request to join [Group Name] was approved."
- Return 200 `{ approved: true }`.

**POST .../reject**
- Auth required. Caller must be OWNER or ADMIN.
- Fetch `GroupJoinRequest` by `requestId`. Verify `groupId` match.
- Idempotent: if status is already REJECTED, return 200 `{ rejected: true }`.
- If status is APPROVED: return 409 `{ error: "Request was already approved.", code: "already_approved" }`.
- Body: `{ note?: string }` (optional rejection reason).
- Update `GroupJoinRequest.status = REJECTED`, `decidedAt = now()`, `decidedById = callerId`, `decisionNote = note ?? null`.
- Fire push notification to the requester: title "Request not approved", body "Your request to join [Group Name] wasn't approved." + append `note` if present: ` Reason: [note]`.
- Return 200 `{ rejected: true }`.

**Open question for CTO — answer before writing code:** Should approve + reject always auto-fire push? My recommendation: yes, always. This is a user-facing decision event, not a background moderation action. If the CTO disagrees, flag it.

**Acceptance criteria:**
- Non-member, non-admin caller gets 403 on both routes.
- Approving creates a `GroupMembership` row atomically (verify both rows exist after approve).
- Approving a full group returns 409 `member_cap_reached`.
- Re-approving an already-approved request is idempotent (no duplicate membership row, no error).
- Push fires to requester on both approve and reject (verify in QA log).
- Race condition: if two admins approve simultaneously, the `$transaction` + unique constraint on `GroupMembership(groupId, userId)` must prevent duplicate membership rows. One succeeds, one gets a DB unique violation — catch it and return 200 (idempotent success).

---

### S56-T4 (CRITICAL) — API: GET /api/groups/:id/join-requests (approval inbox) + GET /api/groups/join-requests/mine (requester surface)

**Files:** New `apps/api/app/api/groups/[id]/join-requests/route.ts`, new `apps/api/app/api/groups/join-requests/mine/route.ts`.

**GET /api/groups/:id/join-requests — Owner/admin inbox**
- Auth required. Caller must be OWNER or ADMIN → 403 if not.
- Query params: `status?: "PENDING" | "APPROVED" | "REJECTED"` (default: `"PENDING"`), `cursor?: string`, `limit?: number` (default 20, max 50).
- Response:
  ```json
  {
    "requests": [
      {
        "id": "...",
        "userId": "...",
        "username": "...",
        "avatarUrl": "... | null",
        "requestedAt": "ISO8601",
        "status": "PENDING"
      }
    ],
    "nextCursor": "... | null"
  }
  ```
- Ordered by `requestedAt DESC`.

**GET /api/groups/join-requests/mine — Requester status surface**
- Auth required.
- Returns the caller's own `GroupJoinRequest` rows across all groups, filtered to PENDING + recently-decided (last 30 days).
- Response:
  ```json
  {
    "requests": [
      {
        "id": "...",
        "groupId": "...",
        "groupName": "...",
        "groupSlug": "...",
        "status": "PENDING | APPROVED | REJECTED",
        "requestedAt": "ISO8601",
        "decidedAt": "... | null",
        "decisionNote": "... | null"
      }
    ]
  }
  ```
- No pagination needed for `mine` — a user realistically has < 50 active requests at any time.

**Acceptance criteria:**
- Non-admin caller on `/:id/join-requests` gets 403.
- Returns empty array (not 500) when no PENDING requests exist.
- Pagination: calling with `nextCursor` yields next page with no duplicates.
- `mine` returns only the caller's own requests (never another user's).

---

### S56-T5 (CRITICAL) — Update join route + discover route for REQUEST_TO_JOIN

**Files:** `apps/api/app/api/groups/[id]/join/route.ts`, `apps/api/app/api/groups/discover/route.ts`.

**Update join route:**
The current branch is `if (group.visibility !== "OPEN") → 403`. Add a third case:
- If `visibility === "REQUEST_TO_JOIN"`: return 400 `{ error: "This group requires a request to join.", code: "request_to_join" }`.
- This prevents callers from bypassing the request flow by hitting the OPEN join endpoint directly.

**Update discover route:**
- `GET /api/groups/discover` currently returns only `visibility = OPEN` groups. Extend filter to include `visibility IN ["OPEN", "REQUEST_TO_JOIN"]` — REQUEST_TO_JOIN groups should appear in discovery (that's the point of the tier).
- Add a new `visibility` field to the discover response shape for each group card:
  ```json
  { "visibility": "OPEN | REQUEST_TO_JOIN" }
  ```
  The mobile browse card uses this to decide which CTA to render ("Join" vs "Request to Join").

**Acceptance criteria:**
- `POST /api/groups/:id/join` on a REQUEST_TO_JOIN group returns 400 with `request_to_join` code (not 403 invite_only).
- `GET /api/groups/discover` now returns REQUEST_TO_JOIN groups.
- Discover response includes `visibility` field on each group object.
- INVITE_ONLY groups are still excluded from discover (no change).

---

### S56-T6 (HIGH) — Mobile: group profile CTA state machine extension

**Files:** `apps/mobile/src/app/group/[id].tsx`.

**What to build:**

1. Extend `GroupData` type: add `visibility: "INVITE_ONLY" | "OPEN" | "REQUEST_TO_JOIN"`.

2. Extend the API response shape to include the caller's pending join request (if any):
   ```ts
   pendingRequest?: { id: string; status: "PENDING" | "APPROVED" | "REJECTED"; decisionNote?: string | null } | null;
   ```
   The existing `GET /api/groups/:id` route (or a new field on `GroupData`) must return this. CTO should add `callerJoinRequest` to the group detail API response — a single lookup for the calling user's most recent PENDING or recently-decided (last 7 days) join request.

3. Extend `MemberStatus` type:
   ```ts
   type MemberStatus =
     | "owner"
     | "admin"
     | "member"
     | "banned"
     | "request_pending"    // new
     | "request_rejected"   // new
     | "none";
   ```

4. Extend `resolveMemberStatus` to check `pendingRequest`:
   - If membership exists → existing logic (owner/admin/member/banned).
   - If no membership and `pendingRequest?.status === "PENDING"` → `"request_pending"`.
   - If no membership and `pendingRequest?.status === "REJECTED"` → `"request_rejected"`.
   - Otherwise → `"none"`.

5. Extend `JoinCTA` to handle new states:
   - `memberStatus === "none"` + `visibility === "REQUEST_TO_JOIN"`: primary button "Request to join" → calls `POST /api/groups/:id/join-request`. On success, flips to `request_pending` state.
   - `memberStatus === "request_pending"`: non-tappable muted label "Request pending" + a ghost "Cancel request" button below it → calls `DELETE /api/groups/:id/join-request/:requestId`.
   - `memberStatus === "request_rejected"`: muted label "Request not approved" (+ show `decisionNote` below it if present). No retry button in v1 — user can tap it again to re-request (submits a new PENDING row).
   - All existing states (none+OPEN, none+INVITE_ONLY, member, owner, admin, banned) unchanged.

6. Extend the browse discover card (wherever `groups.tsx` renders individual group cards) with the same CTA logic: "Join" for OPEN, "Request to Join" for REQUEST_TO_JOIN. Tapping "Request to Join" navigates to the group profile (where the full state machine is rendered) rather than firing the API inline — avoids duplicating state management in the list.

**Acceptance criteria:**
- A user with no prior request sees "Request to join" button on a REQUEST_TO_JOIN group.
- Tapping submits the request and the CTA flips to "Request pending" without a full page reload.
- "Cancel request" deletes the pending request and resets CTA to "Request to join".
- A rejected user sees "Request not approved" with the decision note if present.
- Existing OPEN and INVITE_ONLY states are unaffected.

---

### S56-T7 (HIGH) — Mobile: Approval inbox screen

**Files:** New `apps/mobile/src/app/group/[id]/requests.tsx` (sibling to existing `members.tsx`). CTO may alternatively implement this as a sub-tab inside the existing members screen — the choice is theirs based on existing nav patterns.

**What to build:**
- Screen for OWNER and ADMIN viewers only. Non-admin access → 403 fallback view.
- Fetches `GET /api/groups/:id/join-requests?status=PENDING` (paginated).
- Each row: avatar placeholder + username + "requested [relative time]" + Approve button + Reject button.
- Reject taps open a bottom sheet or inline input with optional note field + confirm button.
- Approve: optimistic row removal on success. On member_cap_reached error, show toast "Group is full — increase member cap first."
- Empty state when no pending requests: "No pending requests."
- Pull-to-refresh.
- Navigate here from the group profile "Manage Members" / "Pending Requests" owner menu. Add a "Pending Requests (N)" row to the owner actions menu on `group/[id].tsx` showing the count badge if N > 0.

**Acceptance criteria:**
- Owner can approve a request from the inbox; the row disappears and a success toast appears.
- Owner can reject with an optional note; the row disappears.
- Non-owner/admin user navigating directly to this route sees an access-denied state (not a crash).
- Empty state renders correctly.

---

### S56-T8 (HIGH) — Mobile: "My requests" surface + group create flow update

**Files:** Profile screen or My Groups sub-tab (CTO picks the right insertion point), `apps/mobile/src/app/(tabs)/groups.tsx` or wherever the group creation form lives.

**Part A — My requests surface:**
- Small "Pending requests (N)" row inside the existing Profile screen or the My Groups section of the Groups tab. Tapping navigates to a simple flat list screen (`/my-join-requests` or inline sheet) showing the user's pending + recently-decided requests from `GET /api/groups/join-requests/mine`.
- Each row: group name + status badge (Pending / Approved / Rejected) + decision note if rejected.
- "Approved" rows link through to the group profile.
- Do not over-engineer this — pure utility. A FlatList with minimal styling is fine.
- Only show the "Pending requests (N)" row if N > 0 to avoid cluttering the UI for users with no active requests.

**Part B — Group create flow: add REQUEST_TO_JOIN to visibility picker:**
- The visibility picker currently has two options ("Open" / "Invite only"). Add a third option: "Request to join — you approve every member before they join."
- Default stays Open.
- Order: Open | Request to join | Invite only.
- Pass the selected `visibility` value through to `POST /api/groups/create`.
- No other changes to the create flow.

**Acceptance criteria:**
- Group create form shows three visibility options.
- Creating a group with "Request to join" selected results in `visibility = REQUEST_TO_JOIN` on the server.
- The group appears in discover results with a "Request to Join" CTA.
- "My requests" surface shows PENDING requests correctly and updates after a cancel or approval.

---

### S56-T9 (MEDIUM) — Push notification helpers + analytics events

**Files:** Extract or reuse push helper from `apps/api/lib/markets/resolution.ts`. Probably best extracted to `apps/api/lib/push.ts` or `apps/api/lib/notifications.ts`. Add analytics calls to T2 / T3 mobile surfaces.

**Push notifications (API side):**
Two new notification triggers — implement as a reusable helper if the `sendExpoPushNotifications` function in `resolution.ts` is not already generic enough:

1. Request submitted (fires from T2 POST route) → to all OWNER + ADMIN members:
   - Title: "New join request"
   - Body: "[requesterUsername] wants to join [Group Name]."

2. Request approved (fires from T3 approve route) → to the requester:
   - Title: "You're in!"
   - Body: "Your request to join [Group Name] was approved."

3. Request rejected (fires from T3 reject route) → to the requester:
   - Title: "Request not approved"
   - Body: "Your request to join [Group Name] wasn't approved." + if `decisionNote`: " Reason: [note]"

All three are fire-and-forget (`void pushCall.catch(console.error)`). Push failure must never block the HTTP response.

**Analytics events (mobile side):**
Add to `apps/mobile/src/lib/analytics.ts`:
- `group_request_submitted` — `{ groupId, requestId, surface: "group_profile" | "discover_card" }`
- `group_request_cancelled` — `{ groupId, requestId }`
- `group_request_approved` — `{ groupId, requestId }` (fire from the approval inbox screen after a successful API call)
- `group_request_rejected` — `{ groupId, requestId }`

**Acceptance criteria:**
- Push helper is not duplicated — if a shared helper is extracted, both the existing resolution call site and the new group request call sites use it.
- Push notification appears on a test device when a request is submitted (QA should verify with a real token).
- All four analytics events fire with the correct payload (verify via Amplitude or local log in QA).

---

## Open questions for CTO — answer before writing code

1. **Approval inbox placement:** Sibling screen at `group/[id]/requests.tsx` (matches the `members.tsx` pattern) vs. a second tab inside the existing members screen? Either is fine. Sibling is simpler for navigation; sub-tab is more discoverable for owners who are already on the members screen. CTO picks.

2. **memberCap overflow on approve:** If the group is full when an admin approves, the route returns 409. Should the request stay PENDING (owner bumps cap and retries) or auto-transition to a special `APPROVED_OVERFLOW` status? My recommendation: leave as PENDING with a 409 so the admin knows to act. Do not introduce a new status.

3. **Cancel route as DELETE vs POST:** `DELETE /api/groups/:id/join-request/:requestId` is RESTful but some clients prefer POST for actions. CTO picks; just be consistent with existing patterns.

4. **Re-request after rejection:** No cooldown in v1 — a rejected user can immediately submit a new PENDING request. This is fine to start; if it becomes an abuse vector, flag for S57.

5. **`callerJoinRequest` on group detail API:** The T6 mobile CTA needs the caller's current join request status. CTO should decide whether to add this to the existing `GET /api/groups/:id` response or have the mobile client make a separate `GET /api/groups/join-requests/mine` call on mount. Adding it to the group detail response is more efficient (single round trip). Recommendation: add `callerJoinRequest` field to the `GET /api/groups/:id` response when the caller is authenticated.

6. **Push copy templates:** Finalized above in T9. No deviation — short, actionable, human.

---

## Risk callouts

- **Role-check on approval/rejection routes is non-negotiable.** Follow the exact same auth pattern as `ban/route.ts`. A bug here lets any authenticated user approve membership into any group. Test the 403 path explicitly in QA.
- **Race condition on simultaneous approval.** Two admins approve the same request at the same time. The `$transaction` in T3 must catch the unique constraint violation on `GroupMembership(groupId, userId)` and return 200 (idempotent) rather than a 500. This is the second time group membership state is mutated transactionally — get it right.
- **Notification fan-out scale.** Request-submitted push goes to N owners+admins (bounded, typically 1–5, not a full group blast). Request-decided push goes to 1 user. No scale risk here. The open scale risk (market created → all group members) is deferred to S57 with per-group notification prefs.
- **Push token churn.** If a requester rotates devices between submitting a request and receiving a decision push, the push fails silently. Not new; same risk all push paths share. No mitigation needed in S56.
- **`GroupJoinRequest` unique constraint edge case.** The constraint is on `(groupId, userId, status)`. A user can have one PENDING + one historical APPROVED or REJECTED row for the same group (because the statuses differ). On a new request after a rejection, verify the POST route does not trip over the old REJECTED row — the new row has status PENDING and the old has REJECTED, so the constraint is not violated. Write a test for this.
- **Pillar B segregation.** This sprint does not touch analyst credibility scores, expert leaderboard rankings, or any Pillar A surface. If a group has `category = FINANCE`, it shows prediction market activity only. No SEBI-flagged data surfaces added.

---

## Explicitly out of scope for S56 (defer to S57)

- Cover image upload pipeline (URL-only field already exists from S54)
- Per-group notification preferences (required before any 10k-member OPEN/REQUEST_TO_JOIN group ships — this is the S57 unlock)
- Featured-flag curation for the spotlight section
- Unified search across markets + groups + instruments
- GroupModerationAction audit table replacing the `bannedAt` tombstone
- Group activity feed
- Bulk approval (approve-all / reject-all)
- Re-request cooldown after rejection
- Category landing pages
- Group settings edit screen (the "Edit Group" stub from S54-T5 remains a stub)

---

## S56 Success Criteria (CEO will verify)

After QA pass, the CEO will verify:
1. Creating a group with "Request to join" visibility results in `visibility = REQUEST_TO_JOIN`.
2. The group appears in `GET /api/groups/discover` results.
3. A non-member tapping the group's discover card sees "Request to Join" CTA.
4. Tapping "Request to Join" submits a request and the CTA flips to "Request pending" — no full reload.
5. The group owner receives a push notification on a test device when the request is submitted.
6. The owner can navigate to the Approval Inbox and see the pending request.
7. Approving the request creates a membership row and the requester receives a push notification.
8. Rejecting with an optional note fires a push with the note appended.
9. A banned user attempting to submit a join request gets 409.
10. Two simultaneous approvals do not create duplicate membership rows.

---

## S57 Theme Brief

Sprint 57 headline: Discovery polish and notification safety. Per-group notification preferences (required before any OPEN or REQUEST_TO_JOIN group with large membership ships — a member should be able to mute a group's notifications; this is the gating unlock for safe fan-out at scale). Cover image upload pipeline (reuse or build a signed-URL upload flow consistent with user avatars). Category landing pages from the Groups Discover screen (one screen per category showing top groups + "Create a [category] group" CTA). Unified search across markets, groups, and instruments. Featured groups section (admin-curated `isFeatured` flag on Group, populated via admin panel). GroupModerationAction audit table replacing the `bannedAt` tombstone from S54, giving owners a moderation history log. Group activity feed: reverse-chronological "new market added / X joined / market resolved" events inside the group profile. Bulk approve / reject actions in the Approval Inbox. Re-request cooldown after rejection (flag-only in S56 if abuse is observed).
