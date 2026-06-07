---
name: cto-assignment-brief-sprint51
description: Sprint 51 brief — Finance tab density reduction. Compact TopAnalystsCard, collapsible PulseRibbon, WeekToggleCard to strip. Reduces pre-feed scroll from ~560px to ~310px.
metadata:
  type: project
---

Sprint 51 issued 2026-06-07. Theme: Finance tab density reduction — surface the Expert Opinions feed faster.

**Sprint thesis:** The Finance tab is the analyst depth surface, but density crowds out the actual content. After S50 shipped TopAnalystsCard, the pre-feed stack grew to ~560px across four components before Expert Opinions are visible. S51 compacts the new TopAnalystsCard to ~120px (from ~200px), collapses Today's Pulse (PulseRibbon) to a one-line header by default, and turns WeekToggleCard into a compact single-line strip with tap-to-expand — reducing total pre-feed scroll from ~560px to ~310px without removing any function.

**Lesson from S50 to S51:** Adding TopAnalystsCard to Finance tab was correct semantically, but the card was scoped without auditing the existing vertical real estate of the tab landing surface. Future tickets that add any component to a tab's landing view must include a one-line check: "current pre-fold stack is Xpx, this addition brings it to Ypx, target is Zpx." No heavy process — just one line in the ticket.

---

## Pre-feed stack before and after S51

| Position | Component | Before | After |
|---|---|---|---|
| 1 | BigCallHeroCard | ~120px | ~120px (unchanged) |
| 2 | TopAnalystsCard | ~200px | ~120px (Ticket A) |
| 3 | PulseRibbon (Today's Pulse) | ~90px | ~44px collapsed (Ticket B) |
| 4 | WeekToggleCard (Your Week) | ~150px | ~50px compact strip (Ticket C) |
| **Total** | | **~560px** | **~334px** |

---

## Tickets

### S51-T1 (CRITICAL): Compact TopAnalystsCard

**File:** `apps/mobile/src/components/top-analysts-card.tsx`

**What changes:**

1. **Header row:** Replace `<Text style={cardStyles.header}>TOP ANALYSTS · This week</Text>` with a lowercase, lighter-weight label. New text: `"Top analysts · this week"`. New style: `fontSize: 11, fontWeight: "500", color: colors.textMuted, letterSpacing: 0.3` — NOT uppercase, NOT bold, NOT all-caps. This collapses the header visually from a section-heading to an inline label.

2. **Row padding:** `cardStyles.row` currently has `paddingVertical: spacing.sm`. Reduce to `paddingVertical: 5`. `paddingHorizontal: spacing.xs` stays.

3. **Rank font size:** `cardStyles.rank` is `fontSize: 13`. Reduce to `fontSize: 12`.

4. **Call count font size:** `cardStyles.callCount` is `fontSize: 11`. Keep at 11 (already small).

5. **Footer link text:** `cardStyles.leaderboardLinkText` currently renders "See full leaderboard ". Change text to `"See all →"`. Merge the two `<Text>` nodes (linkText + arrow) into one: `<Text style={cardStyles.leaderboardLinkText}>See all →</Text>`. Reduce font size from 14 to 12. Reduce `marginTop` on `leaderboardLink` from `spacing.sm` to 4.

6. **Card outer padding:** `cardStyles.card` has `padding: spacing.md`. Reduce to `paddingHorizontal: spacing.md, paddingVertical: spacing.sm` (tighter vertical breathing room).

7. **Gap between rows:** `cardStyles.listArea` has `gap: spacing.xs`. Reduce to `gap: 3`.

8. **Tier emoji:** Keep as-is. The emoji is rendered inside `AnalystCredibilityBadge` — do not touch the badge component. The brief already deems the emoji small and valuable as visual signal.

**Target height:** ~120px (down from ~200px).

**Acceptance criteria:**
1. Card renders visibly smaller — CTO does a visual before/after screenshot in the simulator at the standard Finance tab scroll position.
2. All three analyst rows, skeleton state, and empty state still render correctly.
3. "See all →" link still calls `onLeaderboardPress`.
4. TypeScript compiles. No hardcoded colors outside tokens.
5. `AnalystCredibilityBadge` component is not modified.

---

### S51-T2 (HIGH): PulseRibbon (Today's Pulse) — collapsible with persisted default-collapsed state

**File:** `apps/mobile/src/components/finance-mode.tsx`

**Component to modify:** `PulseRibbon` function (line ~623). This is a standalone function component within finance-mode.tsx.

**What the current component does:** Renders a `<View style={pulseStyles.wrapper}>` containing a `<Text style={pulseStyles.heading}>TODAY'S PULSE</Text>` and a horizontal `<ScrollView>` of 1–2 pill chips ("Next event · BUDGET in 7d ›" and "Policy calendar · 3 this week ›"). Total height ~90px.

**Changes required:**

1. **Add `AsyncStorage` collapse state.** `AsyncStorage` is already imported at line 1 of finance-mode.tsx and used at line 807 (`finance.weekCardView`). Follow the exact same pattern.

   Add inside `PulseRibbon`:
   ```
   const [collapsed, setCollapsed] = useState(true); // default collapsed
   useEffect(() => {
     void AsyncStorage.getItem("finance_section_collapsed_pulse").then((v) => {
       if (v === "false") setCollapsed(false);
       // if null (first launch) or "true", stay collapsed — default is collapsed
     });
   }, []);
   const toggleCollapsed = useCallback(() => {
     const next = !collapsed;
     setCollapsed(next);
     void AsyncStorage.setItem("finance_section_collapsed_pulse", String(next));
   }, [collapsed]);
   ```

   Persistence key: `"finance_section_collapsed_pulse"` (string — "true" or "false").

2. **Tappable header row.** Replace the bare `<Text style={pulseStyles.heading}>` with a `<Pressable>` row:
   ```
   <Pressable
     onPress={toggleCollapsed}
     style={pulseStyles.headingRow}
     accessibilityRole="button"
     accessibilityState={{ expanded: !collapsed }}
     accessibilityLabel={collapsed ? "Today's Pulse, collapsed. Tap to expand." : "Today's Pulse, expanded. Tap to collapse."}
   >
     <Text style={pulseStyles.heading}>TODAY'S PULSE</Text>
     <Text style={pulseStyles.collapseChevron}>{collapsed ? "▼" : "▲"}</Text>
   </Pressable>
   ```

3. **Conditional pills render.** Wrap the `<ScrollView>` of pills in `{!collapsed && (...)}`.

4. **New styles to add to `pulseStyles`:**
   ```
   headingRow: {
     flexDirection: "row",
     alignItems: "center",
     justifyContent: "space-between",
     paddingHorizontal: spacing.lg,
     paddingVertical: 6,
   },
   collapseChevron: {
     fontSize: 10,
     color: "#9ca3af",
     marginRight: 4,
   },
   ```
   The existing `pulseStyles.heading` already has `paddingHorizontal: spacing.lg` — remove the `paddingHorizontal` from `heading` and move it to `headingRow` to avoid double padding when wrapped.

**Important — PulseRibbon receives no session userId prop.** The persistence key is device-level (AsyncStorage is per-device). The brief says "per-user (not per-device — use the existing session userId pattern)." However, `PulseRibbon` is a pure display component that does not receive auth context. **CTO decision:** If finance-mode.tsx has a `userId` or `session` available in the parent scope (the main FinanceMode component), pass it down and suffix the key: `"finance_section_collapsed_pulse_" + userId`. If it is not readily available, use the plain key (device-level) and document this in a code comment. Do not add a new auth fetch just for this persistence key — it is not worth the complexity.

**Target height when collapsed:** ~44px (header row only).

**Acceptance criteria:**
1. PulseRibbon renders with only the tappable header row on first open (collapsed by default).
2. Tapping header row expands and shows pills; tapping again collapses.
3. State persists across app close/reopen (AsyncStorage round-trip).
4. `accessibilityRole="button"` and `accessibilityState={{ expanded }}` present on the header Pressable.
5. Pills still tap through to their respective PulseSheet bottom sheets when expanded.
6. TypeScript compiles.

---

### S51-T3 (HIGH): WeekToggleCard — compact strip default with tap-to-expand

**File:** `apps/mobile/src/components/finance-mode.tsx`

**Component to modify:** `WeekToggleCard` function (line ~789). This is a standalone function component within finance-mode.tsx.

**What the current component does:** Renders a card (`digestStyles.card`) containing: a toggle row (Your Week / Market Sentiment pills), then a body (`WeekCallsBody` or `SentimentBody`) showing stat blocks, a bar chart, and "Tap to see all your calls." Total height ~150px. Toggle state is persisted in `AsyncStorage` key `"finance.weekCardView"`.

**Changes required:**

1. **Add expand/collapse state.** Default: collapsed (compact strip). Persistence key: `"finance_section_expanded_yourweek"`.

   Add inside `WeekToggleCard`:
   ```
   const [expanded, setExpanded] = useState(false); // default compact strip
   useEffect(() => {
     void AsyncStorage.getItem("finance_section_expanded_yourweek").then((v) => {
       if (v === "true") setExpanded(true);
     });
   }, []);
   const toggleExpanded = useCallback(() => {
     const next = !expanded;
     setExpanded(next);
     void AsyncStorage.setItem("finance_section_expanded_yourweek", String(next));
   }, [expanded]);
   ```

2. **Compact strip (collapsed state).** When `expanded === false`, render instead of the full card:
   ```
   <Pressable
     style={digestStyles.compactStrip}
     onPress={toggleExpanded}
     accessibilityRole="button"
     accessibilityState={{ expanded: false }}
     accessibilityLabel={`Your week: ${digest?.hits ?? 0} correct, ${digest?.misses ?? 0} wrong, ${digest?.pending ?? 0} pending. Tap to expand.`}
   >
     <Text style={digestStyles.compactStripText}>
       Your week: <Text style={{ color: "#16a34a", fontWeight: "700" }}>{digest?.hits ?? 0} right</Text>
       {" · "}
       <Text style={{ color: "#dc2626", fontWeight: "700" }}>{digest?.misses ?? 0} wrong</Text>
       {" · "}
       <Text style={{ color: "#6b7280" }}>{digest?.pending ?? 0} pending</Text>
     </Text>
     <Text style={digestStyles.compactStripChevron}>›</Text>
   </Pressable>
   ```

   **Note:** The compact strip shows the CALLS view stats only (hits/misses/pending). Do not show sentiment in the strip. The sentiment toggle is available only in the expanded state.

3. **Expanded state.** When `expanded === true`, render the existing full card — but wrap the outermost `<View style={digestStyles.card}>` in a `<Pressable>` on the header row only (not the whole card) to allow collapsing. Alternatively: add a small collapse chevron `▲` in the top-right corner of the card when expanded. Simpler approach: make the toggle row header tappable to toggle back to collapsed. CTO chooses the implementation — either a chevron in the top-right or a header row tap — as long as the user can collapse back.

4. **Do not change hide-entire-card logic.** The existing `if (!hasCalls && !hasSentiment) return null;` stays unchanged. If both data sources are empty, neither strip nor full card renders.

5. **New styles to add to `digestStyles`:**
   ```
   compactStrip: {
     flexDirection: "row",
     alignItems: "center",
     justifyContent: "space-between",
     marginHorizontal: spacing.lg,
     marginTop: spacing.xs,
     marginBottom: spacing.xs,
     paddingHorizontal: spacing.md,
     paddingVertical: 12,
     borderRadius: radius.md,
     backgroundColor: "#fff",
     borderWidth: 1,
     borderColor: "#E5E7EB",
   },
   compactStripText: {
     fontSize: 13,
     color: "#374151",
     flex: 1,
   },
   compactStripChevron: {
     fontSize: 18,
     color: "#9ca3af",
     lineHeight: 20,
   },
   ```

**Target height when collapsed:** ~50px (single line strip).

**Acceptance criteria:**
1. WeekToggleCard renders as a compact single-line strip on first open.
2. Tapping the strip expands to the full card (toggle + stat body).
3. The Market Sentiment toggle is only accessible in the expanded state (strip shows Your Week stats only).
4. User can collapse back from expanded state.
5. State persists across app close/reopen.
6. `accessibilityRole="button"` and `accessibilityState={{ expanded }}` on the strip Pressable.
7. The existing `"finance.weekCardView"` toggle persistence still works correctly in expanded state.
8. "Tap to see all your calls" footer still routes to `/finance/my-calls` when the WeekCallsBody is tapped in expanded mode.
9. TypeScript compiles.

---

## Open Questions for CTO

1. **AsyncStorage usage confirmation:** `AsyncStorage` is imported at line 1 and used at line 807 (`finance.weekCardView`). Confirm it is the React Native `@react-native-async-storage/async-storage` package, not a custom wrapper, so the `getItem` / `setItem` pattern used above is correct.

2. **`WeekToggleCard` component name and JSX entry point:** Confirmed at line ~789 in finance-mode.tsx. The function is `WeekToggleCard`. It is invoked in the Finance Mode scroll view at line ~2274: `<WeekToggleCard digest={callsDigest} sentiment={analystSentiment} onPressCalls={...} />`. Confirm there are no other callsites — grep for `WeekToggleCard` before adding internal state.

3. **`PulseRibbon` component name and JSX entry point:** Confirmed at line ~623 in finance-mode.tsx. Invoked at line ~2265: `<PulseRibbon flagshipEvents={flagshipEvents} clustersCount={...} onPress={...} />`. Single callsite confirmed.

4. **"Today's Pulse" in the code:** The `PulseRibbon` function renders `TODAY'S PULSE` as its heading label (line 669). The user-facing label for the collapsible header should match: `"TODAY'S PULSE"` (existing style). Confirm `pulseStyles.heading` currently owns `paddingHorizontal: spacing.lg` — if so, move that padding to the new `headingRow` style to avoid double-padding when wrapping in a `<Pressable>` row.

5. **UserId suffix for persistence keys:** Does the Finance Mode component have easy access to the authenticated user's ID (e.g., from a `useSession` hook or `currentUser` state)? If yes, suffix all three persistence keys with `_${userId}` for per-user persistence. If not readily available at PulseRibbon or WeekToggleCard scope, use plain device-level keys and document. Do not add a new auth fetch.

---

## Backlog Stacking Decision

Sprint 51 is 3 tightly-scoped polish tickets. T1 is mostly style changes (under 2 hours). T2 and T3 are each ~2–3 hours of state wiring. Total CTO effort: approximately 0.5–1 day. That leaves bandwidth for one additional item.

**My view: do NOT stack the shareable win card into S51.** Here is the reasoning:

The win card (Weak Spot 3 from the 2026-06-07 audit) requires: (1) detecting `WalletTransaction` resolution events, (2) rendering a static image card with tier badge + percentile data, (3) invoking the native share sheet. That is an independent feature thread — it does not share any code with T1/T2/T3. Stacking it risks diluting QA focus on the density work, which is already live and user-tested. The user's original complaint was density; QA for S51 should be a single pass that verifies the Finance tab scroll height and collapse/expand behavior, not a split between that and a new share-card feature.

**Sprint 52 headline: shareable win card.** All data dependencies are shipped (S25 added `percentileRank`, S49 shipped `analystTier` badge). The build is a rendering task. Sprint 52 should have the win card as T1 (Critical), stacked with the web landing copy update (T2, 2-hour copywriting task that unblocks the press play — Weak Spot 7) and possibly the expert-follow push notification wire-up (T3 — Weak Spot 8). These three together constitute a GTM-activation sprint: social virality artifact + press-ready web copy + retention push loop.

---

## Risk Callouts

**PulseRibbon collapse hides data users may want:** Today's Pulse shows upcoming RBI/budget events — finance-engaged users who care about macro calendar may be frustrated to see it collapsed. Mitigate by ensuring the chevron and label are visually clear that content is hidden, and by making the collapse state user-controllable (not time-gated). If retention data after S51 shows users rarely expand it, consider removing PulseRibbon entirely in a later sprint.

**WeekToggleCard strip accessibility:** The Market Sentiment view is only accessible in expanded state. Users who primarily check sentiment (not their own calls) will have to tap twice on every Finance tab visit. Acceptable for now — the compact strip shows Your Week stats (the primary daily-retention signal), which is higher-frequency than sentiment checking. Revisit if telemetry shows low expand rate.

**No layout regression on BigCallHeroCard `bigCallY` ref:** S50's risk callout about the `bigCallY` scroll ref still applies — inserting layout changes below BigCallHeroCard does not affect that ref since it measures the hero card's own `onLayout`, but CTO should do a smoke test of the deep-link scroll-to-hero behavior after S51 ships.

---

**Written:** 2026-06-07
**Sprint:** 51
**Depends on:** S50 delivered
**Next review:** After Sprint 51 delivery
