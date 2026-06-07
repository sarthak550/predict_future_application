---
name: cto-assignment-brief-sprint54
description: Sprint 54 — Open Groups (Pillar B) — visibility model, discovery, moderation, group profile page. Issued 2026-06-07.
metadata:
  type: project
---

## Sprint 54 — Open Groups: Community Structure for Pillar B

**Issued:** 2026-06-07
**Theme:** Community structure for Pillar B. Invite-only groups have a hard social-graph cap — they spread only as fast as the owner texts people. Open discovery removes that cap, creates persistent return reasons (your group's leaderboard, your group's markets), and gives the product a community layer that Manifold and Polymarket cannot easily replicate because they operate global feeds, not community structures. This sprint closes WS3 (no viral loop), WS6 (groups hidden), and WS8 (thin engagement loops) from the 2026-06-07 weak-spot audit.

**Pillar clarity:** This sprint is entirely Pillar B (prediction markets, all categories, production-first). User accuracy in open groups is NOT pooled with the Analyst Scorecard leaderboard in Pillar A. Keep the pillars segregated in every data surface.

---

## Pre-conditions (CTO must verify before writing code)

1. Schema: `Group` model currently has `id`, `slug`, `name`, `description`, `ownerId`, `inviteCode`, `isArchived`, `createdAt`, `updatedAt`. No visibility, category, memberCap, or coverImageUrl fields.
2. `GroupMembership` has `role: GroupRole (OWNER | ADMIN | MEMBER)`. No ban fields.
3. Service: `joinGroupByInviteCode` in `apps/api/lib/groups/service.ts` exists and uses a `$transaction`. A stub `joinGroupById` also exists (no visibility branching). A `getDiscoverGroups` stub exists but does NOT filter by visibility (field doesn't exist yet — it must be added in T1 before T3 can use it).
4. Mobile `groups.tsx` tab is invite-code-only. The tab is hidden via `href: null` in `(tabs)/_layout.tsx:101`.
5. `MarketCategory` enum (not `AppMarketCategory`) is the correct enum to reference for group category — values: GENERAL, SPORTS, BUSINESS, TECH, WEATHER, ENTERTAINMENT, PRODUCT, COMPANY, FINANCE.

---

## Tickets

### S54-T1 (CRITICAL) — Schema: add visibility, category, memberCap, coverImageUrl to Group

**Files:** `apps/api/prisma/schema.prisma`, new migration file.

**What to build:**
1. Add `GroupVisibility` enum to schema:
   ```
   enum GroupVisibility {
     INVITE_ONLY
     OPEN
   }
   ```
   Note: `REQUEST_TO_JOIN` is intentionally absent. It ships in Sprint 55.

2. Add fields to `model Group`:
   ```
   visibility    GroupVisibility @default(INVITE_ONLY)
   category      MarketCategory?
   memberCap     Int             @default(10000)
   coverImageUrl String?
   ```

3. Migration behavior:
   - Existing groups: `INVITE_ONLY` default — preserves existing behavior safely.
   - New groups created via `createGroup` service (S54-T4 updates this): default `OPEN`.

4. Add database index: `@@index([visibility, createdAt])` on `Group` to support the discover query.

5. This is the ONLY ticket that touches `schema.prisma`. CTO must run this migration before any other ticket writes service or route code against the new fields.

**Acceptance criteria:**
- `prisma generate` and `prisma migrate dev` succeed.
- `GroupVisibility` enum exists in generated Prisma client.
- Existing group rows have `visibility = INVITE_ONLY` after migration.
- New index `group_visibility_created_at` is present in the database.

---

### S54-T2 (CRITICAL) — Moderation routes: remove-member, ban, unban

**Files:** New routes under `apps/api/app/api/groups/[id]/members/[userId]/route.ts`, new `apps/api/app/api/groups/[id]/ban/route.ts`.

**Schema decision for CTO:** Model bans using `bannedAt: DateTime?` + `banReason: String?` on `GroupMembership` and treat `bannedAt != null` as a tombstone. This avoids a new table in S54. A full `GroupModerationAction` audit table can be added in S56 when we have activity feeds. CTO should document this choice inline.

**Additional schema changes** (add to `GroupMembership` model — coordinate with T1 migration if running same sprint; CTO should add these fields to the T1 migration file):
```
bannedAt   DateTime?
banReason  String?
```

**Routes to build:**

1. `DELETE /api/groups/:id/members/:userId`
   - Auth required.
   - Verify caller has `role = OWNER` or `role = ADMIN` in this group.
   - Cannot remove the OWNER (return 400: "Cannot remove the group owner.").
   - Deletes the `GroupMembership` row for `userId`. Does not ban.
   - Returns 204.

2. `POST /api/groups/:id/ban`
   - Body: `{ userId: string, reason?: string }`.
   - Auth required. Caller must be OWNER or ADMIN.
   - Cannot ban the OWNER.
   - Sets `bannedAt = now()`, `banReason = reason` on the target's `GroupMembership` row. If no membership row exists (user was never a member), create a tombstone row with `role = MEMBER`, `bannedAt = now()` so they can't join later.
   - Returns 200 + `{ banned: true }`.

3. `POST /api/groups/:id/unban`
   - Body: `{ userId: string }`.
   - Auth required. Caller must be OWNER or ADMIN.
   - Sets `bannedAt = null`, `banReason = null`.
   - Returns 200 + `{ banned: false }`.

**Acceptance criteria:**
- A non-member calling remove/ban returns 403.
- An ADMIN calling remove on OWNER returns 400.
- A banned user cannot re-join via any join route (T3 must check `bannedAt`).
- All three routes return appropriate 4xx on missing group.

---

### S54-T3 (CRITICAL) — API: GET /api/groups/discover + POST /api/groups/:id/join

**Files:** New `apps/api/app/api/groups/discover/route.ts`, new `apps/api/app/api/groups/[id]/join/route.ts`, update `apps/api/lib/groups/service.ts`.

**GET /api/groups/discover**
- Public endpoint (no auth required to browse, but auth is optional — if authed, exclude groups the user is already in).
- Query params: `category?: MarketCategory`, `sort?: "members" | "recent" | "new"` (default: `"members"`), `cursor?: string` (for pagination), `limit?: number` (default 20, max 50).
- Only returns groups where `visibility = OPEN` and `isArchived = false`.
- Sort behavior: `members` = ORDER BY `_count.memberships DESC`, `recent` = ORDER BY `updatedAt DESC`, `new` = ORDER BY `createdAt DESC`.
- Response shape:
  ```json
  {
    "groups": [
      {
        "id": "...",
        "slug": "...",
        "name": "...",
        "description": "...",
        "category": "FINANCE | null",
        "memberCount": 42,
        "coverImageUrl": "... | null",
        "ownerUsername": "...",
        "recentMarketCount": 5
      }
    ],
    "nextCursor": "... | null"
  }
  ```
- `recentMarketCount` = count of markets in this group created in last 30 days.
- Use cursor-based pagination on `(memberCount DESC, id)` for `members` sort; adjust cursor scheme for other sorts.

**POST /api/groups/:id/join**
- Auth required.
- Fetches group by `id`.
- If `visibility = INVITE_ONLY`: return 403 `{ error: "This group requires an invite code." }`.
- If caller has `bannedAt != null` in this group: return 409 `{ error: "You have been removed from this group." }`.
- If caller is already a member: return 200 with existing membership (idempotent).
- If `memberCount >= memberCap`: return 409 `{ error: "This group is full." }`.
- Creates `GroupMembership` row. Returns 200 + `{ group: { ...fields } }`.

**Update `getDiscoverGroups` service function** to filter by `visibility = OPEN` and accept the new query params. The existing stub does not filter by visibility — it must be updated before this route is safe.

**Acceptance criteria:**
- `GET /api/groups/discover` returns empty array (not 500) when no OPEN groups exist.
- `POST /api/groups/:id/join` on an INVITE_ONLY group returns 403 with the correct message.
- Banned user gets 409, not a 500.
- Pagination: calling with the returned `nextCursor` yields the next page with no duplicates.

---

### S54-T4 (HIGH) — Update createGroup service: default new groups to OPEN

**Files:** `apps/api/lib/groups/service.ts`, `apps/api/app/api/groups/create/route.ts`, validation schema for group creation.

**What to build:**
1. Update `createGroupTx` to accept optional `visibility: GroupVisibility` and `category: MarketCategory | null` and `coverImageUrl: string | null`. Default `visibility = OPEN` for all new groups created after this migration.
2. Update `createGroupSchema` (wherever it lives) to accept optional `visibility` (enum: `"INVITE_ONLY" | "OPEN"`), `category` (nullable enum), `coverImageUrl` (nullable string).
3. Update the `POST /api/groups/create` route handler to pass these new fields through.

**Note on existing join route:** The existing `POST /api/groups/join` (invite-code path) remains unchanged for INVITE_ONLY groups. The new `POST /api/groups/:id/join` (T3) handles OPEN groups. Do NOT merge or delete the invite-code join path — legacy INVITE_ONLY groups depend on it.

**Acceptance criteria:**
- Creating a group without specifying `visibility` defaults to `OPEN`.
- Creating a group with `visibility: "INVITE_ONLY"` respects that value.
- Existing `createGroup` tests (if any) pass.

---

### S54-T5 (HIGH) — Group profile screen (real, not stub)

**Files:** `apps/mobile/src/app/group/[id].tsx` (create or rewrite if stub exists).

**What to build:** A real group profile page. Required sections:

1. **Header** (above the scroll fold):
   - Cover image (if `coverImageUrl` set, render as a full-width banner ~180px tall; fallback to a gradient using the group's category color).
   - Group name (large, bold).
   - Category pill (e.g. "Finance", "Cricket") — omit if null.
   - Member count badge + market count badge.
   - Visibility badge: "Open" (green pill) or "Invite only" (grey pill).

2. **Join CTA** (sticky bottom bar, visible to non-members):
   - If `OPEN` and user is not a member: "Join Group" primary button — calls `POST /api/groups/:id/join`.
   - If `INVITE_ONLY` and user is not a member: "Invite only" disabled button + "Enter invite code" ghost button below it.
   - If user is already a member: no CTA bar; show "Member" chip in header instead.
   - If user is OWNER or ADMIN: no CTA bar; show role chip.

3. **Description** section (collapsible if > 3 lines).

4. **Recent Markets** list: last 10 markets in this group, ordered by `createdAt DESC`. Each row: market title, category pill, resolution status badge, vote count. Tap → navigate to `/market/[id]`.

5. **Member list preview** (first 5 members, "See all N members" link → navigates to S54-T7 member screen).

6. **Owner/Admin actions menu** (only rendered if viewer is OWNER or ADMIN):
   - "Edit Group" (stub — navigate to a settings screen, out of scope for S54 to fully build).
   - "Manage Members" (navigates to T7).

**Acceptance criteria:**
- Group profile loads without error for OPEN and INVITE_ONLY groups.
- Non-member sees Join CTA for OPEN groups; tapping Join adds them and updates the CTA to "Member".
- Member count updates after successful join (no full-page refresh needed — optimistic update).
- Recent markets list is empty-state safe.

---

### S54-T6 (HIGH) — Groups tab: un-hide + Browse Discovery screen

**Files:** `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/app/(tabs)/groups.tsx`.

**Part A — Un-hide the Groups tab:**
Remove `href: null` from the Groups tab entry in `_layout.tsx`. Tab label: "Groups" (not "Communities" — keep it literal for v1; rebrand to Communities is a S56 copy decision). Tab icon: `people-outline`.

**Part B — Rewrite `groups.tsx` to be a two-section screen:**

Section 1 — "Browse Groups" (discovery, top of screen):
- Category filter chips (horizontal ScrollView, no wrap): All | Finance | Sports | Business | Tech | Crypto | Entertainment. "All" is default selected.
- Sort selector: Members (default) | Recent | New. Small segmented control or dropdown.
- Grid or list of group cards (list preferred for v1). Each card:
  - Cover image thumbnail (40×40 rounded, fallback gradient).
  - Group name + category pill.
  - Member count + recent market count.
  - "Join" button (or "Joined" if already a member). Tapping "Join" calls `POST /api/groups/:id/join` inline without navigating; on success updates the button state.
  - Tap on the card body navigates to group profile (T5).
- Empty state when no OPEN groups match the selected filter: "No groups in [category] yet — create one!"
- Pull-to-refresh.
- Infinite scroll / "Load more" button when `nextCursor` is returned.

Section 2 — "My Groups" (existing behavior, moved below discovery):
- Retain the existing My Groups list with member count + market count.
- Retain the invite-code join input (for INVITE_ONLY groups).
- "Create Group" button remains in the header.

**Note on tab name:** `CRYPTO` is not a value in the `MarketCategory` enum — use `BUSINESS` or `FINANCE` filter chip for crypto-adjacent content. Do not add a CRYPTO enum value in this sprint.

**Acceptance criteria:**
- Groups tab is visible in the tab bar.
- Browse section shows OPEN groups sorted by member count by default.
- Category filter correctly restricts results to the selected category.
- Switching between "Browse" and "My Groups" sections is instant (no loading state on switch — My Groups is already loaded).
- Empty state renders instead of a blank screen.

---

### S54-T7 (MEDIUM) — Member management screen

**Files:** New `apps/mobile/src/app/group/[id]/members.tsx` (or `apps/mobile/src/app/group-members/[id].tsx`).

**What to build:**
- Full member list for a group, paginated (20 per page). Each row: avatar placeholder + username + role badge (Owner, Admin, Member) + join date.
- For OWNER or ADMIN viewers: each member row (except OWNER) has a kebab menu icon. Tapping opens an action sheet with:
  - "Remove from group" → calls `DELETE /api/groups/:id/members/:userId` → removes row from list.
  - "Ban user" → shows a brief input prompt for optional reason → calls `POST /api/groups/:id/ban` → removes row from list.
- For MEMBER viewers: read-only list (no kebab).
- Empty state if somehow the group has no members.
- Navigate here from T5 group profile "See all members" link.

**Acceptance criteria:**
- Owner can remove a member and the row disappears without a full reload.
- Owner sees themselves with OWNER badge and no kebab menu on their own row.
- Admin can remove/ban members but cannot remove the owner (server returns 400; surface a toast error).

---

### S54-T8 (MEDIUM) — Group create flow: add visibility + category pickers

**Files:** `apps/mobile/src/app/(tabs)/create.tsx` or wherever the group creation flow lives in mobile.

**What to build:**
Update the group creation form to include:
1. **Visibility picker:** Two-option toggle: "Open (anyone can join)" vs "Invite only". Default: Open. Show a brief explainer: "Open groups appear in search and anyone can join. Invite-only groups are hidden — share the code with people you want in."
2. **Category picker:** Dropdown or segmented chips. Optional. Options match `MarketCategory` enum values shown as human-readable labels. Default: none selected.

Pass the selected `visibility` and `category` values through to `POST /api/groups/create`.

**Acceptance criteria:**
- New group defaults to Open visibility.
- Selecting Invite-only and creating the group results in `visibility = INVITE_ONLY` on the server.
- Category is optional — omitting it creates a group with `category = null`.
- Form validation: name required (existing), visibility required (default handles this).

---

## Open questions for CTO — answer before writing code

1. **`joinGroupByInviteCode` refactor scope:** The existing invite-code join path in `apps/api/lib/groups/service.ts` does NOT check `bannedAt` (field doesn't exist yet). After T1 migration adds `bannedAt`, the invite-code path also needs a ban check. CTO should patch `joinGroupByInviteCode` to check `bannedAt != null` and throw "You have been removed from this group." — otherwise banned users can bypass moderation by entering the invite code. Flag if this should be a T2 sub-task or a separate T3 sub-task.

2. **Ban tombstone when user was never a member:** If an OWNER wants to preemptively ban a user (e.g., known bad actor who hasn't joined yet), T2 creates a `GroupMembership` tombstone row with `bannedAt` set. This violates the conceptual assumption that `GroupMembership` means the user is/was a member. Acceptable for S54 (lightweight), but CTO should leave a `// TODO S56: migrate to GroupBan table` comment inline. Confirm this tradeoff is understood.

3. **Cover image upload pipeline:** `User.avatarUrl` is set somewhere in the codebase. Does the same upload pipeline exist that could be reused for `Group.coverImageUrl`? If yes, note the route. If no upload pipeline exists at all, the `coverImageUrl` field in S54 is set only by seed/admin — the mobile UI should not show an upload button in the create form this sprint.

4. **`getDiscoverGroups` existing stub:** The service already has a `getDiscoverGroups` function that does NOT filter by visibility. T3 updates this function. CTO must ensure the existing stub is fully replaced — do not leave both versions (the stub returns all non-archived groups including INVITE_ONLY ones, which would be a privacy leak if the discover route consumed it without filtering).

5. **Tab name — "Groups" vs "Communities":** Locked to "Groups" for S54. If the user wants to rename to "Communities" in S56, it is a 5-minute copy change. Do not over-engineer.

---

## Risk callouts

- **Moderation is non-negotiable for S54.** The first OPEN group will attract off-topic or abusive posts within 24 hours of launch. T2 (ban/remove) must ship in the same release as T6 (tab un-hide). Do not release T6 without T2.
- **Notification fan-out is an unresolved scale risk.** When a large OPEN group (potentially thousands of members) has a new market created, the current notification system has no per-group mute or opt-out. Do NOT add group market creation to the notification fan-out in this sprint. Leave a comment in the market creation service: `// TODO S56: per-group notification preferences before fan-out is safe at scale`.
- **Group profile (T5) is a real build.** It is not a stub or a renamed screen. It needs cover image fallback, Join CTA state machine (non-member / member / owner / admin / banned), description collapsible, recent markets list, and member preview. Budget accordingly.
- **Schema migration safety.** T1 adds 4 new nullable/defaulted columns. The migration is additive and non-destructive. No existing rows are altered except to receive the `INVITE_ONLY` default. Confirm `prisma migrate deploy` runs cleanly on the existing dataset before T3/T4/T5 go to QA.
- **No new SEBI surface.** Open groups are Pillar B only. The Group profile page does NOT surface analyst credibility scores, expert leaderboard rankings, or named sell-side firm data. Any group with `category = FINANCE` shows prediction market activity only — user accuracy scores, not analyst credibility tiers. The Pillar A / Pillar B segregation must not leak here.

---

## Explicitly out of scope for S54

- `REQUEST_TO_JOIN` visibility tier and approval inbox — Sprint 55 headline.
- Cover image upload UI (S54 uses URL-only field; admin/seed sets it) — Sprint 56.
- Per-group notification preferences — Sprint 56.
- Search groups by name — Sprint 56.
- Featured/trending groups (curated) — Sprint 56.
- Quality signals / per-group trust score — Sprint 56.
- Algorithmic group discovery — Sprint 56.
- `GroupModerationAction` audit table — Sprint 56.
- CRYPTO as a `MarketCategory` enum value — out of scope entirely until product decision.
- Naming squatting protection — Sprint 56 or later (slug uniqueness already enforced).

---

## S54 Success Criteria (CEO will verify)

After QA pass, the CEO will verify:
1. Groups tab is visible in the tab bar.
2. Browse section shows at least one OPEN group (seeded for QA).
3. A logged-out user can load `/api/groups/discover` without a 401.
4. A logged-in user can join an OPEN group via the Join button on the browse card.
5. The group profile page for an OPEN group shows member count, description, and recent markets.
6. The group owner can remove a member from the member management screen.
7. A banned user attempting `POST /api/groups/:id/join` receives a 409.
8. Creating a new group defaults to OPEN visibility and appears in the discover feed.

---

## S55 Theme Brief

Sprint 55 headline: Request-to-Join. Add `REQUEST_TO_JOIN` as the third value in the `GroupVisibility` enum. When a user taps "Request to Join" on an RTJ group, a `GroupJoinRequest` record is created (new schema model: `requesterId`, `groupId`, `status: PENDING | APPROVED | DENIED`, `createdAt`). Group owners and admins get a new "Requests" inbox tab on the group profile page listing pending requests with Approve / Deny actions. Approving creates a `GroupMembership` row and sends a push notification to the requester ("Your request to join [Group] was approved"). Denying sends a "not approved" push (optional — respect user sensitivity). The group browse card shows "Request to Join" CTA instead of "Join" for RTJ groups. The group create flow adds RTJ as a third visibility option with copy: "You approve every member before they join."

## S56 Theme Brief

Sprint 56 headline: Discovery polish and community depth. Cover image upload for groups (reuse or build a signed-URL upload pipeline consistent with user avatars). Category landing pages: a dedicated screen per category (Finance Groups, Sports Groups, etc.) accessible from the browse filter chips, showing the top groups in that category plus a "Create a [category] group" CTA. Search groups by name (a search bar on the browse screen, hitting a new `GET /api/groups/search?q=...` endpoint). Featured groups section (curated by admin — a simple `isFeatured: Boolean` field on Group, populated via admin panel). Per-group notification preferences: a member can mute all notifications from a specific group; required before any group-triggered push fan-out is safe at scale. A `GroupModerationAction` audit table replacing the `bannedAt` tombstone pattern from S54, giving owners a moderation log. Group activity feed: a reverse-chronological list of "new market added," "X joined," "market resolved" events inside the group profile.
