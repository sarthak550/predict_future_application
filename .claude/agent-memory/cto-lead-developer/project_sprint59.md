---
name: project_sprint59
description: S59 Group Engagement Unlock — audit table, server notif defaults, group market push, bulk approve/reject, featured flag — all 6 tickets qa-review
metadata:
  type: project
---

S59 completed all 6 tickets in one pass.

**T0 — Schema migration (single):**
- New enum `GroupModerationActionType` (8 values)
- New model `GroupModerationAction` with `@@index([groupId, createdAt])` + `@@index([actorId])`
- `User.defaultGroupNotificationLevel GroupNotifLevel @default(ALL)` added
- `Group.isFeatured Boolean @default(false)` added
- `AdminActionType.FEATURE_GROUP` added to enum
- Migration: `20260607000005_s59_group_moderation_audit_user_notif_default_featured` (hand-written SQL, shadow DB shim issue persists)
- `npx prisma generate` ran clean

**T1 — Audit helper + 8-route backfill:**
- Helper: `apps/api/lib/groups/group-moderation-audit.ts` — exports `logModerationAction` + re-exports `GroupModerationActionType`
- All calls are fire-and-forget (`void fn().catch(console.error)`)
- 8 routes updated: ban, unban, members/[userId], leave, transfer-ownership, archive, approve, reject
- `metadata` typed as `Prisma.InputJsonValue` to satisfy Prisma's Json nullable type

**T2 — Server-authoritative notif defaults:**
- New route: `apps/api/app/api/users/me/notification-defaults/route.ts` (GET + PATCH)
- `defaultGroupNotificationLevel` added to `profile/me` response select + JSON
- `ApiUserNotificationDefaults` type added to packages/types
- `getUserNotificationDefaults()` + `updateUserNotificationDefaults()` added to api-client
- Mobile profile.tsx: AsyncStorage→server one-way migration on data load; onChange now calls PATCH endpoint

**T3 — Group market push:**
- `notifyGroupMembersOfNewMarket` added to `apps/api/lib/groups/group-request-push.ts`
- INVITE_ONLY guard fires before any DB query beyond group fetch
- MENTIONS_ONLY treated as ALL (same pattern as S58)
- Call site in `apps/api/app/api/markets/route.ts` POST — fire-and-forget after market create

**T4 — Bulk approve/reject:**
- `apps/api/app/api/groups/[id]/join-requests/bulk-approve/route.ts` — POST, cap 50, per-row try/catch
- `apps/api/app/api/groups/[id]/join-requests/bulk-reject/route.ts` — POST, cap 50, optional batch note
- Response shape: `{ results: Array<{ requestId, success, error? }> }`
- Mobile requests.tsx fully rewritten with long-press multi-select, checkbox rows, footer action bar
- `GroupRequestEventName` and `GroupRequestEventProps` in analytics.ts extended for bulk events

**T5 — Featured flag:**
- `apps/api/app/api/admin/groups/[id]/feature/route.ts` — POST, ADMIN/MODERATOR role gate
- discover/route.ts: sort now `[isFeatured DESC, memberships._count DESC, id ASC]`
- Cursor v2 format: `{ v: 2, isFeatured: boolean, memberCount: number, id: string }` — v1 cursors treated as fresh-start
- `ApiDiscoverGroup.isFeatured: boolean` added to types
- CommunitiesList + CommunitiesRail: "Featured" yellow pill badge rendered when `g.isFeatured`

**Why:** line: S59 is the sprint where groups stop being infrastructure and start being a product — audit trail, push engagement, operator QoL (bulk approve), editorial control (featured).

**How to apply:** Cursor versioning decision: old v1 cursors (no `v` field) are silently dropped on the members sort, causing a fresh-start. This is safe — pagination resets gracefully. Document as known behavior if mobile clients report "pagination resets on app update".
