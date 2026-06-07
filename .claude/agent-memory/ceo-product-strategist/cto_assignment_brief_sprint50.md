---
name: cto-assignment-brief-sprint50
description: Sprint 50 brief — Move Top Analysts surface to Finance tab (semantic correction of S49 placement error). BigCallCard removed from Feed. Inline 3-row card anchored below BigCallHeroCard.
metadata:
  type: project
---

Sprint 50 issued 2026-06-07. Theme: Correct the semantic placement error from Sprint 49 — Top 3 Analysts belongs in Finance, not on the Feed's generic BigCallCard.

**Sprint thesis:** Sprint 49 placed the Top 3 Analysts footer on Feed's BigCallCard. But BigCallCard surfaces ANY market category — sports, tech, finance — based purely on the editorial `isBigCallDate` flag. The Top 3 analysts are Indian sell-side finance analysts (HDFC Securities, ICICI, Morgan Stanley India). Pairing their credibility rankings under "Will Alphabet reach $7T?" creates cognitive dissonance and undermines the "India's Analyst Scorecard" positioning. The Finance tab already has `BigCallHeroCard` (`finance-mode.tsx:1111`) — a structurally finance-only surface, colloquially the "Call of the Week." That is the correct semantic home. Sprint 50 moves the surface there, removes the BigCallCard from Feed entirely (it was not providing user value as a generic prediction card floating above the news), and delivers a clean inline 3-row card that is always visible to Finance tab visitors without requiring a tap to open a sheet.

**Lesson from S49:** Scoping a "footer for surface Y" without first confirming "surface Y's data invariants guarantee the footer's content is contextually valid" is the root cause. Future CEO briefs that attach feature X to surface Y must explicitly state: "Surface Y's data invariants are: ___, which justify attaching X because: ___." This is now a standing check for all surface-attachment tickets.

---

## Tickets

### S50-T1 (CRITICAL): Remove BigCallCard + TopAnalystsSheet + topExpert state from Feed

**File:** `apps/mobile/src/app/(tabs)/feed.tsx`

**What to remove:**

1. **BigCallCard render in ListHeaderComponent (lines ~735–741):**
   Remove the entire conditional block:
   ```
   {bigCallMarket != null && (
     <BigCallCard ... />
   )}
   ```
   The BigCallCard component definition (lines ~43–155) can stay in the file if it is referenced elsewhere; if it is only used from this ListHeaderComponent block, delete the component definition too. CTO: grep for `BigCallCard` across the mobile app before deleting — if it is used nowhere else, remove the component definition and its local styles.

2. **TopAnalystsSheet mount in the outer View (lines ~699–702):**
   Remove:
   ```
   <TopAnalystsSheet
     visible={topAnalystsSheetVisible}
     onClose={() => setTopAnalystsSheetVisible(false)}
   />
   ```

3. **State declarations (lines ~316–319):**
   Remove:
   ```
   const [topExpert, setTopExpert] = useState<ApiTopExpertEntry | null | undefined>(null);
   const [topAnalystsSheetVisible, setTopAnalystsSheetVisible] = useState(false);
   ```

4. **Analytics events — grep and remove callsites for:**
   - `analysts_footer_viewed`
   - `analysts_footer_tapped`
   These were wired to the BigCallCard footer. They are dead events after this ticket.

5. **Imports (lines ~30–31):**
   Remove `import { AnalystCredibilityBadge } from "@/components/analyst-credibility-badge"` IF AND ONLY IF no other usage in `feed.tsx` remains after the BigCallCard removal. Same for `import { TopAnalystsSheet } from "@/components/top-analysts-sheet"`.
   Do NOT remove `ApiTopExpertEntry` from the types import if it is still used; CTO to check after the state removal.

6. **bigCallMarket fetch and state:** The `bigCallMarket` state and its fetch logic (`fetchBigCall` or equivalent useEffect) feed ONLY the now-removed BigCallCard. Remove the fetch useEffect and the `bigCallMarket` state. The backend endpoint (`/api/finance/today-big-call` or equivalent) is NOT deprecated — see T6 rationale — but the Feed-side fetch is dead code.

**What does NOT move:**
- `PlatformTrustBanner` — stays above FlatList, untouched.
- Category filter bar — stays sticky, untouched.
- Tier upgrade nudge in ListHeaderComponent — stays.
- Follow nudge in ListHeaderComponent — stays.
- All other feed logic — untouched.

**Acceptance criteria:**
1. Feed tab renders with no BigCallCard at any scroll position.
2. No ghost whitespace where BigCallCard was — header renders only tier nudge (if eligible) and follow nudge (if eligible), or is empty if neither condition is true.
3. TypeScript compiles without errors — no dangling references to removed state or components.
4. Pull-to-refresh still works.
5. `TopAnalystsSheet` Modal is no longer mounted anywhere in feed.tsx.

---

### S50-T2 (CRITICAL): New component `<TopAnalystsCard />` — inline always-visible 3-row card

**File:** `apps/mobile/src/components/top-analysts-card.tsx` (new file)

**Visual spec (locked by user):**
```
┌─ TOP ANALYSTS · This week ──────────────────┐
│ 1. Vinod Nair      [badge]  Geojit · 87%    │
│ 2. Rupak De        [badge]  LKP    · 71%    │
│ 3. Kranthi Bathini [badge]  WMS    · 57%    │
│                                              │
│         See full leaderboard →              │
└──────────────────────────────────────────────┘
```

**Props:**
```typescript
type TopAnalystsCardProps = {
  // Data passed in from parent (Finance Mode manages the fetch).
  entries: ApiTopExpertEntry[];
  loading: boolean;
  onLeaderboardPress: () => void;
  onAnalystPress: (expertId: string) => void;
};
```

**Rendering rules:**
- Card header: `"TOP ANALYSTS · This week"` — label style consistent with `heroStyles.stripLabel` in finance-mode.tsx (small caps, muted accent color).
- Each of up to 3 rows: rank number + `<AnalystCredibilityBadge name={...} organization={...} hitRate={...} resolvedCount={...} size="sm" layout="inline" />` + resolved call count ("6 calls").
- Each row is tappable (routes to expert profile via `onAnalystPress`). Use `accessibilityRole="button"`.
- Footer link: "See full leaderboard →" — tappable, calls `onLeaderboardPress`. Style matches existing Finance tab link patterns (accent color, 14px, weight 600).
- **Loading state:** render 3 skeleton rows (same skeleton pattern as `top-analysts-sheet.tsx RowSkeleton`).
- **Empty state:** render a single centered line: `"Not enough resolved calls yet — check back soon."` in `colors.textMuted`. No chevron, no tap target. Card still renders (header visible) so there is no layout jump when data arrives.
- Card background: `colors.surface`. Border radius: `radius.md`. Padding: `spacing.md`. Add a 1px border in `colors.border` consistent with Finance tab card styles.
- **No toggle, no sheet trigger, no chevron on card header.** Always-visible. This is a deliberate departure from the sheet pattern.

**Uses:**
- `AnalystCredibilityBadge` from `@/components/analyst-credibility-badge` (already exists, size "sm").
- `ApiTopExpertEntry` from `@predict-future/types`.
- Do NOT own its own fetch — data is passed in as props from the Finance Mode parent.

**Acceptance criteria:**
1. Component renders 1–3 rows correctly when entries array is non-empty.
2. Loading state shows 3 skeleton rows with no layout jump.
3. Empty state renders card with header and empty-state copy (no blank white box).
4. Tapping a row calls `onAnalystPress(entry.expertId)`.
5. Tapping "See full leaderboard →" calls `onLeaderboardPress`.
6. TypeScript compiles. No hardcoded colors outside the design tokens.

---

### S50-T3 (HIGH): Wire `<TopAnalystsCard />` into Finance Mode below `BigCallHeroCard`

**File:** `apps/mobile/src/components/finance-mode.tsx`

**Exact insertion point:** Lines ~2199–2208. `BigCallHeroCard` is rendered inside a `<View onLayout={...}>` when `bigCallOpinion !== null`. The new `<TopAnalystsCard />` goes DIRECTLY after the closing `</View>` of that block, before `<PulseRibbon />`.

**Data fetch:**
- Add a new independent state: `const [topWeeklyExperts, setTopWeeklyExperts] = useState<ApiTopExpertEntry[]>([]);` and `const [topWeeklyLoading, setTopWeeklyLoading] = useState(true);`.
- Add a standalone `useEffect` (not inside the existing `Promise.all` block at line ~1868) that fetches `/api/experts/top-weekly` independently. It should: (a) set loading true, (b) call `mobileApi.getTopWeeklyExperts()`, (c) set entries on success, (d) set entries to `[]` and loading false on error. The reason for independence: the top-weekly call has a 1-hour cache on the server; it should never block or fail alongside the heavier parallel fetch that loads markets, sentiment, flagship events, etc.
- Cache note: the endpoint has `revalidate: 3600`. The mobile client does not need additional caching — a fresh fetch on each Finance tab mount is fine.

**Navigation callbacks:**
- `onLeaderboardPress`: `router.push("/expert-leaderboard" as Parameters<typeof router.push>[0])` — routes to the full leaderboard screen. This is the correct destination (we are already on Finance tab; routing back to Finance tab would be a no-op).
- `onAnalystPress`: `router.push(\`/expert/\${expertId}\` as Parameters<typeof router.push>[0])`.

**Conditional render:** `<TopAnalystsCard />` is ALWAYS rendered when Finance Mode mounts — it is not gated on `bigCallOpinion !== null`. The Top 3 card is an independent surface. If there is no Big Call today, the Top Analysts card still appears below where the Big Call would have been.

**Acceptance criteria:**
1. Finance tab shows `<TopAnalystsCard />` immediately below `BigCallHeroCard` (or where BigCallHeroCard would be if no Big Call today).
2. Card loads independently — if Big Call fetch fails, Top Analysts card still attempts to load.
3. Tapping an analyst row navigates to `/expert/[id]`.
4. Tapping "See full leaderboard →" navigates to `/expert-leaderboard`.
5. On pull-to-refresh (Finance tab), the top-weekly fetch re-fires (include `topWeeklyRefetch` in the Finance Mode refresh sequence if one exists).
6. TypeScript compiles.

**Open question for CTO:** Confirm Finance Mode's main render path (the `ScrollView` or equivalent at line ~2185+) is reached on every Finance tab visit — i.e., the component is not gated behind a tab-lazy-mount that keeps it alive across visits without remounting. If Finance Mode unmounts/remounts on tab switch, the independent useEffect will re-fetch on every tab visit (acceptable given the 1h server cache). If it stays mounted, the fetch fires once on app launch and is not re-triggered — the user needs to pull-to-refresh to see updated data.

---

### S50-T4 (MEDIUM): Delete `top-analysts-sheet.tsx`

**Decision: Path A — delete the sheet entirely.**

Rationale: The sheet was built as a drill-in triggered by the BigCallCard footer tap. That trigger is gone (T1 removes BigCallCard). The inline `<TopAnalystsCard />` (T2) is always visible and renders the same data. The sheet has no remaining trigger surface. Keeping dead UI creates maintenance overhead and confusion for future developers. We can rebuild a richer per-analyst drill-in later when user research justifies it — that surface (full call history for one analyst) is a materially different product than a Top 3 leaderboard card, and it will be better designed from scratch than repurposed from this sheet.

**What to delete:**
- `apps/mobile/src/components/top-analysts-sheet.tsx` — delete the file entirely.
- Remove `import { TopAnalystsSheet }` from any file that still references it (T1 handles feed.tsx; CTO must grep for any other consumers).

**Dead analytics events (these become dead code once the sheet is gone):**
- `analysts_sheet_opened`
- `analysts_sheet_row_tapped`
- `analysts_leaderboard_link_tapped`

These event names are now orphaned. Do NOT fire them from anywhere else. They will persist in analytics history for S49 data (which is valid) but should not be re-used for the inline card interactions.

**New analytics event for the inline card footer link:** `analysts_leaderboard_card_tapped` — fire from `onLeaderboardPress` inside `<TopAnalystsCard />`. Keeps a clean separation between the old sheet events and the new inline card events.

**Acceptance criteria:**
1. `top-analysts-sheet.tsx` file is deleted.
2. No `import { TopAnalystsSheet }` anywhere in the mobile app.
3. TypeScript compiles — no orphaned imports.
4. `analysts_leaderboard_card_tapped` fires when the leaderboard link in `<TopAnalystsCard />` is tapped.

---

### S50-T5 (MEDIUM): Analytics cleanup — remove dead `bigcall_footer` source callsites

**Grep target:** `bigcall_footer` across the entire mobile app.

This string was used as the `analyticsSource` payload in `analysts_badge_tapped` events fired from the BigCallCard footer context. With BigCallCard removed (T1), any remaining callsite emitting `source: "bigcall_footer"` is dead code.

**Steps:**
1. `grep -rn "bigcall_footer" apps/mobile/` — list all callsites.
2. Remove each callsite (they should be entirely within the now-deleted BigCallCard component or its props chain).
3. Verify no other surface accidentally passes `"bigcall_footer"` as a source string.

If grep returns zero results (meaning T1 already cleaned all callsites as part of removing the BigCallCard component), mark this ticket as trivially done with a one-line note in the commit message.

**Acceptance criteria:**
1. Zero instances of `"bigcall_footer"` in `apps/mobile/`.
2. TypeScript compiles.

---

### S50-T6 (MEDIUM): Document Big Call backend deprecation decision — NO deprecation

**This is a documentation-only ticket — no code changes.**

**Decision locked:** The following backend assets are RETAINED and not deprecated:
- `GET /api/finance/today-big-call` (or equivalent endpoint that feeds `bigCallMarket` on the Feed tab) — retained for potential future editorial features.
- `Market.isBigCallDate` boolean field on the Prisma schema — retained.
- `cron/big-call-push` cron job — retained (still sends daily push notification to all users about the Big Call market regardless of category; this is a valid engagement mechanic independent of the Finance tab surface).

**Rationale:** These assets cost near-zero in maintenance. The cron push is a real engagement driver. The `isBigCallDate` field may be used to rebuild a finance-only editorial feature later. Deprecating now creates schema migration risk and cron deletion risk for no immediate user benefit. The only change from Sprint 50 is that the Feed tab no longer fetches `today-big-call` on mount (T1 handles that cleanup). The backend endpoint still exists and is valid.

**CTO action:** Add a one-line comment to the `today-big-call` route file:
```
// NOTE (S50): Feed tab no longer calls this endpoint. Retained for future editorial
// surfaces and push cron. Do not deprecate without CEO sign-off.
```

This prevents a future developer from treating it as dead code and deleting it inadvertently.

**Acceptance criteria:**
1. Comment added to the route file.
2. No schema migrations in this ticket.
3. `big-call-push` cron untouched.

---

## Out of Scope — Explicitly

- Reverting Feed-first IA. Feed remains tab 1.
- Touching `AnalystCredibilityBadge` component itself (S49-T2 deliverable, stable).
- The badge sweep across 6 surfaces from S49-T3 — those remain and serve the brand-everywhere goal.
- The `/api/experts/top-weekly` endpoint — stays, consumer moves from Feed to Finance.
- iOS build — operational sprint, separate from product sprints.
- Shareable win card — see backlog section below.
- Web landing copy — backlog.

---

## Backlog Stacking Recommendation

Sprint 50 is 5 lean tickets (T1–T2 are the heaviest; T3–T6 are wire-up + cleanup). Total CTO effort is approximately 2–3 days. Bandwidth exists for one additional item.

**Recommended stack-in: Shareable Win Card (WS3 from 2026-06-07 audit).**

Why now: `AnalystCredibilityBadge` exists (S49-T2). `percentileRank` is on `WalletTransaction`. `analystTier` is on `User`. The rendering data is all present. The win card is now a layout task (static render card: prediction text, "called it at X%", tier badge, "beat Y% of crowd") plus native share sheet integration. Estimated 1–1.5 days CTO work. This is the primary organic growth loop — a user whose call resolves correctly gets a shareable artifact for their WhatsApp group. It is the highest-leverage backlog item by GTM impact per build day.

**If the win card is stacked into S50, it becomes T7 (LOW — lower priority than the semantic correction work but high GTM leverage):**
- T7: Shareable win card on market resolution — generate static render card (tier badge + prediction + percentile beat) and invoke native share sheet. Trigger: `WalletTransaction` with `percentileRank !== null` and positive resolution. Mobile only. No backend changes needed — data already exists.

**Items deferred to S51:** iOS build, groups discovery, expert-follow push, web landing copy, opinion pipeline health dashboard.

---

## Open Questions for CTO

1. **Finance Mode mount lifecycle:** Does Finance Mode (`finance-mode.tsx`) unmount and remount on tab switch, or does Expo Router keep it alive? This determines whether the `top-weekly` fetch fires once on app launch or on every Finance tab visit. Both behaviors are acceptable (server cache handles the latter), but CTO should confirm and document the behavior in a comment.

2. **`bigCallMarket` fetch in feed.tsx:** Confirm this fetch is isolated to the feed.tsx file and not shared via a context or shared hook that other screens depend on. If it is feed-local, T1 can delete it safely. If it feeds a shared context, the context consumer list must be audited first.

3. **`BigCallCard` component scope:** Does the `BigCallCard` component (defined inside `feed.tsx`) exist anywhere outside `feed.tsx`? Grep before deleting. If it is feed-local, delete definition + all styles. If it has been imported elsewhere (unlikely), flag before deleting.

4. **Analytics continuity:** `analysts_leaderboard_link_tapped` (sheet event, now dead) vs. new `analysts_leaderboard_card_tapped` (inline card event). Confirm the analytics backend accepts arbitrary event name strings — no enum validation that would reject the new event name.

5. **`AnalystCredibilityBadge` `layout="inline"` prop:** T2 spec references `layout="inline"` on the badge. Confirm this prop exists on `AnalystCredibilityBadge` as shipped in S49-T2. If not, omit the prop — the badge renders correctly without it for the inline card use case.

---

## Risk Callouts

**Category coherence (resolved by this sprint):** The scoping miss from S49 is precisely what this sprint fixes. After S50 ships, every surface showing analyst credibility data is Finance-only. The cognitive dissonance risk is eliminated.

**Finance Mode scroll regression:** Inserting `<TopAnalystsCard />` between `BigCallHeroCard` and `PulseRibbon` adds ~100–120px of vertical height to the Finance Mode scroll view. CTO must verify the `bigCallY` ref (used to scroll-to-highlight the Big Call on deep link) is still correct after the insertion — the `onLayout` is on the BigCallHeroCard's wrapper View, so it should remain stable. But a visual smoke-test is required.

**SEBI legal flag (unchanged from S49):** The Top Analysts card is now on Finance tab, not Feed. It is still a public-facing named accuracy ranking. The outside-counsel review flag from the GTM strategy document remains active. CTO can build; production deployment is gated on legal clearance (no change from S49 status).

---

**Written:** 2026-06-07
**Sprint:** 50
**Depends on:** S49 delivered (T1–T9 complete)
**Next review:** After Sprint 50 delivery
