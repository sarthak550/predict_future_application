---
name: cto-assignment-brief-sprint49-polish
description: Sprint 49 amendment (T8 + T9) — scrollable BigCallCard header and Finance tab routing from TopAnalystsSheet. SUPERSEDED in S50.
metadata:
  type: project
  superseded_by: cto_assignment_brief_sprint50.md
---

> **⚠️ SUPERSEDED (2026-06-07):** Both T8 (BigCallCard moved into Feed's FlatList ListHeaderComponent) and T9 (TopAnalystsSheet "See full leaderboard →" repointed to Finance tab) were reversed within the same day. Sprint 50 removed the Feed BigCallCard entirely, deleted TopAnalystsSheet, and re-anchored the analyst surface to Finance tab. Read this brief as historical context only.

Sprint 49 Polish issued 2026-06-07. Slotted as Sprint 49 amendment (T8 + T9), not Sprint 50 opener.

**Rationale for amendment vs new sprint:** Both fixes are direct corrections to Sprint 49 deliverables. T8 fixes a layout regression introduced by the BigCallCard-as-sibling placement. T9 corrects a routing decision that was superseded by user testing. Shipping Sprint 50 without these in production would mean S49 was never truly "done."

---

## Ticket T8 (HIGH): Move BigCallCard + promotional nudges into FlatList ListHeaderComponent

**File:** `apps/mobile/src/app/(tabs)/feed.tsx`

**Problem:** BigCallCard (lines 719–725), the tier upgrade nudge (lines 698–716), and the follow nudge (lines 734–746) are currently rendered as sibling Views above the FlatList. They are pinned — they do not scroll. Users cannot dismiss them to read feed content below without manually scrolling past stuck real estate that never moves.

**Fix:** Extract all three elements into the FlatList's `ListHeaderComponent` prop so they scroll off naturally with the feed.

**Exact change:**

1. Remove lines 697–746 from the outer View body (the tier nudge, BigCallCard, TopAnalystsSheet render, and follow nudge).
2. Add a `ListHeaderComponent` prop to the FlatList (which currently has no ListHeaderComponent — confirmed by reading lines 748–810). The component should render:
   - Tier upgrade nudge (same JSX, same conditional — `authStatus === "authenticated" && !tierNudgeDismissed && tierUpgradeNextTier !== null`)
   - BigCallCard (same conditional — `bigCallMarket != null`)
   - Follow nudge (same conditional — `personalizationMode === "for_you" && followCount === 0`)
3. The TopAnalystsSheet Modal render (`lines 727–731`) must stay in the outer View body — it is a Modal overlay, not a scroll-position-dependent element. Moving it into ListHeaderComponent would cause it to unmount/remount on scroll. Leave it exactly where it is.

**What does NOT move:**
- Category filter bar (`lines 680–692`) — remains sticky above the FlatList. This is primary navigation; it must never scroll.
- PlatformTrustBanner (`line 695`) — leave above the FlatList for now. It is a constant brand element, not a one-time hook. The user's complaint was about the BigCallCard eating real estate, not the trust banner. Conservative call: leave it.

**Acceptance criteria:**
1. Scrolling down the feed causes the BigCallCard to scroll off the top naturally.
2. Scrolling back to the top reveals the BigCallCard again.
3. Pull-to-refresh (`RefreshControl` on the FlatList) still works correctly — the header does not duplicate or disappear on refresh.
4. Category filter bar remains fully sticky — it does not scroll at any point.
5. Tier nudge dismiss button still works (tapping X removes the nudge from the header without affecting feed items).
6. Follow nudge tap still routes to `/(tabs)/leaderboard`.
7. TopAnalystsSheet still slides up correctly when BigCallCard footer is tapped — the Modal is unaffected by the ListHeaderComponent change.
8. On a device with no qualifying BigCall market today (`bigCallMarket === null`), the header renders only the applicable nudges (or nothing if neither nudge condition is true) — no blank white space.
9. `snapToInterval` snap behaviour on the FlatList is unaffected — header items are not card-height-snapped (this is already the case for ListHeaderComponent, but verify visually).

**Edge case note — snapToInterval:** The FlatList uses `snapToInterval={cardHeight}`. ListHeaderComponent items are excluded from snap behaviour automatically by React Native. No extra work needed, but CTO should do a visual smoke-test on device to confirm the first feed card snaps correctly after the header.

---

## Ticket T9 (HIGH): Update TopAnalystsSheet footer link — route to Finance tab

**File:** `apps/mobile/src/components/top-analysts-sheet.tsx`

**Problem:** The "See full leaderboard →" link on line 141 routes to `/expert-leaderboard`. The user's intent after viewing the Top 3 sheet is to explore analyst calls, not just a rankings list. Finance tab (`/(tabs)/finance`) contains the leaderboard as a section plus the full analyst opinions feed, search, and sentiment — it is the richer, more actionable destination.

**Fix (3 targeted changes):**

1. **Line 141** — change the `router.push` destination from `"/expert-leaderboard"` to `"/(tabs)/finance"`:
   ```
   // Before:
   router.push("/expert-leaderboard" as Parameters<typeof router.push>[0]);
   // After:
   router.push("/(tabs)/finance" as Parameters<typeof router.push>[0]);
   ```

2. **Lines 193–194** — update the link label from "See full leaderboard →" to "Browse analyst calls →":
   ```
   // Before:
   <Text style={sheetStyles.leaderboardLinkText}>See full leaderboard </Text>
   <Text style={sheetStyles.leaderboardLinkArrow}>→</Text>
   // After:
   <Text style={sheetStyles.leaderboardLinkText}>Browse analyst calls </Text>
   <Text style={sheetStyles.leaderboardLinkArrow}>→</Text>
   ```

3. **Analytics event name (line 139)** — DO NOT rename `analysts_leaderboard_link_tapped`. Keep the event name exactly as-is. Renaming an analytics event invalidates all historical data and breaks any dashboards or funnels that reference the old name. The label/route change is sufficient; semantic precision in event names does not outweigh data continuity. CTO: this is a deliberate decision, not an oversight.

**Acceptance criteria:**
1. Tapping "Browse analyst calls →" from the sheet navigates to `/(tabs)/finance`.
2. Sheet closes before navigation (existing `onClose()` call on line 140 handles this — verify it fires before `router.push`).
3. Analytics event `analysts_leaderboard_link_tapped` still fires on tap.
4. TypeScript compiles without errors — route string `"/(tabs)/finance"` is valid in the project's Expo Router type definitions (CTO: if the route type cast is stricter here, use the same `as Parameters<typeof router.push>[0]` cast already used on this line).
5. Accessibility label on the Pressable (`accessibilityLabel="See full leaderboard"` on line 192) should also be updated to `"Browse analyst calls"` for screen reader consistency.

---

## Out of Scope

- Routing `expert-leaderboard.tsx` screen elsewhere — it remains reachable from the Finance tab's internal navigation. This change only affects the sheet outbound link.
- Moving BigCallCard to Finance tab — locked out by Feed-first IA decision (2026-06-07). Not up for discussion.
- Tab bar reordering — locked. Not up for discussion.
- PlatformTrustBanner treatment — leave above FlatList. Deferred.

---

## Risk Callouts

**snapToInterval smoke-test (T8):** The FlatList's `snapToInterval={cardHeight}` is the highest-risk area. React Native excludes ListHeaderComponent from snap calculations automatically, but empirically this can behave unexpectedly on some RN versions. CTO must do a physical device or simulator scroll test — not just a TypeScript compile pass — before marking T8 done.

**Modal z-order (T8):** TopAnalystsSheet is a `Modal` with `statusBarTranslucent`. Its render position in the outer View tree does not affect z-order (Modals are always rendered above the app). Leaving it in the outer View is the correct call. Moving it into ListHeaderComponent would be wrong.

**Route type safety (T9):** `/(tabs)/finance` is an Expo Router tab route. If the project uses typed routes (`expo-router` v3+ with `typedRoutes: true`), the cast `as Parameters<typeof router.push>[0]` is already the pattern used in this file (line 141) and should work identically for the Finance route.

---

**Written:** 2026-06-07
**Sprint slot:** Sprint 49 amendment (T8 + T9)
**Next review:** After T8 + T9 delivery and QA pass
