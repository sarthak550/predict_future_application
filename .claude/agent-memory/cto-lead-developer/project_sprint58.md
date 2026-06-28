---
name: project_sprint58
description: S58: Group notification preferences + cover image upload — schema, 3 API routes, 2 mobile surfaces, @vercel/blob
metadata:
  type: project
---

S58 ships in 8 tickets across schema, API, and mobile.

**T0 — Schema (COMPLETE)**
- New enum `GroupNotifLevel { ALL MENTIONS_ONLY NONE }` and model `GroupNotificationPreference` (id/groupId/userId/level/updatedAt/createdAt + @@unique([groupId,userId]) + @@index([userId]))
- Inverse relations on Group (notificationPreferences) and User (groupNotificationPreferences)
- Migration: `/apps/api/prisma/migrations/20260607000004_s58_group_notification_preference/migration.sql` — hand-written SQL (shadow DB shim issue recurred as in S54/S56)
- `npx prisma generate` ran successfully
- No backfill — absence of row = ALL (query layer default)

**T1 — Notification pref GET+PATCH routes (COMPLETE)**
- `/apps/api/app/api/groups/[id]/notification-preference/route.ts` — GET returns {level} (ALL if no row), PATCH upserts; 404 for non-members
- Service fns `getGroupNotifPref` + `setGroupNotifPref` added to `/apps/api/lib/groups/service.ts`

**T2 — Pref-gating in push helpers (COMPLETE)**
- `/apps/api/lib/groups/group-request-push.ts` updated: NONE suppresses; MENTIONS_ONLY treated as ALL for request-type notifications
- `notifyOwnersAndAdminsOfNewRequest`: batch suppression query for NONE users
- `notifyRequesterOfDecision`: single pref check before sending
- TODO S58+ comment placed for future group market push
- Push audit: all non-helper push calls (admin/approve, flagship-reminder, weekly-digest) are global, not group-scoped — no gating needed

**T3 — Per-group notification row on group profile (COMPLETE)**
- `/apps/mobile/src/app/group/[id].tsx`: Notifications row in header card (members only), 3-option ActionSheet, optimistic update + revert on error
- "Edit Group" now routes to `/group/${groupId}/edit` (was "Coming soon")
- Imports: `GroupNotifLevel` from types, `useEffect` added

**T4 — Global default in profile Settings (COMPLETE)**
- `/apps/mobile/src/app/(tabs)/profile.tsx`: `GroupNotifDefaultCard` component with AsyncStorage key `@groups_notif_default`
- Applied on OPEN join: `handleJoin` reads stored default and calls `setGroupNotifPref` if != ALL
- Groups section in profile screen (above Actions card)

**T5 — Cover image upload endpoint (COMPLETE)**
- `/apps/api/app/api/groups/[id]/cover-image/route.ts`: POST (clientToken generation via `generateClientTokenFromReadWriteToken`), PATCH (URL validation + DB update)
- `@vercel/blob` v2.4.0 installed in apps/api
- `BLOB_READ_WRITE_TOKEN` added to `.env.example` with setup instructions
- Startup guard throws clearly if token is unset
- PATCH validates `BLOB_HOSTNAME_PATTERN = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//`

**T6 — Mobile cover image picker (COMPLETE)**
- `expo-image-picker` ~17.0.11 installed; `NSPhotoLibraryUsageDescription` added to `app.json` (infoPlist + plugin)
- `/apps/mobile/src/app/group/[id]/edit.tsx` CREATED (minimal: name + description + cover)
- Uses raw multipart fetch against Vercel Blob PUT API (not `@vercel/blob/client.upload()` — doesn't bundle in RN)
- Client-side 5MB guard skips when `fileSize == null` (iOS behavior)
- PATCH on `/api/groups/:id` added for name+description edits

**T7 — Types + api-client (COMPLETE)**
- `packages/types/src/index.ts`: `GroupNotifLevel`, `ApiGroupNotifPref`, `ApiGroupCoverImageToken`, `ApiGroupCoverImageUpdate`
- `packages/api-client/src/index.ts`: `getGroupNotifPref`, `setGroupNotifPref`, `getGroupCoverImageUploadToken`, `updateGroupCoverImage`, `updateGroup` (for edit screen)
- `pnpm typecheck` passes across all packages

**Open questions resolved:**
1. BLOB_READ_WRITE_TOKEN — not in .env; added to .env.example with guard
2. expo-image-picker — was NOT installed; installed as ~17.0.11
3. @vercel/blob RN compat — used raw multipart fetch (documented in edit.tsx)
4. Group edit screen — did NOT exist; created at apps/mobile/src/app/group/[id]/edit.tsx
5. iOS nullable fileSize — skip client-side check when null; server enforces

**Why:** S58 is the production safety valve for OPEN groups (prevents spam) + visual identity unlock (cover images for discover feed).
**How to apply:** T0 schema migration is idempotent; never backfill pref rows.
