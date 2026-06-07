---
name: cto-assignment-brief-sprint55
description: Sprint 55 — Explore tab (Markets renamed). Community spotlight, Communities rail, Hosted-by chip woven into existing markets screen. Groups tab re-hidden. Mobile-only, no schema changes.
metadata:
  type: project
---

## Sprint 55 — Explore: Markets Meets Communities

**Issued:** 2026-06-07
**Theme:** Markets becomes the discovery hub for both prediction markets and communities. Groups do not get a separate tab slot. Instead, the markets screen is promoted to "Explore" and woven with three community surfaces so that every user browsing markets organically encounters communities — and every group-hosted market becomes a discovery entry point for the group. 5-tab bar is restored: Feed · Finance · Create · Explore · Profile.

This sprint does NOT regress WS6 ("Groups hidden"). The original WS6 finding was "make groups discoverable," not "they must have a tab slot." The Hosted-by chip approach is strictly more discoverable than the standalone tab was: every market card in the feed now doubles as a community discovery touchpoint. Restate this framing in any PR description or QA notes so reviewers do not misread this as a rollback.

**Pillar:** Pillar B (prediction markets). No Pillar A analyst data surfaces in any new component.

---

## Pre-conditions (CTO must verify before writing code)

1. `_layout.tsx`: Groups tab is currently un-hidden (no `href: null`). S55-T1 re-adds `href: null`. Confirm line 98–106.
2. `ApiMarketSummary` in `packages/types/src/index.ts` does NOT have a `group` field (verified at type definition ~line 171). The markets list API response must be checked to see whether the Prisma query includes the `group` relation. CTO must grep the markets route and its service for `include: { group: true }` before building S55-T5. If the relation is absent from the response, it must be added to the select/include in the API handler and to `ApiMarketSummary` in the types package. This is the single most important pre-condition check.
3. `MarketSummaryCard` in `apps/mobile/src/components/market-summary-card.tsx` does NOT currently render any group chip (grep confirmed). The chip renders only conditionally (`item.group != null`) so adding the field is non-breaking.
4. The discover endpoint `GET /api/groups/discover?sort=members&limit=1` shipped in S54 and can be used as the spotlight data source without changes.
5. `/(tabs)/groups` route path must remain resolvable (the file stays, just hidden). Verify no in-app `router.push("/(tabs)/groups")` calls exist — grep found none. Onboarding copy check: `apps/mobile/src/components/onboarding-walkthrough.tsx:158` references `/(tabs)/markets` (not groups), so no copy update needed there.

---

## Tickets

### S55-T1 (CRITICAL) — Re-hide the Groups tab

**File:** `apps/mobile/src/app/(tabs)/_layout.tsx`

Re-add `href: null` to the Groups tab entry (lines 98–106). Do NOT delete the screen entry — just suppress it from the tab bar. The `groups.tsx` file and route remain navigable for deep links and any in-app `router.push("/(tabs)/groups")` calls that may exist or be added later.

**Acceptance criteria:**
- Tab bar shows exactly 5 tabs: Feed, Finance, Create, Explore (or Markets until T2 lands), Profile.
- Navigating programmatically to `/(tabs)/groups` still resolves without error.
- No visual regression on the other 5 tabs.

---

### S55-T2 (CRITICAL) — Rename Markets tab to "Explore"

**Files:** `apps/mobile/src/app/(tabs)/_layout.tsx`, and any copy that references the "Markets" tab label.

1. In `_layout.tsx`, update `title: "Markets"` to `title: "Explore"` on the markets screen entry. Tab icon: switch from `trending-up-outline` to `compass-outline` (better semantic fit for a discovery hub). If `compass-outline` is not available in the installed Ionicons version, fall back to `search-outline`.
2. Grep for every `/(tabs)/markets` `router.push` reference across mobile. The route PATH stays `/(tabs)/markets` — we are only renaming the label. But update any user-visible copy strings that say "go to Markets" to say "Explore":
   - `apps/mobile/src/app/(tabs)/profile.tsx:1602` — label string "Explore markets to bet on" (already says "Explore," CTO verify).
   - `apps/mobile/src/app/(tabs)/profile.tsx:584` — check surrounding copy.
   - `apps/mobile/src/components/finance-mode.tsx:2581` — check surrounding copy.
3. Analytics event names that reference `markets_tab_opened` or similar: **do NOT rename them.** Preserve historical comparability. Add a comment: `// analytics: "markets_tab_opened" — name preserved for historical comparability, tab is now labelled "Explore"`.

**Acceptance criteria:**
- Tab bar label reads "Explore."
- Icon is `compass-outline` (or fallback).
- Navigating to `/(tabs)/markets` still works — route path is unchanged.
- No in-app copy visible to users still says "Markets tab."

---

### S55-T3 (HIGH) — Community spotlight card component

**Files:** New `apps/mobile/src/components/community-spotlight-card.tsx`, `apps/mobile/src/app/(tabs)/markets.tsx`.

**Component spec — `CommunitySpotlightCard`:**
- Props: `group: ApiDiscoverGroup` (reuse the existing type from `packages/types`).
- Layout: full-width card (~200px tall). Cover image as background (full bleed, with a dark gradient overlay for text legibility) if `coverImageUrl` is set; fallback to a category-tinted gradient (reuse the same gradient palette used in the S54 group profile cover fallback).
- Over the image (bottom-left): group name (large, white, bold), member count ("N members," white, small), active markets count ("N active markets," white, small), teaser line (most recent market title from the `recentMarketCount` context — if the discover endpoint does not return the latest market title, use the description field instead; do not add a new API call to fetch it).
- CTA button (bottom-right of the card): "Join community" filled button. Tapping navigates to `/group/[id]` (the group profile screen from S54-T5). Do NOT inline the join action on this card — send the user to the profile where they can read context before joining.
- A subtle "Featured" label pill in the top-left corner.

**Data source:** Fetch `GET /api/groups/discover?sort=members&limit=1` independently from the markets list fetch. Do NOT bundle into a `Promise.all` with the markets fetch — independent `useApiQuery` or `useEffect` hooks. Pull-to-refresh on the Explore screen should refresh both independently.

**Placement in `markets.tsx`:** Render `CommunitySpotlightCard` as the first item in the `ListHeaderComponent` of the markets FlatList, above the existing category filter bar and sort controls. Skip rendering if the fetch returns an empty array or errors (degrade gracefully — no error state shown to the user for this slot).

**Acceptance criteria:**
- Spotlight card renders at the top of the Explore screen.
- Displays the highest-memberCount OPEN group.
- Tapping "Join community" navigates to the group profile page.
- If no OPEN groups exist (e.g. staging), the card is absent and the markets list renders normally.
- Cover image fallback gradient renders when `coverImageUrl` is null.

---

### S55-T4 (HIGH) — "Communities you might like" horizontal rail

**Files:** New `apps/mobile/src/components/communities-rail.tsx`, `apps/mobile/src/app/(tabs)/markets.tsx`.

**Component spec — `CommunitiesRail`:**
- A horizontally scrollable row (`ScrollView horizontal showsHorizontalScrollIndicator={false}`).
- Fetches `GET /api/groups/discover?sort=members&limit=8` independently. Same independence rule as T3.
- Each group card in the rail (~140px wide × 160px tall):
  - Cover image thumbnail (full card bleed) or category gradient fallback.
  - Gradient overlay at the bottom.
  - Group name (2 lines max, white, bold, 13px).
  - Category badge pill (if `category != null`).
  - Member count (small, white).
- Tap → navigate to `/group/[id]`.
- Section header above the rail: "Communities you might like" (14px semibold, `#0F172A`).
- Empty-state: if no groups returned, render nothing (do not show the section header either).

**Placement in `markets.tsx`:** Render `CommunitiesRail` in the `ListHeaderComponent`, below the `CommunitySpotlightCard` and above the category filter bar. Stack order in ListHeaderComponent top-to-bottom: Spotlight card → Communities rail → Category filter bar → Sort controls → markets list.

**Reuse note:** If the S54 group card component is small enough to adapt, use it. Size it down to ~140px wide. If the S54 card was designed at a larger size, build a new compact variant rather than stretching props.

**Acceptance criteria:**
- Rail renders a horizontal scroll of up to 8 group cards.
- Each card taps to the correct group profile.
- Section header hidden when rail is empty.
- Pull-to-refresh on the Explore screen refreshes the rail independently.

---

### S55-T5 (HIGH) — "Hosted by [Group]" chip on market cards

**Files:** `apps/mobile/src/components/market-summary-card.tsx`, `packages/types/src/index.ts`, markets API handler (if group relation is not already included).

**Pre-condition check (CTO must do first):** Grep the markets list API handler and its underlying Prisma query for `group` relation inclusion. If the query does not include `group: { select: { id: true, name: true, slug: true } }`, add it. Then extend `ApiMarketSummary` in `packages/types/src/index.ts` with:
```
group?: { id: string; name: string; slug: string } | null;
```
This is the only type change in this sprint. It is additive and non-breaking (optional field, defaults to absent on existing responses).

**Chip spec:**
- Render a small chip at the bottom of `MarketSummaryCard` only when `item.group != null`.
- Chip content: `people` icon (Ionicons `people-outline`, 11px) + "Hosted by [group.name]" (11px, medium weight, `#64748B`).
- Chip background: `#F1F5F9`, corner radius 4px, horizontal padding 8px, vertical padding 3px.
- Tapping the chip navigates to `/group/[group.id]` (not `slug` — use `id` for safety since the group detail screen uses `[id]`).
- Chip sits below the market title/probability row, above the footer (close date, volume). Insert it between those two regions — do not push the card height beyond ~8px additional.

**Acceptance criteria:**
- Markets with `group != null` show the chip; markets without a group show nothing new.
- Tapping the chip navigates to the correct group profile.
- The chip does not appear on markets in any context where `MarketSummaryCard` is already too dense (e.g., check if the component is used in a compact/inline mode anywhere — if so, add a `compact?: boolean` prop that hides the chip).
- Type change passes TypeScript compilation with no new errors.

---

### S55-T6 (MEDIUM) — Deep link and in-app nav audit

**Files:** `apps/mobile/src/app/(tabs)/_layout.tsx` (verify groups hidden), `apps/mobile/src/app/(tabs)/groups.tsx` (keep file, verify it still renders without crash when navigated to directly).

1. Confirm `groups.tsx` renders without crash when reached via `router.push("/(tabs)/groups")` even though the tab is hidden. The file must remain intact.
2. Audit every `router.push` or `router.replace` call that sends the user to groups or markets by path string. Grep: `/(tabs)/groups`. If any call exists (none found in pre-condition check but verify), repoint it to `/(tabs)/markets` (the Explore tab) or to `/group/[id]` directly depending on intent.
3. If any onboarding or tooltip copy (visible to user) says "Groups tab" or "find groups in the tab bar," update it to "Explore tab" or "find communities in Explore."
4. Analytics: add `explore_communities_rail_tapped` and `explore_spotlight_tapped` events on the respective CTAs. Do NOT rename existing `markets_tab_opened` event.

**Acceptance criteria:**
- Zero in-app navigation pointing to a broken or hidden route.
- New analytics events fire on rail card tap and spotlight CTA tap.
- Onboarding copy does not reference a "Groups tab."

---

## Open questions for CTO — answer before writing code

1. **Group relation on markets API:** Does `GET /api/markets` (or whichever endpoint powers the markets list) currently include the `group` relation in its Prisma select? This determines whether T5 requires an API change or is purely mobile. Check `apps/api/app/api/markets/route.ts` and its service layer.

2. **Spotlight teaser line:** The `ApiDiscoverGroup` shape from S54 includes `recentMarketCount` (integer count only). If we want the spotlight card to show the latest market title as a teaser, the discover endpoint would need to return it. For v1: use the group's `description` field as the teaser if it exists, or show nothing. Do NOT add a new field to the discover endpoint for this sprint.

3. **`compass-outline` availability:** Verify this icon name exists in the Ionicons version currently installed in the mobile app before committing to it. Run `grep -r "compass" node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json` to confirm. If absent, use `search-outline`.

4. **Discover endpoint: `recentMarketCount` definition.** S54 defined this as count of markets created in last 30 days. Confirm the endpoint is actually live and returning this field before the rail component tries to render it.

5. **`MarketSummaryCard` compact mode:** Is there an existing `compact` or `mini` prop, or is it always rendered at the same size? If there is no compact mode, the Hosted-by chip should always render when `item.group != null`. If there is a compact mode, suppress the chip there.

---

## Risk callouts

- **WS6 regression optics.** Re-hiding the Groups tab after S54 un-hid it will look like a rollback to anyone reading the git log without context. The PR description and commit message must explicitly state: "Groups discovery moves to Explore tab where it reaches more users organically via the Hosted-by chip on every group-hosted market card. This is strictly more discoverable than a standalone tab because the discovery surface is proportional to market volume, not to users who happened to tap the Groups tab." CTO: add this to the PR description.

- **Two independent data fetches on Explore.** The screen now fires: (1) markets list, (2) spotlight/discover (limit 1), (3) communities rail (limit 8). Fetches 2 and 3 can share a single `GET /api/groups/discover?sort=members&limit=8` call — the spotlight uses `results[0]` and the rail uses `results[0..7]`. CTO should consolidate T3 and T4 into a single fetch of limit 8, then split the result: `[0]` → spotlight, `[0..7]` → rail. Do NOT make two separate discover calls. Document this in the implementation note.

- **Onboarding flow.** `apps/mobile/src/components/onboarding-walkthrough.tsx:158` navigates to `/(tabs)/markets` which will now display as "Explore." This is actually correct behavior — no change needed. But verify the onboarding tooltip label text does not say "Markets."

- **Analytics comparability.** Any new events introduced in T6 should use the `explore_` prefix not `markets_` to match the new tab name. Existing `markets_` events are frozen with their names.

- **`MarketSummaryCard` is used in at least three contexts** (markets list, feed insight cards, group profile recent markets from S54). The Hosted-by chip is conditional on `item.group != null` so it will silently not appear anywhere group data is absent. This is correct behavior. But verify the `MarketSummaryCard` props type is updated and that TS compilation passes across all three callsites.

---

## Success criteria (CEO will verify after QA pass)

1. Tab bar shows 5 tabs. Groups tab is absent from bar. Route still resolves without crash.
2. The "Explore" label and compass icon appear on the 4th tab slot.
3. A Community spotlight card appears at the top of the Explore screen showing the top OPEN group by member count.
4. A horizontal "Communities you might like" rail renders below the spotlight with at least 1 card (QA: seed at least 2 OPEN groups).
5. At least one market card in the list shows a "Hosted by [Group]" chip (QA: ensure at least 1 market has a `groupId`).
6. Tapping the spotlight CTA, a rail card, and a market chip all navigate to the correct group profile screen.
7. Pull-to-refresh on the Explore screen refreshes all three surfaces.
8. No existing Markets functionality is broken: category filter, sort, status tabs, save/bookmark.

---

## S56 Theme Brief

Sprint 56 headline: Request-to-Join. Add `REQUEST_TO_JOIN` as a third `GroupVisibility` enum value. When a user taps "Request to Join" on an RTJ group, a `GroupJoinRequest` record is created (`requesterId`, `groupId`, `status: PENDING | APPROVED | DENIED`, `createdAt`). Group owners and admins get a "Requests" inbox tab on the group profile listing pending requests with Approve/Deny actions. Approving creates a `GroupMembership` row and triggers a push notification to the requester. The group browse card and Explore spotlight show "Request to Join" CTA for RTJ groups. Group create flow adds RTJ as a third visibility option with copy: "You approve every member before they join."

## S57 Theme Brief

Sprint 57 headline: Discovery polish and community depth. Cover image upload pipeline for Group (reuse or build signed-URL upload consistent with user avatars). Category landing pages from the Explore rail chips — a dedicated screen per category showing the top groups in that category plus a "Create a [category] group" CTA. Search by name across markets + groups + instruments (search bar on Explore, `GET /api/groups/search?q=...`). Per-group notification preferences — a member can mute all notifications from a specific group; required before any group-triggered push fan-out is safe at scale. Featured-flag admin curation for the spotlight (`isFeatured: Boolean` on Group, admin panel toggle). `GroupModerationAction` audit table replacing the S54 `bannedAt` tombstone pattern. Group activity feed on profile (reverse-chronological: new market added, X joined, market resolved).
