---
name: cto-assignment-brief-sprint58
description: Sprint 58 — Notification prefs (production blocker) + cover image upload pipeline. S54-S57 community story closes; S58 is production-readiness. Issued 2026-06-07.
metadata:
  type: project
---

## Sprint 58 — Group Notification Preferences + Cover Image Upload

**Issued:** 2026-06-07
**Theme:** Production readiness for OPEN groups. S54-S57 built the full community story (visibility tiers, moderation, self-service). S58 unlocks production: notification preferences prevent a 10k-member group market from nuking every member's phone, and cover images give groups the visual identity that makes the spotlight and discover surfaces worth showing to real users.

---

## Scope Call: Option B — Balanced S58

**Decision: Option B (notification prefs + cover image upload). Items #3 (audit table) and #4 (featured flag) defer to S59.**

Reasoning: Item #1 is non-negotiable. Item #2 is the right complement — cover images are the single highest-leverage visual unlock and their absence means the discover/spotlight surfaces we built in S55 look like a placeholder product. Adding #3 and #4 would require TWO schema migrations in one sprint plus a full admin surface, violating the serialize-schema-writes constraint and overloading the sprint. The audit table and featured flag are ops polish, not user blockers. They belong together in S59.

---

## Sprint Thesis

S58 is the two-part key that actually unlocks OPEN groups for production use. Notification preferences are the safety valve — without them, a single market post in a 10k-member group would be a user-hostile spam event. Cover image upload is the brand surface — without it, every group in the discover feed is a generic letter avatar and the community identity story we built across S54-S57 has no visual payoff. Ship both or we can't confidently hand OPEN groups to real users.

---

## Pre-conditions (CTO must verify before writing code)

1. `Group.coverImageUrl String?` — already present in schema (added in S54 as a seed-only field). No migration needed for the field itself.
2. `User.expoPushToken String?` — present. This is the only push targeting field on User.
3. No `GroupNotificationPreference` model exists in schema. Needs new model + migration.
4. No notification preference field of any kind exists on `Group` or `GroupMembership`. Confirmed by schema read.
5. No storage dependency (`@vercel/blob`, S3 SDK, R2) exists in `apps/api/package.json`. Cover image upload is a net-new pipeline — there is no avatar upload pattern to reuse. CTO must introduce `@vercel/blob` (Vercel-native, no new external account needed since this is a Vercel-hosted project).
6. `User.avatarUrl` is a plain string set via seed/admin direct DB write — there is no existing signed-URL or upload route in the codebase. Do not try to find or reuse one; build fresh.
7. Push call sites that need pref-gating after S58: `apps/api/app/api/groups/[id]/join-request/route.ts`, `apps/api/app/api/groups/[id]/join-request/[requestId]/approve/route.ts`, `apps/api/app/api/groups/[id]/join-request/[requestId]/reject/route.ts`. The big-call cron and flagship-reminder are global (not group-scoped) and do NOT need group pref gating.
8. `apps/api/lib/groups/group-request-push.ts` — the S56 push helper. The pref check must be added inside the helper functions, not at the call sites (keeps logic centralized).
9. Schema migration constraint: S58 needs exactly ONE migration. The `GroupNotificationPreference` model is the only schema change. `Group.coverImageUrl` already exists. Do not add the `GroupModerationAction` table in this sprint.

---

## Tickets

### S58-T0 (CRITICAL) — Schema: GroupNotificationPreference model + migration

**Files:** `apps/api/prisma/schema.prisma`, new migration in `apps/api/prisma/migrations/`.

**What to build:**

Add new model and enum to `schema.prisma`:

```prisma
enum GroupNotifLevel {
  ALL
  MENTIONS_ONLY
  NONE
}

model GroupNotificationPreference {
  id        String           @id @default(cuid())
  groupId   String
  userId    String
  level     GroupNotifLevel  @default(ALL)
  updatedAt DateTime         @updatedAt

  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
  @@index([userId])
}
```

Add the inverse relations on `Group` and `User`:
- `Group`: `notificationPreferences GroupNotificationPreference[]`
- `User`: `groupNotificationPreferences GroupNotificationPreference[]`

Run `prisma migrate dev --name s58_group_notification_preference`.

**No backfill.** Absence of a row = default ALL (handled in query layer, not via seeded rows).

**Acceptance criteria:**
- Migration runs cleanly on local and prod.
- `prisma generate` produces a `GroupNotificationPreference` client type.
- No other schema changes in this migration.

---

### S58-T1 (CRITICAL) — API: Notification pref read/write endpoints

**Files:** New `apps/api/app/api/groups/[id]/notification-preference/route.ts`, new service function in `apps/api/lib/groups/service.ts`.

**What to build:**

`GET /api/groups/:id/notification-preference`
- Auth required. Caller must be a member of the group (non-banned GroupMembership row).
- If a `GroupNotificationPreference` row exists for `(groupId, callerId)`, return `{ level: row.level }`.
- If no row exists, return `{ level: "ALL" }` (the implicit default — do not create a row on read).
- Non-member or non-existent group: return 404.

`PATCH /api/groups/:id/notification-preference`
- Auth required. Caller must be a member of the group.
- Body: `{ level: "ALL" | "MENTIONS_ONLY" | "NONE" }`.
- Validate the enum value; 400 on invalid input.
- Upsert the `GroupNotificationPreference` row (create if absent, update if present).
- Return `{ level: newLevel }`.
- Non-member: 404. Archived group: 404.

**Service layer:** Add `getGroupNotifPref(groupId, userId)` and `setGroupNotifPref(groupId, userId, level)` to `apps/api/lib/groups/service.ts`.

**Acceptance criteria:**
- GET with no pref row returns `{ level: "ALL" }` without creating a DB row.
- PATCH upserts correctly; second PATCH overwrites the first.
- Invalid level value returns 400.
- Non-member caller returns 404 on both GET and PATCH.

---

### S58-T2 (CRITICAL) — Enforce notification prefs in push helpers

**Files:** `apps/api/lib/groups/group-request-push.ts`.

**What to build:**

Both push functions in `group-request-push.ts` need pref-gating:

**`notifyOwnersAndAdminsOfNewRequest`** — currently fans out to all OWNER+ADMIN members. Add pref check:

```ts
// After fetching memberships with push tokens, fetch pref rows for those users:
const prefRows = await prisma.groupNotificationPreference.findMany({
  where: {
    groupId,
    userId: { in: adminUserIds },
    level: "NONE",
  },
  select: { userId: true },
});
const suppressedUserIds = new Set(prefRows.map(r => r.userId));
// Filter out suppressed users before building message list:
const tokens = memberships
  .filter(m => !suppressedUserIds.has(m.userId))
  .map(m => m.user.expoPushToken)
  .filter(Boolean);
```

Note: `MENTIONS_ONLY` falls through to ALL for request notifications (owners/admins need these). Only `NONE` suppresses.

**`notifyRequesterOfDecision`** — single-user. Add pref check before sending:

```ts
const pref = await prisma.groupNotificationPreference.findUnique({
  where: { groupId_userId: { groupId, userId } },
  select: { level: true },
});
if (pref?.level === "NONE") return; // user opted out of all group notifications
```

**Future group market push (TODO marker):** There is no market-creation push for groups yet (the S54 TODO-S56 marker). When that push is added, it MUST also gate on GroupNotifLevel before fan-out. CTO adds this comment in `group-request-push.ts`:

```ts
// TODO S58+: any new group-scoped push (e.g., group market created) must query
// GroupNotificationPreference and filter to level ALL before fan-out.
// Never push to 10k OPEN group members without pref gating.
```

**Acceptance criteria:**
- User with level NONE receives no push for new join requests (if they are OWNER/ADMIN).
- User with level NONE receives no push for their join request decision.
- User with level ALL or no row receives push normally.
- User with level MENTIONS_ONLY receives owner/admin request alerts (treated as ALL for these notification types).

---

### S58-T3 (HIGH) — Mobile: Per-group notification setting on group profile

**Files:** `apps/mobile/src/app/group/[id].tsx`, `packages/api-client/src/index.ts`.

**What to build:**

**API client additions:**
```ts
getGroupNotifPref(groupId: string): Promise<{ level: "ALL" | "MENTIONS_ONLY" | "NONE" }>
setGroupNotifPref(groupId: string, body: { level: "ALL" | "MENTIONS_ONLY" | "NONE" }): Promise<{ level: "ALL" | "MENTIONS_ONLY" | "NONE" }>
```

**Group profile screen:**

When the viewer is a member of the group (any role), add a "Notifications" row to the settings/gear area (or wherever the group metadata is displayed — check the existing layout). The row should show:
- Label: "Notifications"
- Current value: pill showing "All", "Mentions Only", or "Off"
- Tap behavior: opens an `ActionSheet` with three options: "All activity", "Mentions only", "Off" — plus a Cancel.

On selection, call `mobileApi.setGroupNotifPref(groupId, { level })` and update local state optimistically. Show a brief toast on success. On error, revert and show an Alert.

**State management:** Fetch the current pref level when the group profile mounts (alongside the existing group detail fetch). Store in local state. Update on ActionSheet confirm.

**Render condition:** Only show the Notifications row when `memberStatus` is "member", "admin", or "owner" (i.e., the user is an active member). Never show to non-members or guests.

**Acceptance criteria:**
- Notifications row visible to members, hidden to non-members.
- Tapping the row opens a three-option action sheet.
- Selecting "Off" calls the PATCH endpoint and updates the displayed pill.
- Optimistic update reverts on API error.
- Pref persists across app restarts (re-fetched on mount from API).

---

### S58-T4 (HIGH) — Mobile: Global Groups notification default in app Settings

**Files:** `apps/mobile/src/app/(tabs)/settings.tsx` or wherever global app settings live — CTO must locate the settings screen.

**What to build:**

Add a "Groups" section to the app Settings screen. Inside, add a single toggle/row:
- Label: "Group notifications default"
- Subtext: "Applies to groups you join after changing this setting."
- Options: "All activity" / "Mentions only" / "Off" (same three options as T3)
- This is a LOCAL preference stored in `AsyncStorage` keyed `@groups_notif_default`.

**Behavior:** This setting does NOT retroactively update existing `GroupNotificationPreference` rows. It is read by the "Join Group" flow (OPEN join path and approve-join path) to set the initial pref on new group memberships. Specifically: when a user joins a group (via any route — direct join or approval), after the membership row is created, call `PATCH /api/groups/:id/notification-preference` with the user's stored default if it is not `ALL` (ALL is the server default, so no write needed for ALL).

**Acceptance criteria:**
- Settings screen shows Group notifications section.
- Default reads from AsyncStorage on mount.
- Changing the default updates AsyncStorage.
- When a user joins a group and their stored default is NONE or MENTIONS_ONLY, the PATCH endpoint is called with that level immediately after successful join.

---

### S58-T5 (HIGH) — API: Cover image upload endpoint (Vercel Blob)

**Files:** New `apps/api/app/api/groups/[id]/cover-image/route.ts`. Install `@vercel/blob` as a dependency.

**What to build:**

Install: `pnpm add @vercel/blob` in `apps/api`.

`POST /api/groups/:id/cover-image`
- Auth required. Caller must be OWNER or ADMIN of the group.
- This is a signed URL flow. The client does NOT upload the file directly to this route. Instead:
  1. Client calls this route with `Content-Type: application/json`, body `{ filename: string, contentType: string }`.
  2. Server validates: caller is OWNER/ADMIN, group exists and is not archived, `contentType` is one of `image/jpeg | image/png | image/webp`, `filename` is non-empty.
  3. Server generates a client-upload token using `@vercel/blob`'s `generateClientTokenFromReadWriteToken`:
     ```ts
     import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
     const token = await generateClientTokenFromReadWriteToken({
       token: process.env.BLOB_READ_WRITE_TOKEN!,
       pathname: `groups/${groupId}/cover.${ext}`,
       maximumSizeInBytes: 5 * 1024 * 1024, // 5MB hard cap
       allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
       validUntil: Date.now() + 60_000, // 60s window
     });
     ```
  4. Return `{ clientToken, url }` — the client uses the clientToken to upload directly to Vercel Blob, then calls the PATCH route with the resulting URL.

`PATCH /api/groups/:id/cover-image`
- Auth required. Caller must be OWNER or ADMIN.
- Body: `{ coverImageUrl: string }`.
- Validate that `coverImageUrl` is a valid Vercel Blob URL (starts with `https://*.public.blob.vercel-storage.com/`). Return 400 if not.
- Update `Group.coverImageUrl` in the DB.
- Return `{ coverImageUrl }`.

**Environment variable:** `BLOB_READ_WRITE_TOKEN` must be present. CTO must add it to `.env.example` and verify it is configured in Vercel project settings. This is the only new env var for S58.

**Image processing:** OUT for v1. Store as-is. No resize, no thumbnail variant. The client uploads whatever the user picked (capped at 5MB).

**Acceptance criteria:**
- POST returns a client token for valid callers; 403 for non-owners/admins.
- PATCH updates `Group.coverImageUrl` when given a valid Blob URL.
- PATCH returns 400 for non-Blob URLs (security: prevents arbitrary URL injection).
- 5MB cap enforced via the `maximumSizeInBytes` param in the token generation (Vercel Blob enforces server-side on upload).
- Archived or non-existent group returns 404.

---

### S58-T6 (HIGH) — Mobile: Cover image upload UX on group create + edit

**Files:** `apps/mobile/src/app/group/create.tsx` (or equivalent create flow), `apps/mobile/src/app/group/[id]/edit.tsx` (or equivalent edit screen), `packages/api-client/src/index.ts`.

**What to build:**

CTO must first locate the exact group create and edit screens. Based on S54/S55 brief, the create flow was wired in S54-T7. The edit flow likely lives adjacent.

**API client additions:**
```ts
getGroupCoverImageUploadToken(groupId: string, body: { filename: string; contentType: string }): Promise<{ clientToken: string; url: string }>
updateGroupCoverImage(groupId: string, body: { coverImageUrl: string }): Promise<{ coverImageUrl: string }>
```

**Edit screen cover image picker:**

Add an image picker area at the top of the group edit screen (and as an optional step in the create flow):
- Display: if `group.coverImageUrl` exists, show the cover image as a full-width banner (similar to how group profiles display it). Otherwise show a placeholder "Add cover photo" tap target.
- Tap behavior: use `expo-image-picker` (already in the mobile project — CTO verify) to open the photo library. Request permission if not granted.
- After user picks an image:
  1. Read the selected asset URI and content type.
  2. Show a loading state on the cover area.
  3. Call `mobileApi.getGroupCoverImageUploadToken(groupId, { filename, contentType })`.
  4. Upload the file directly to Vercel Blob using the returned `clientToken` (use `@vercel/blob/client`'s `upload()` function with the client token). Size limit is enforced by Vercel server-side, but also check on client: if the asset `fileSize > 5 * 1024 * 1024`, show Alert "Image too large. Please choose an image under 5MB." and abort before uploading.
  5. On upload success, call `mobileApi.updateGroupCoverImage(groupId, { coverImageUrl })`.
  6. Update local state; display the new cover.
  7. On any error: show Alert "Failed to upload cover image. Please try again." and revert to previous state.

**Create flow:** Cover image is optional. Add a "Cover photo (optional)" tappable area in the create form. The flow is: user fills out form and picks cover → on submit, first create the group, then immediately upload the cover using the newly created group's id. If the upload fails silently after successful group creation, that is acceptable — the group exists without a cover. Do not block group creation on cover upload.

**Mobile crop:** OUT for v1. User uploads the full selected image. Add a comment: `// TODO v2: add crop/resize step before upload`.

**Acceptance criteria:**
- Tapping "Add cover photo" on the edit screen opens the image picker.
- After selection, the cover uploads and the updated image displays without a full screen reload.
- Images over 5MB show a client-side Alert and do not attempt upload.
- Cover photo picker is present and optional in the create flow.
- Group profile screen (`group/[id].tsx`) already renders `coverImageUrl` as a header banner — verify this is wired (it should be from S54/S55). If not, wire it in this ticket.

---

### S58-T7 (MEDIUM) — API client + types: export new endpoints

**Files:** `packages/api-client/src/index.ts`, `packages/types/src/index.ts`.

**What to build:**

Ensure all new types from S58 are exported from `packages/types`:
```ts
export type GroupNotifLevel = "ALL" | "MENTIONS_ONLY" | "NONE";
export interface GroupNotifPref { level: GroupNotifLevel }
```

Verify all six new API client methods from T1/T3/T5/T6 are present and typed correctly in `packages/api-client/src/index.ts`.

**Acceptance criteria:**
- `packages/types` exports `GroupNotifLevel` and `GroupNotifPref`.
- All new API client methods are present with correct TypeScript return types.
- `pnpm typecheck` passes across all packages.

---

## Open Questions for CTO — Answer Before Writing Code

1. **`@vercel/blob` availability:** Does the Vercel project have a Blob store provisioned? The `BLOB_READ_WRITE_TOKEN` env var must be present in Vercel project settings. If not provisioned, CTO must provision it via Vercel dashboard before T5 can run in production. This is a one-time setup step.

2. **`expo-image-picker` presence:** Verify `expo-image-picker` is already installed in `apps/mobile/package.json`. If not, add it (`expo install expo-image-picker`). Check if iOS `NSPhotoLibraryUsageDescription` is already set in `app.json` / `app.config.ts`. If not, add it or the picker will crash on iOS.

3. **`@vercel/blob` client-side in mobile:** The mobile app will need to call the Vercel Blob upload endpoint directly using the client token. Use `@vercel/blob/client`'s `upload()` function — this works from a React Native context via HTTP, but CTO should verify there are no platform-specific fetch issues. If `@vercel/blob/client` doesn't bundle cleanly for React Native, fall back to a raw multipart `fetch` to the Blob upload URL included in the client token response.

4. **Group edit screen location:** S54-T7 built the create flow. Does an edit screen exist? Check `apps/mobile/src/app/group/[id]/edit.tsx` or nearby. If the edit screen doesn't exist yet, T6 should create a minimal one (name + description + cover image) rather than assuming it exists.

5. **`MENTIONS_ONLY` enum value:** Currently defined but has no distinct behavior in S58 (it falls through to ALL for request-type notifications, same as ALL for any future market push). CTO should document this with a comment in `group-request-push.ts`: `// MENTIONS_ONLY: treated as ALL until @-mention notifications are implemented.`

6. **`GroupNotificationPreference` and the `GroupMembership.bannedAt` tombstone:** When a user is banned (bannedAt set, membership preserved), should their pref row be deleted? Recommendation: no. The pref row is inert while the user is banned (they receive no pushes because the push helper already filters `bannedAt: null`). Clean-up on ban is out of scope for S58.

---

## Risk Callouts

1. **Push call site audit is load-bearing.** The pref check in T2 must gate ALL group-scoped push paths — not just the two helpers in `group-request-push.ts`. CTO must grep for `expoPushToken` in all group-related API routes and confirm none have inline push logic that bypasses the helper. The current audit shows 3 files in the join-request flow; all use the helper. The leaderboard route and admin market approve route also reference `expoPushToken` but are not group-scoped — no gating needed there.

2. **Vercel Blob is a new dependency and env var.** If `BLOB_READ_WRITE_TOKEN` is absent in any environment (local dev, preview, production), T5 will throw at runtime. CTO must add a startup check: `if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is required")` in the upload route, not a silent `undefined`.

3. **5MB client-side check is advisory; the Vercel Blob server-side cap is the real gate.** Expo image picker returns asset `fileSize` which may be null for some iOS assets. If null, skip the client-side check and let the server enforce. Document this in the code.

4. **One migration, one sprint.** S58's single migration is `GroupNotificationPreference`. Do NOT add `GroupModerationAction` or any other model in the same migration — that table goes in S59. The serialize-schema-writes constraint is in force.

5. **Cover image URL injection attack surface.** The PATCH `cover-image` endpoint validates that `coverImageUrl` starts with the Vercel Blob hostname. This is a security check, not a nicety. Without it, any string can be written to `Group.coverImageUrl` including tracker URLs or malicious redirects. The validation must be present.

6. **Vercel Blob pricing.** The free tier includes 5GB storage and 10GB bandwidth. Group cover images at ~500KB average and typical early growth are well within free tier. Not a concern for v1.

---

## Explicitly Out of Scope for S58

- `GroupModerationAction` audit table — S59.
- Featured flag curation (`Group.isFeatured` + admin route) — S59.
- Bulk approve/reject — S59.
- Category landing pages — S59.
- Unified search — S59.
- `unarchive` route — S59 if product demands.
- Image thumbnail variants / server-side resize — v2.
- Mobile cover crop UI — v2.
- Group activity feed — S59+.
- Push notification for group market creation — next sprint after S58 (the TODO marker in T2 flags this explicitly).

---

## S59 Theme Brief

Ops depth and editorial control. `GroupModerationAction` audit table replacing the `bannedAt` tombstone from S54, absorbing the S57 ownership-transfer log. Featured flag on Group (`isFeatured Boolean @default(false)`) with admin-only web route and sorting consideration in discover. Bulk approve/reject in the Approval Inbox. Unarchive route if product demands it. Begin scoping category landing pages (tap category chip → grouped results screen). Group market creation push notification (gated on S58 notification prefs). Group activity feed (reverse-chronological event log inside group profile).

---

## S58 Success Criteria (CEO will verify)

After QA pass, the CEO will verify:

1. A member of a 10k-member OPEN group can set their notification preference to "Off" — verify the pref row is written and the push helper skips them.
2. A user with level NONE as OWNER/ADMIN does NOT receive a push when someone submits a join request to their group.
3. A user with level ALL receives the join request push normally.
4. `GET /api/groups/:id/notification-preference` with no existing row returns `{ level: "ALL" }` without creating a DB row.
5. A group OWNER can upload a cover image from the edit screen — it uploads, the `Group.coverImageUrl` is updated, and the group profile header displays the new image.
6. Uploading an image over 5MB shows a client-side Alert and does not attempt the upload.
7. `PATCH /api/groups/:id/cover-image` with a non-Blob URL returns 400.
8. The global Groups notification default in app Settings updates AsyncStorage and is applied when a user joins a new group with a non-ALL default.
9. `pnpm typecheck` passes across all packages after S58 ships.
