---
name: cto-assignment-brief-sprint59
description: S59 CTO brief — Group engagement unlock: audit table, user notif default migration, group market push, bulk approve/reject, featured flag
metadata:
  type: project
---

# CTO Assignment Brief — Sprint 59

**Issued:** 2026-06-07
**Sprint theme:** Group Engagement Unlock + Operator Tooling
**Scope decision:** Option B (schema + push + bulk + featured; defer category landing pages to S60)

---

## Scope Call

Option B. Featured flag is a boolean + one admin route + one sort tweak — it ships in an afternoon and gives us immediate editorial control over the discover rail the day groups go public. Bulk approve/reject closes a real operator pain gap that will surface the moment any moderately popular community opens: 50 requests piling up one-tap-at-a-time is a support ticket waiting to happen. Both items fit within S59 without threatening the critical-path items. Category landing pages involve IA decisions about URL structure, filter composition, and whether categories get their own navigation surface — those decisions deserve a dedicated sprint scope conversation, not a tacked-on ticket.

---

## Sprint Thesis

S59 makes OPEN groups feel alive. S54–S58 built the pipes; S59 turns on the water. Group market push is the engagement unlock that means when a market is created in a group, its members actually know. The audit table replaces the `bannedAt` tombstone pattern with a proper history surface that makes every future moderation UI possible. User notification defaults migrate from volatile AsyncStorage to the server so they survive reinstall. Bulk approve/reject and the featured flag are the operator QoL and editorial control that let platform admins run these communities without going crazy. S59 is the sprint where groups stop being infrastructure and start being a product.

---

## Schema Context (verified against schema.prisma)

- `Group` model has: `visibility`, `category`, `memberCap`, `coverImageUrl`, `isArchived`. No `isFeatured` field yet.
- `GroupMembership` has `bannedAt` tombstone pattern with a TODO comment ("migrate to dedicated GroupBan table with full audit trail").
- `User` model has `GroupNotificationPreference` relation but NO `defaultGroupNotificationLevel` field yet.
- `GroupNotifLevel` enum is already defined: `ALL | MENTIONS_ONLY | NONE`.
- `AdminAction` model exists at platform level (actor, targetUser, type, notes, metadata). The new `GroupModerationAction` is group-scoped — separate model, not an extension of AdminAction.
- `Role` enum: `USER | ADMIN | MODERATOR` — confirms platform ADMIN/MODERATOR check is available for the featured route.
- `Story` model already has `isFeatured: Boolean @default(false)` — mirror this exact pattern on `Group`.
- `AdminActionType` enum: contains `FEATURE_MARKET` and `FEATURE_STORY` — add `FEATURE_GROUP` here (single enum-only migration, no new table).

---

## T0 — Schema Migration: GroupModerationAction + User.defaultGroupNotificationLevel + Group.isFeatured

**Priority:** Critical (all other tickets depend on this)

### Acceptance criteria

1. Add model to schema.prisma:

```prisma
model GroupModerationAction {
  id             String                    @id @default(cuid())
  groupId        String
  actorId        String
  targetUserId   String?
  actionType     GroupModerationActionType
  metadata       Json?
  createdAt      DateTime                  @default(now())

  group          Group   @relation(fields: [groupId], references: [id], onDelete: Cascade)
  actor          User    @relation("ModerationActor", fields: [actorId], references: [id], onDelete: Cascade)
  targetUser     User?   @relation("ModerationTarget", fields: [targetUserId], references: [id])

  @@index([groupId, createdAt])
  @@index([actorId])
}

enum GroupModerationActionType {
  MEMBER_BANNED
  MEMBER_UNBANNED
  MEMBER_REMOVED
  MEMBER_LEFT
  OWNERSHIP_TRANSFERRED
  GROUP_ARCHIVED
  JOIN_REQUEST_APPROVED
  JOIN_REQUEST_REJECTED
}
```

2. Add `defaultGroupNotificationLevel GroupNotifLevel @default(ALL)` field to `User` model.

3. Add `isFeatured Boolean @default(false)` field to `Group` model.

4. Add `GroupModerationAction` to AdminActionType enum: `FEATURE_GROUP`.

5. Add back-relations to `User` model:
   - `moderationActionsAsActor   GroupModerationAction[] @relation("ModerationActor")`
   - `moderationActionsAsTarget  GroupModerationAction[] @relation("ModerationTarget")`

6. Add back-relation to `Group` model:
   - `moderationActions GroupModerationAction[]`

7. Run `prisma migrate dev --name s59_group_moderation_audit_user_notif_default_featured`.

8. Run `npx prisma generate` immediately after migration. Do not proceed to T1 until generate completes without error.

**Important:** This is a single migration covering all three schema changes. Splitting them would violate the serialize_schema_writes constraint.

---

## T1 — Audit Table Write Helper + Route Backfill

**Priority:** Critical

### Acceptance criteria

1. Create `apps/api/lib/groups/group-moderation-audit.ts` that exports a single fire-and-forget helper:
   ```ts
   export async function logModerationAction(params: {
     groupId: string;
     actorId: string;
     targetUserId?: string;
     actionType: GroupModerationActionType;
     metadata?: Record<string, unknown>;
   }): Promise<void>
   ```
   Wraps `prisma.groupModerationAction.create`. Swallows errors — never throws. Always fire-and-forget from callers via `void logModerationAction(...).catch(console.error)`.

2. Backfill the following routes with a `logModerationAction` call immediately after their primary DB write succeeds. Every call is fire-and-forget — do NOT add it inside the transaction.

   | Route file | actionType | targetUserId |
   |---|---|---|
   | `groups/[id]/ban/route.ts` | `MEMBER_BANNED` | banned userId |
   | `groups/[id]/unban/route.ts` | `MEMBER_UNBANNED` | unbanned userId |
   | `groups/[id]/members/[userId]/route.ts` (DELETE/remove) | `MEMBER_REMOVED` | removed userId |
   | `groups/[id]/leave/route.ts` | `MEMBER_LEFT` | leaving userId (actorId = targetUserId) |
   | `groups/[id]/transfer-ownership/route.ts` | `OWNERSHIP_TRANSFERRED` | new owner userId; metadata: `{ previousOwnerId }` |
   | `groups/[id]/archive/route.ts` | `GROUP_ARCHIVED` | null |
   | `groups/[id]/join-request/[requestId]/approve/route.ts` | `JOIN_REQUEST_APPROVED` | requester userId |
   | `groups/[id]/join-request/[requestId]/reject/route.ts` | `JOIN_REQUEST_REJECTED` | requester userId |

3. Unit-test the helper: verify it does not throw when prisma throws.

---

## T2 — User.defaultGroupNotificationLevel Migration (Server-Authoritative)

**Priority:** High

### Mobile changes (`apps/mobile/src/app/(tabs)/profile.tsx`)

Migration logic on profile screen mount:

1. On mount (after `data` loads from `useApiQuery`), read `data.user.defaultGroupNotificationLevel` from the API response.
2. If the server value is `"ALL"` (the schema default), check AsyncStorage key `@groups_notif_default`.
3. If AsyncStorage has a non-`"ALL"` value (`"MENTIONS_ONLY"` or `"NONE"`), call `PATCH /api/users/me/notification-defaults` with `{ defaultGroupNotificationLevel: storedValue }` to migrate it server-side. Then delete the AsyncStorage key.
4. From that point forward, always read `defaultGroupNotificationLevel` from the API response, not AsyncStorage.
5. When the user changes the setting in the UI, call the PATCH endpoint first; update local state on success. Remove all AsyncStorage writes for this field.

Migration is one-way and runs once per device (AsyncStorage key deletion is the idempotency gate).

### API changes

1. Expose `defaultGroupNotificationLevel` in `GET /api/users/me` response (add to the profile select).
2. Create `PATCH /api/users/me/notification-defaults` route:
   - Body: `{ defaultGroupNotificationLevel: GroupNotifLevel }`
   - Validates enum value; returns 400 on invalid.
   - Updates `User.defaultGroupNotificationLevel` via `prisma.user.update`.
   - Returns `{ defaultGroupNotificationLevel }`.

### Types package

Add `defaultGroupNotificationLevel: GroupNotifLevel` to `ApiMyProfile` type.

---

## T3 — Group Market Created Push Fan-out

**Priority:** Critical

### Context

`apps/api/lib/groups/group-request-push.ts` already has two helpers with established pref-gating patterns. T3 adds a third. The market creation entry point is `apps/api/app/api/markets/route.ts` (create/POST handler) — confirmed: `create/route.ts` is a re-export of that route.

### New helper in `group-request-push.ts`

```ts
export async function notifyGroupMembersOfNewMarket({
  groupId,
  marketId,
  marketTitle,
  creatorId,
}: {
  groupId: string;
  marketId: string;
  marketTitle: string;
  creatorId: string;
}): Promise<void>
```

Implementation rules:
1. Fetch the group. If not found, return.
2. If `group.visibility === "INVITE_ONLY"`, return immediately — no fan-out for private groups.
3. Fetch all active memberships (bannedAt null), select userId + expoPushToken.
4. Exclude the creator (`userId !== creatorId`).
5. Query `GroupNotificationPreference` for all member userIds in this group. Build a suppressed set (level = NONE). Filter tokens — only send to members with level ALL or no row (default ALL). MENTIONS_ONLY is treated as ALL here (no @-mention targeting yet).
6. If the resulting token list is empty, return.
7. Push payload: title `"New market in {group.name}"`, body `"{marketTitle}"`, data `{ href: "/market/{marketId}", marketId, groupId }`.
8. Chunk via existing `sendPushMessages` helper.

### Call site

In `apps/api/app/api/markets/route.ts` POST handler, after the market row is successfully created:
```ts
if (createdMarket.groupId) {
  void notifyGroupMembersOfNewMarket({
    groupId: createdMarket.groupId,
    marketId: createdMarket.id,
    marketTitle: createdMarket.title,
    creatorId: createdMarket.creatorId,
  }).catch((err) => console.error("[market-create] group push error:", err));
}
```

Fire-and-forget. Never blocks the create response.

---

## T4 — Bulk Approve/Reject

**Priority:** High

### New API endpoints

**POST `/api/groups/[id]/join-requests/bulk-approve`**
- Body: `{ requestIds: string[] }` — max 50 IDs, validated with 400 on overflow.
- Auth: OWNER or ADMIN of the group (same role check as single approve).
- Per-row logic: for each requestId, run the same approve logic as the single route (member cap check, APPROVED status update, GroupMembership create, logModerationAction). Per-row try/catch — a single bad ID (not found, already rejected, cap hit) logs a failure entry in the response but does not abort the rest.
- Response: `{ results: Array<{ requestId, success: boolean, error?: string }> }`.
- Push notifications: fire-and-forget `notifyRequesterOfDecision` for each successfully approved request.

**POST `/api/groups/[id]/join-requests/bulk-reject`**
- Body: `{ requestIds: string[], note?: string }` — max 50 IDs.
- Same structure as bulk-approve. Per-row: update status to REJECTED, set decidedAt/decidedById, logModerationAction. Fire-and-forget push for each.
- Response: `{ results: Array<{ requestId, success: boolean, error?: string }> }`.

**Important:** Each approval runs its own member-cap check. The cap can be reached mid-batch — subsequent approvals in the same batch will return `member_cap_reached` error for their row.

### Mobile changes

In the approval inbox screen (`groups/[id]/requests` or equivalent):
1. Add a multi-select mode toggle (long-press to enter, checkboxes on each row).
2. When 1+ rows are selected, show a footer action bar with "Approve All" and "Reject All" buttons.
3. Cap selection display at 50 with a visible counter.
4. On action, call bulk endpoint, show a success/partial-success toast.

---

## T5 — Featured Flag: Group Curation

**Priority:** Medium

### Schema (already in T0)

`Group.isFeatured Boolean @default(false)`

### API

**POST `/api/admin/groups/[id]/feature`**
- Body: `{ featured: boolean }`
- Auth: platform ADMIN or MODERATOR role check (same pattern as S57's group detail route: `viewer.role === "ADMIN" || viewer.role === "MODERATOR"`).
- Updates `Group.isFeatured` via `prisma.group.update`.
- Returns `{ isFeatured: boolean }`.

**Discover sort update** (`apps/api/app/api/groups/discover/route.ts`):
- When `sort === "members"` (default), prepend `{ isFeatured: "desc" }` to the orderBy: `[{ isFeatured: "desc" }, { memberships: { _count: "desc" } }, { id: "asc" }]`.
- Add `isFeatured: true` to the select block.
- Add `isFeatured` to the response shape.

**Cursor consideration:** the featured-first sort means the cursor for "members" needs to include `isFeatured` as the leading key. Update cursor encoding: `{ isFeatured: boolean, memberCount: number, id: string }` and the cursorWhere condition accordingly.

### Mobile

- Add `isFeatured` to the group card response type in `@predict-future/types`.
- In the discover/browse group card component, render a small star badge ("Featured") on cards where `isFeatured === true`. Mirror the `isFeatured` treatment from Story cards if a pattern already exists.

---

## Open Questions (resolved inline)

1. **Platform ADMIN/MODERATOR check for feature route**: Confirmed — `viewer.role === "ADMIN" || viewer.role === "MODERATOR"` pattern per S57's group detail route. Use this.

2. **Audit table backfill of historical bans**: Forward-only. Historical `bannedAt` rows stay on `GroupMembership`. New actions post-S59 write to `GroupModerationAction`. Both surfaces coexist. No backfill migration needed.

3. **User default migration trigger (profile mount vs app launch)**: Profile screen mount. Lazy migration — no startup latency, user is authenticated at that point, and profile screen is a natural place where settings surface. One-time, idempotency gated by AsyncStorage key deletion.

---

## Risk Callouts

- **Audit route checklist**: Eight routes need the `logModerationAction` call. Missing one is easy. CTO must cross-check against this list: ban, unban, members/[userId] (remove), leave, transfer-ownership, archive, approve, reject. QA should grep for `logModerationAction` calls and verify count = 8.
- **Group market push — INVITE_ONLY guard**: The helper must return early for INVITE_ONLY groups before any DB query beyond the group fetch. Verify the call site check is `createdMarket.groupId != null` (already set for GROUP-scoped markets) and the helper correctly gates on visibility.
- **Bulk approve — mid-batch member cap**: If the group cap is 100 and 80 are pending, approving all 80 at once will hit cap partway through. Per-row cap check handles this correctly — the first N approvals succeed, the rest return `member_cap_reached`. QA should test this case explicitly.
- **Bulk approve — poisoned batch**: A single bad requestId (wrong group, already rejected) must not abort the other 49. Per-row try/catch is non-negotiable.
- **Featured sort cursor**: The cursor format for the `members` sort changes in T5 (adds `isFeatured` as leading key). Mobile must send the new cursor format or pagination breaks silently. QA should test paginating the discover feed after featured groups are set.
- **Audit table TTL**: Not addressed in S59. Table grows with every ban/approve/reject/leave in every group. Flag for S60 archival policy if volume warrants.

---

## Ticket Summary

| Ticket | Priority | Area |
|---|---|---|
| T0 — Schema migration (GroupModerationAction + User.defaultGroupNotificationLevel + Group.isFeatured) | Critical | API / DB |
| T1 — Audit write helper + 8-route backfill | Critical | API |
| T2 — User notif default: server migration + PATCH route + mobile migration logic | High | API + Mobile |
| T3 — Group market created push fan-out | Critical | API + Mobile |
| T4 — Bulk approve/reject endpoints + mobile multi-select inbox | High | API + Mobile |
| T5 — Featured flag: admin route + discover sort + mobile badge | Medium | API + Mobile |

---

## S60 Carry-over

Category landing pages (tap category chip in Explore → filtered groups + markets screen) — new screen, new endpoint, IA decisions about URL/navigation structure. Audit table archival/TTL policy if volume is a concern. Any S59 edge cases that QA surfaces on bulk approve or featured sort cursor.
