---
name: cto-assignment-brief-sprint57
description: Sprint 57 — Pillar B member self-service: leave group, transfer ownership, archive. Closes the walk-away gap left from S54. Issued 2026-06-07.
metadata:
  type: project
---

## Sprint 57 — Member Self-Service: Leave, Transfer, Archive

**Issued:** 2026-06-07
**Theme:** Pillar B hygiene. S54 wired kick-out (OWNER/ADMIN removes others) but never wired walk-away (a member leaves voluntarily). S56's REQUEST_TO_JOIN growth makes this urgent: groups are now discovering real users, and those users need a clean exit. Ownership transfer is equally table-stakes — a sole owner who wants to step back today has no escape. This sprint closes that gap in full, preserves the OWNER invariant that every role-check in the codebase depends on, and gives owners two clean outs (transfer or archive) when they want to be done.

**Pillar clarity:** Pillar B only. No Pillar A surfaces (analyst tiers, credibility scores, expert leaderboard) are touched.

**Schema-write constraint:** This sprint should require NO new migration. `Group.isArchived` (Boolean, default false) already exists. `GroupMembership.role` already has `OWNER | ADMIN | MEMBER`. `GroupMembership.bannedAt` already serves the ban tombstone. CTO must verify before writing a migration — if one becomes necessary, it must be the first ticket executed and nothing else touches schema until it is applied.

---

## Pre-conditions (CTO must verify before writing code)

1. `Group.isArchived Boolean @default(false)` — confirmed present in schema from S8.
2. `GroupMembership.role GroupRole` — enum values: `OWNER | ADMIN | MEMBER`. One OWNER per group; schema does not enforce uniqueness but code does. This invariant must be maintained.
3. `GroupMembership.bannedAt DateTime?` — ban tombstone from S54. Banned users must not be able to self-leave (they are tombstoned, not members).
4. No `leftAt` field on `GroupMembership` — confirmed absent. Self-leave does a hard delete of the membership row (same as the OWNER-removes-member DELETE route in S54-T2).
5. `DELETE /api/groups/[id]/members/[userId]/route.ts` — S54-shipped route; caller must be OWNER or ADMIN to remove others. The new self-leave route follows the same auth pattern but permits `callerId === params.userId` for non-OWNER members.
6. `apps/api/lib/groups/service.ts` — service functions: `createGroup`, `joinGroupByInviteCode`, `joinGroupById`, `getDiscoverGroups`, `getUserGroups`. No leave, transfer, or archive functions exist. New service layer belongs here.
7. `GET /api/groups/discover` and `getUserGroups` service function — both already filter `isArchived: false`. CTO must confirm the `/api/groups/[id]` detail route also gates on `isArchived: false` (archived groups should 404 or return a tombstone state to prevent deep-link access).
8. `apps/mobile/src/app/group/[id].tsx` — `handleLeave` stub exists at line 470 with `Alert.alert("Not implemented", "Leave group is coming soon.")`. S57-T4 replaces this stub with real behavior. The `openAdminActions` kebab at line 493 currently has: Manage Members, Pending Requests, Edit Group, Cancel. Transfer Ownership and Archive Group actions go in this same kebab.
9. `packages/api-client/src/index.ts` — no `leaveGroup`, `transferOwnership`, or `archiveGroup` methods exist. CTO must add them.
10. No `GroupMembership` unique constraint violation risk on delete — the `@@unique([groupId, userId])` constraint is relieved when the row is deleted.

---

## Tickets

### S57-T1 (CRITICAL) — API: POST /api/groups/[id]/leave

**Files:** New `apps/api/app/api/groups/[id]/leave/route.ts`, new service function `leaveGroup` in `apps/api/lib/groups/service.ts`.

**What to build:**

`POST /api/groups/:id/leave`
- Auth required.
- Fetch group by `id`. Return 404 if not found or `isArchived = true`.
- Find caller's `GroupMembership` row for this group.
  - No membership row → return 400 `{ error: "You are not a member of this group.", code: "not_member" }`.
  - `bannedAt != null` → return 403 `{ error: "You have been removed from this group.", code: "banned" }`. (Banned users can't leave — they're already tombstoned. This blocks any attempt to self-clean a ban row.)
  - `role === "OWNER"` → return 409 `{ error: "Group owners must transfer ownership or archive the group before leaving.", code: "owner_must_transfer_or_archive" }`.
- Hard-delete the caller's `GroupMembership` row.
- Return 200 `{ left: true }`.

**Service layer:** Add `leaveGroup(input: { groupId: string; userId: string })` to `apps/api/lib/groups/service.ts`. It should throw typed errors matching the HTTP error codes above so the route handler maps them cleanly.

**Acceptance criteria:**
- Non-member caller returns 400 `not_member`.
- Banned caller returns 403 `banned`.
- OWNER caller returns 409 `owner_must_transfer_or_archive`.
- ADMIN and MEMBER callers: membership row is deleted, 200 returned.
- Calling leave twice (idempotent check): second call returns 400 `not_member` (row already gone), not a 500.
- Archived group returns 404.

---

### S57-T2 (CRITICAL) — API: POST /api/groups/[id]/transfer-ownership

**Files:** New `apps/api/app/api/groups/[id]/transfer-ownership/route.ts`, new service function `transferOwnership` in `apps/api/lib/groups/service.ts`.

**What to build:**

`POST /api/groups/:id/transfer-ownership`
- Auth required.
- Body: `{ newOwnerId: string }`.
- Fetch group by `id`. Return 404 if not found or archived.
- Verify caller is the OWNER of this group → 403 if not.
- Guard: `newOwnerId === callerId` → return 400 `{ error: "You are already the owner.", code: "self_transfer" }`.
- Fetch `newOwner` GroupMembership:
  - Not found or `bannedAt != null` → return 400 `{ error: "Target user is not an eligible member.", code: "ineligible_target" }`. (Must be an active, non-banned ADMIN or MEMBER.)
- Atomically in `prisma.$transaction`:
  1. Update outgoing owner's `GroupMembership.role` from `OWNER` → `ADMIN`. (They retain admin power for follow-up cleanup — CTO records this decision inline.)
  2. Update incoming owner's `GroupMembership.role` to `OWNER`.
  3. Update `Group.ownerId` to `newOwnerId`.
  - If either update fails, the transaction rolls back. Both must succeed or neither applies.
- Return 200 `{ transferred: true, newOwnerId }`.

**Audit trail:** No `GroupOwnershipTransfer` table in S57. The S58 `GroupModerationAction` audit table will absorb this. CTO adds `// TODO S58: log ownership transfer to GroupModerationAction` inline.

**Acceptance criteria:**
- Non-OWNER caller returns 403.
- Self-transfer returns 400 `self_transfer`.
- Banned or non-member `newOwnerId` returns 400 `ineligible_target`.
- After success: `Group.ownerId === newOwnerId`, old owner's `GroupMembership.role === "ADMIN"`, new owner's `GroupMembership.role === "OWNER"`. Verify all three in QA.
- Archived group returns 404.
- If transaction half-fails (simulate), no partial state persists.

---

### S57-T3 (CRITICAL) — API: POST /api/groups/[id]/archive

**Files:** New `apps/api/app/api/groups/[id]/archive/route.ts`, new service function `archiveGroup` in `apps/api/lib/groups/service.ts`.

**What to build:**

`POST /api/groups/:id/archive`
- Auth required.
- Fetch group by `id`. If `isArchived = true`, return 200 idempotent `{ archived: true }` (already done).
- Verify caller is OWNER → 403 if not.
- Update `Group.isArchived = true`.
- Preserve all `GroupMembership` rows as-is. Do NOT delete memberships — cascade-deleting would break any market relations tied to group members. Frontend filters `isArchived` groups out; the rows are inert.
- Return 200 `{ archived: true }`.

**Reversibility:** Archive is NOT reversible in v1. No `unarchive` route. CTO adds a comment: `// S58: add unarchive route if needed. isArchived is a simple boolean flip.`

**Discover + detail route hardening:**
- `GET /api/groups/discover` already filters `isArchived: false` — confirmed in pre-conditions. No change needed.
- `getUserGroups` service already filters `isArchived: false` — confirmed. No change needed.
- CTO must verify `GET /api/groups/[id]/route.ts` (the detail route) also returns 404 or a tombstone when `isArchived = true`. If it does not, add the guard in this ticket. An archived group reachable via deep link breaks the expected "it's gone" UX.
- Slug uniqueness: `Group.slug` has `@@unique`. Archiving does NOT release the slug. If someone tries to create a group with the same name, a new slug is generated (the slug generator appends a UUID fragment — already handles collisions). No action needed.

**Acceptance criteria:**
- OWNER can archive the group; `isArchived` flips to `true`.
- Non-OWNER caller returns 403.
- Archived group no longer appears in `GET /api/groups/discover`.
- Archived group no longer appears in `getUserGroups` My Groups list.
- `GET /api/groups/:id` on an archived group returns 404 (or 410 if CTO prefers the semantic distinction — either is acceptable).
- All existing `GroupMembership` rows are preserved after archive (verify via DB check in QA).
- Calling archive twice returns 200 idempotent (no error).

---

### S57-T4 (HIGH) — Mobile: Leave group + owner transfer/archive actions

**Files:** `apps/mobile/src/app/group/[id].tsx`, `packages/api-client/src/index.ts`.

**API client additions first:**
Add three new methods to `packages/api-client/src/index.ts` (in the groups section, following the existing pattern):

```ts
leaveGroup(groupId: string): Promise<{ left: boolean }>
transferOwnership(groupId: string, body: { newOwnerId: string }): Promise<{ transferred: boolean; newOwnerId: string }>
archiveGroup(groupId: string): Promise<{ archived: boolean }>
```

**Leave button (ADMIN + MEMBER viewers only):**
- The `handleLeave` stub at line 470 in `group/[id].tsx` already has the Alert shell. Replace the `Alert.alert("Not implemented", ...)` stub with a real API call:
  1. Alert confirmation: "Leave [Group Name]? You will lose access to its markets and members." — two buttons: Cancel (style cancel) and Leave (style destructive).
  2. On confirm: call `mobileApi.leaveGroup(groupId)`.
  3. On success: `router.replace("/(tabs)/groups")` with a success toast "You left [Group Name]."
  4. On error `owner_must_transfer_or_archive`: show Alert "You're the owner — transfer ownership or archive the group first." (This state should not normally be reached if the button is role-gated, but handle defensively.)
  5. On any other error: show Alert with the error message.
- The Leave button must NOT be rendered when `memberStatus === "owner"`. Verify the existing render condition in the `JoinCTA` or wherever the Leave button is surfaced — it should be gated to `memberStatus === "admin" || memberStatus === "member"`.

**Transfer Ownership (OWNER viewer only, in kebab menu):**
- In `openAdminActions()` at line 493, add a new action entry for OWNER viewers only:
  ```ts
  if (memberStatus === "owner") {
    actions.push({
      text: "Transfer Ownership",
      onPress: () => router.push(`/group/${groupId}/members?mode=transfer`)
    })
  }
  ```
  The actual member picker lives in S57-T5 (members screen). This just navigates there with a `mode=transfer` query param.

**Archive Group (OWNER viewer only, in kebab menu):**
- Add an Archive action for OWNER viewers:
  ```ts
  if (memberStatus === "owner") {
    actions.push({
      text: "Archive Group",
      style: "destructive",
      onPress: handleArchive
    })
  }
  ```
- `handleArchive` function:
  1. Alert confirmation: "Archive [Group Name]? This will close the group and remove it from discovery. This cannot be undone." — Cancel + Archive (destructive).
  2. On confirm: call `mobileApi.archiveGroup(groupId)`.
  3. On success: `router.replace("/(tabs)/groups")` with toast "Group archived."
  4. On error: show Alert with the error message.

**Acceptance criteria:**
- MEMBER and ADMIN viewers see Leave action (confirm sheet → calls API → navigates to groups tab on success).
- OWNER viewer does NOT see Leave; sees Transfer Ownership and Archive Group in kebab.
- Leave on a group where the user is the OWNER is blocked at the API level (409) and does not navigate away.
- Archive shows a destructive confirmation; on confirm, group disappears from My Groups list.
- Transfer navigates to the members screen with `mode=transfer` param.

---

### S57-T5 (HIGH) — Mobile: Transfer Ownership picker on members screen

**Files:** `apps/mobile/src/app/group/[id]/members.tsx`.

**What to build:**

When the members screen receives `query.mode === "transfer"` (via `useLocalSearchParams`), render a "Transfer Ownership" mode banner at the top:

```
Banner: "Select a member to transfer ownership to"
  [Cancel button — clears mode param, returns to normal view]
```

In transfer mode:
- Each non-OWNER member row shows a "Make Owner" primary button instead of the regular kebab.
- Banned members are excluded from the list (same query filter already in place for the members list).
- Tapping "Make Owner" on a row:
  1. Alert confirmation: "Transfer ownership to @[username]? You will become an admin." — Cancel + Transfer (style default, not destructive — this is a deliberate action, not a danger).
  2. On confirm: call `mobileApi.transferOwnership(groupId, { newOwnerId: targetUserId })`.
  3. On success: `router.replace(`/group/${groupId}`)` with toast "Ownership transferred to @[username]." The group detail will reload and the caller's `memberStatus` will now be `admin`.
  4. On error `ineligible_target`: show Alert "This member cannot receive ownership."
  5. On error: show Alert with message.

Normal mode (no `mode` param): members screen is unchanged from S54/S56.

**Edge case — sole owner with no eligible transfer candidates:**
If the members list in transfer mode is empty (owner is the only non-banned member), show an empty state: "No eligible members to transfer to. Archive the group instead." with a button "Archive Group" that calls `handleArchive` logic (or navigates back to group profile and opens the archive action).

**Acceptance criteria:**
- Members screen in transfer mode shows the banner and "Make Owner" buttons.
- Confirm flow calls transfer route, on success navigates to group detail as admin.
- Empty state renders when there are no eligible transfer candidates.
- Normal mode (no `mode` param) is unchanged — no regressions.
- Non-OWNER users landing on the members screen with `mode=transfer` should see normal mode (no banner) — the mode param is only acted on when `memberStatus === "owner"`.

---

## Open questions for CTO — answer before writing code

1. **Outgoing owner role after transfer:** Drops to `ADMIN` (not `MEMBER`). Rationale: they stewarded the group; admin power lets them do cleanup (remove markets, manage members) without retaining reserved owner actions. CTO can override to `MEMBER` but must update the API response and mobile toast copy accordingly. Record the decision as a comment in the transaction.

2. **Archive: preserve or delete memberships?** Recommendation confirmed above: preserve all rows. `isArchived = true` on `Group` is the sole tombstone flag. Hard deleting memberships would cascade-break market relations (markets have `groupId` foreign keys) and any future group analytics. Frontend filters via `isArchived`.

3. **Archive reversibility in v1:** Not reversible. Archive is a decisive close. S58 can add a simple `isArchived = false` flip if product demands it.

4. **Audit trail for ownership transfer:** Nothing in S57. S58's `GroupModerationAction` table absorbs this. Add the `// TODO S58` comment inline.

5. **Push notification on leave:** OUT for S57. An owner doesn't need a real-time alert that a member they had no power to stop from leaving is gone. Notification preferences aren't per-group yet, so any fan-out would be noisy. Defer to S58 or later.

---

## Risk callouts

- **OWNER invariant is load-bearing.** Every role-check in ban, approve/reject, member management, and the coming moderation audit relies on exactly one `OWNER` existing per group. The transfer transaction MUST be atomic (`prisma.$transaction`) — flip both roles in the same transaction or neither. If the transaction half-completes, the group has either zero or two owners and all moderation routes break silently.
- **Banned candidate on transfer.** T2 must reject if `newOwner.bannedAt != null`. A banned user promoted to OWNER would bypass the entire moderation model. Check explicitly before the transaction.
- **Self-transfer guard.** Reject `newOwnerId === callerId` with 400 before any DB write. Simple but must be present.
- **Leave is a hard delete, not a soft flag.** There is no `leftAt` field today. Verify the T1 route does a `prisma.groupMembership.delete(...)` not an update. A membership row that still exists post-leave would let the user appear as a member in the members list.
- **Discover + getUserGroups already filter `isArchived: false` — confirmed.** The group detail route (`GET /api/groups/[id]`) is UNVERIFIED as of this brief. CTO must check this in T3 and patch it if the guard is absent. An archived group reachable via deep link would create an inconsistent UX (group appears gone in lists but loads on direct nav).
- **Race condition: two owners?** If the current owner calls transfer and the group somehow ends up in an inconsistent state between the role flip, the `$transaction` rollback prevents persistence of the bad state. No distributed-lock needed here — Postgres transaction isolation is sufficient.
- **`prisma generate` reminder.** Even with no migration, if any type additions are needed for the new routes, run `prisma generate` to ensure the Prisma client is up to date. Flag if a migration is unavoidably needed — it must be T0 before all other tickets.

---

## Explicitly out of scope for S57

- `unarchive` route — S58 if product demands it.
- Push notification on member leave — S58 with per-group notification preferences.
- `GroupModerationAction` audit table — S58 (originally queued here; pushed to make room for self-service).
- Ownership transfer audit log — absorbed into S58's audit table.
- Cover image upload pipeline — S58.
- Per-group notification preferences — S58.
- Category landing pages, unified search, featured-flag curation — S58.
- Group activity feed — S58.
- Bulk approve/reject in the Approval Inbox — S58.
- Re-request cooldown after rejection — S58 if abuse is observed.
- "Delete group" flow — not in roadmap for v1. Archive is the terminal state.

---

## S57 Success Criteria (CEO will verify)

After QA pass, the CEO will verify:
1. An ADMIN or MEMBER of a group can tap Leave, confirm the sheet, and is removed from the group — the group no longer appears in their My Groups list.
2. The Leave button is NOT visible to the group OWNER.
3. A group OWNER can tap Transfer Ownership in the kebab → navigate to the members picker → select a member → confirm → they are now ADMIN and the selected user is OWNER (visible in the member list).
4. A group OWNER with no other members sees the "No eligible members" empty state in the transfer picker and an Archive Group button.
5. A group OWNER can tap Archive Group, confirm the sheet, and the group disappears from My Groups and from the discover feed.
6. `GET /api/groups/:id` on an archived group returns 404 (not a live group detail page).
7. `POST /api/groups/:id/leave` called by the OWNER returns 409 `owner_must_transfer_or_archive`.
8. `POST /api/groups/:id/transfer-ownership` with a banned `newOwnerId` returns 400 `ineligible_target`.
9. Transfer transaction atomicity: after success, `Group.ownerId`, old owner's `GroupMembership.role`, and new owner's `GroupMembership.role` are all in the correct state — verified together, not assumed from a single field check.

---

## S58 Theme Brief

Discovery polish and community depth (originally queued as S57 before self-service pre-empted it). Per-group notification preferences — required before any OPEN or REQUEST_TO_JOIN group with large membership ships safe fan-out. Cover image upload pipeline (signed-URL flow consistent with user avatars). Category landing pages from the Groups Discover screen. Unified search across markets, groups, and instruments. Featured groups section (admin-curated `isFeatured` flag on Group). `GroupModerationAction` audit table replacing the `bannedAt` tombstone from S54, absorbing the ownership transfer log from S57. Group activity feed (reverse-chronological events inside the group profile). Bulk approve/reject in the Approval Inbox. `unarchive` route if product demands it. Re-request cooldown after rejection.
