---
name: project_sprint54
description: S54 Open Groups foundation — schema, moderation, discover, profile, tab un-hide, member management, create flow (all 8 tickets COMPLETE)
metadata:
  type: project
---

## Sprint 54 — Open Groups: Community Structure

**Status:** All 8 tickets implemented. TypeScript clean. Ready for QA.

### Schema changes (T1)
- `GroupVisibility` enum added: `INVITE_ONLY | OPEN` (S55 adds `REQUEST_TO_JOIN`)
- `Group` model new fields: `visibility @default(INVITE_ONLY)`, `category MarketCategory?`, `memberCap Int @default(10000)`, `coverImageUrl String?`
- `GroupMembership` new fields: `bannedAt DateTime?`, `banReason String?` (ban tombstone pattern)
- Index: `@@index([visibility, createdAt])` on Group
- Migration: `20260607000002_s54_open_groups/migration.sql` — applied via `prisma migrate deploy`

### Key decisions
1. **Ban tombstone on GroupMembership** (not a separate table) — lightweight for S54. S56 gets `GroupModerationAction` audit table. Inline `// TODO S56` comment present.
2. **getDiscoverGroups stub kept but marked deprecated** — it was unreferenced by any route handler. Replaced with a visibility=OPEN filter; the actual discover logic lives in `GET /api/groups/discover`.
3. **Cover image upload deferred** — `coverImageUrl String?` field exists; mobile create form does NOT show upload button. Admin/seed-set only in S54.
4. **joinGroupByInviteCode ban check** — patched in T2 (moderation theme). Banned users cannot bypass via old invite codes.

### New API routes
- `GET /api/groups/discover` — public, no-auth-required, OPEN groups only, cursor pagination
- `POST /api/groups/:id/join` — OPEN group direct join; 403 for INVITE_ONLY, 409 for banned/full
- `DELETE /api/groups/:id/members/:userId` — remove member (OWNER/ADMIN only)
- `POST /api/groups/:id/ban` — ban user tombstone upsert (OWNER/ADMIN only)
- `POST /api/groups/:id/unban` — clear ban tombstone (OWNER/ADMIN only)
- `GET /api/groups/:id/members` — paginated member list (includes banned rows for admin view)

### Modified API
- `apps/api/lib/groups/service.ts` — `createGroupTx` accepts visibility/category/coverImageUrl; defaults new groups to OPEN; `joinGroupByInviteCode` checks bannedAt
- `apps/api/app/api/groups/create/route.ts` — passes new fields through
- `packages/validation/src/group.ts` — `createGroupSchema` extended with visibility/category/coverImageUrl

### New mobile screens
- `apps/mobile/src/app/group/[id].tsx` — full rewrite: cover banner, join CTA state machine (owner/admin/member/banned/none), description collapsible, recent markets, member preview, sticky CTA bar
- `apps/mobile/src/app/group/[id]/members.tsx` — paginated member list, kebab actions (remove/ban/unban), ban tombstone display, iOS ActionSheet + Android Alert fallback

### Modified mobile
- `apps/mobile/src/app/(tabs)/_layout.tsx` — Groups tab un-hidden (href: null removed, `people-outline` icon added)
- `apps/mobile/src/app/(tabs)/groups.tsx` — full rewrite: category filter chips, sort selector, discover group cards with inline Join, My Groups section below, join-by-code input
- `apps/mobile/src/app/(tabs)/create.tsx` — group create form gains visibility toggle (Open/Invite-only) + category chip picker

### New api-client methods
- `joinOpenGroup(groupId)`, `discoverGroups(query?)`, `getGroupMembers(groupId, query?)`, `removeGroupMember(groupId, userId)`, `banGroupMember(groupId, body)`, `unbanGroupMember(groupId, body)`
- `createGroup` signature extended with visibility/category/coverImageUrl

### Types added
- `AppGroupVisibility`, `AppGroupRole`, `ApiDiscoverGroup`, `ApiDiscoverGroupsResponse`, `ApiGroupMember` in `packages/types/src/index.ts`
- `ApiGroupSummary` extended with role/visibility/category/coverImageUrl/memberCount/marketCount
- `ApiGroupDetail` fully typed (was `Record<string, unknown>`)

**Why:** Feed-first IA locks brand in-feed; this sprint closes WS3 (no viral loop), WS6 (groups hidden), WS8 (thin engagement) from 2026-06-07 audit.
