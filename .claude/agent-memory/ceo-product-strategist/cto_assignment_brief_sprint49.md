---
name: cto-assignment-brief-sprint49
description: Sprint 49 tickets — "Analyst Scorecard brand visible everywhere" — BigCallCard Top 3 footer + bottom sheet, AnalystCredibilityBadge sweep across all analyst-name surfaces, supporting endpoint, empty states, and analytics instrumentation
metadata:
  type: project
---

Sprint 49 issued 2026-06-07. Theme: Make the Analyst Scorecard brand visible everywhere a user looks, without disrupting Feed-first IA.

**Sprint thesis:** Every surface that shows an analyst name must simultaneously show their credibility score, and the BigCallCard — the most prominent real estate on the Feed — must become the product's always-on leaderboard window, surfacing the week's #1 analyst to every user who opens the app, regardless of which tab they prefer.

**User-visible outcome being underwritten:** A first-time user who never leaves the Feed tab will encounter "Vikas Khemani · Chief Analyst · 87%" within their first scroll, tap the footer, see the Top 3 this week, and understand in under 10 seconds what this product is actually for. That is the entire repositioning goal delivered without touching the tab bar.

---

## Critical Finding from Schema Review

**The Expert model has no accuracy or tier fields.** `model Expert` contains only: id, name, organization, verified, bio, avatarUrl, tipranksUrl, linkedinUrl, createdAt, updatedAt. Accuracy must be computed at query time by counting `ExpertOpinion` rows where `resolutionStatus IN (RESOLVED_HIT, RESOLVED_MISS)` for a given expertId. There is no cached `weeklyAccuracy` column, no `analystTier` on Expert (only on `User`), and no existing `/api/analysts/top` endpoint. T1 must handle this derivation entirely at query time — or add a derived column with a cron to populate it. See open questions below.

---

## Tickets

### S49-T1 (CRITICAL): New API endpoint `GET /api/experts/top-weekly`

**File:** `apps/api/src/app/api/experts/top-weekly/route.ts` (new file)

**What it does:** Returns the top N experts ranked by accuracy over a rolling 7-day window, with a minimum resolved-call threshold.

**Acceptance criteria:**
1. Query: find all `ExpertOpinion` rows where `resolvedAt >= NOW() - 7 days` AND `resolutionStatus IN ['RESOLVED_HIT', 'RESOLVED_MISS']` AND `isSourceAttribution = false` (named analysts only, not "Market Analysis from Source"). Group by `expertId`. Compute `hitRate = RESOLVED_HIT_count / (RESOLVED_HIT_count + RESOLVED_MISS_count)`. Minimum threshold: `totalResolved >= 3`. Rank descending by hitRate, break ties by totalResolved count.
2. Response shape (for each entry):
   ```json
   {
     "rank": 1,
     "expertId": "clxxx",
     "expertName": "Vikas Khemani",
     "organization": "HDFC Securities",
     "hitRate": 0.87,
     "resolvedCount": 7,
     "hitCount": 6
   }
   ```
3. Return at most 10 results. If fewer than 3 experts meet the threshold, return an empty array (do not lower the threshold silently).
4. Cache with `revalidate: 3600` (1-hour Next.js cache) — this data does not need to be real-time.
5. No auth required — this is a public endpoint.
6. Add index `@@index([expertId, resolutionStatus, resolvedAt])` on ExpertOpinion if it does not already exist (check existing indexes first — `@@index([expertId, publishedAt])` exists but does not cover resolutionStatus).
7. TypeScript: add `ApiTopExpertEntry` type to `packages/types` and export it.

---

### S49-T2 (CRITICAL): `<AnalystCredibilityBadge />` shared mobile component

**File:** `apps/mobile/src/components/analyst-credibility-badge.tsx` (new file)

**Context:** `analyst-tier-badge.tsx` already exists and renders a tier chip (ANALYST, SENIOR_ANALYST, CHIEF_ANALYST). This new component is DIFFERENT: it is an inline attribution string `Name · TierChip · 87%` intended for placement next to analyst names everywhere. It composes `AnalystTierBadge` internally.

**Props:**
```typescript
type AnalystCredibilityBadgeProps = {
  name: string;
  organization?: string;
  tier?: AppAnalystTier | null;
  hitRate?: number | null;        // 0.0–1.0 — rendered as "87%"
  resolvedCount?: number | null;  // if < 3, suppress hitRate display
  size?: "sm" | "md";             // sm = 11px for feed cards, md = 13px for profile
  onPress?: () => void;           // optional tap-through to analyst profile
};
```

**Rendering rules:**
- Always render: `name` (bold) — optionally followed by `· organization` if provided.
- If `tier` is non-null and not ROOKIE: render `AnalystTierBadge` inline after the name row.
- If `hitRate` is non-null AND `resolvedCount >= 3`: render `· 87%` accuracy stat in `colors.success` (green). If resolvedCount < 3, suppress the percentage entirely (not enough data).
- If `onPress` is provided, wrap in Pressable with `accessibilityRole="button"`.
- Size "sm": name fontSize 12, org fontSize 11. Size "md": name fontSize 14, org fontSize 12.

**Do NOT** create a web version of this component in this ticket — web is out of scope for Sprint 49.

---

### S49-T3 (HIGH): Apply `<AnalystCredibilityBadge />` to all analyst-name render sites (sweep ticket)

**Why this is a sweep not a feature:** The badge exists but means nothing until it appears universally. A badge on one screen and absent on another is incoherent. Enumerate every site where an analyst name renders and apply it.

**Surfaces to update (CTO must verify each file exists and locate the exact render site):**

1. `apps/mobile/src/components/expert-opinion-card.tsx` — expert name row. Replace current name + `AnalystTierBadge` usage with `AnalystCredibilityBadge`. Pass hitRate and resolvedCount from the opinion data if the API response includes them (add to API response if not — see T1).
2. `apps/mobile/src/components/expert-opinion-post-card.tsx` — same treatment as above.
3. `apps/mobile/src/app/(tabs)/finance.tsx` (or wherever Finance tab renders expert opinion list) — expert name in opinion cells.
4. Expert search/results screen — wherever `Expert` rows are listed with names, add the badge inline.
5. Expert profile screen — the header attribution (name + org). Use size "md".
6. Leaderboard screen `apps/mobile/src/app/(tabs)/leaderboard.tsx` (or `/expert-leaderboard.tsx`) — leaderboard rows already show names; add tier + accuracy inline.
7. `apps/mobile/src/app/(tabs)/feed.tsx` — BigCallCard attribution (added in T4 below; the badge component from T2 is used there directly).

**API contract note:** For surfaces 1–4, the API response for expert opinions will need to include `hitRate` and `resolvedCount` fields. CTO must check whether these are already returned from `/api/finance/opinions` or equivalent — if not, add them by joining/computing from ExpertOpinion resolution data. A lightweight approach: add a `weeklyStats?: { hitRate: number; resolvedCount: number }` field to the expert sub-object in the finance opinions response, populated by the same query logic as T1.

**Acceptance criteria:**
- Every surface listed above shows the credibility badge with tier and accuracy (where data exists).
- No surface shows a raw name string where the badge should appear.
- Existing visual regression: AnalystTierBadge standalone usages (e.g., on profile surface with `surface="profile"` prop) are NOT replaced — only public/comment surfaces.

---

### S49-T4 (HIGH): BigCallCard footer row — #1 analyst this week

**File:** `apps/mobile/src/app/(tabs)/feed.tsx` — within the `BigCallCard` component (lines 43–155 of current file)

**What to add:** A horizontal divider + footer row at the bottom of the BigCallCard, below the CTA button.

**Visual spec:**
```
─────────────────────────────────────
#1 analyst this week:
  Vikas Khemani · Chief Analyst · 87%  ›
```

**Data source:** Call `GET /api/experts/top-weekly` on Feed mount. Pass the top entry (rank 1) down as a prop or via a local state fetch in the BigCallCard component. Use a separate `useFetch`/`useEffect` — do NOT couple the top-weekly call to the Big Call market fetch (they are independent data sources and should fail independently).

**Acceptance criteria:**
1. Footer renders below the CTA button, separated by a 1px divider in `colors.border`.
2. Footer shows: label "#1 analyst this week:" in `colors.textMuted` (11px), followed by the analyst name, tier badge, and accuracy on the next line.
3. `AnalystCredibilityBadge` component (from T2) is used for the analyst row, size "sm".
4. A `›` chevron on the right indicates the row is tappable.
5. Tapping the footer row opens the Top 3 bottom sheet (T5).
6. If the top-weekly fetch is in-flight: show a 1-line skeleton placeholder in the footer area (no flicker, no layout jump).
7. If the top-weekly fetch returns an empty array (no qualifying analysts): render the empty state defined in T6 rather than hiding the footer entirely.
8. The BigCallCard as a whole remains tappable through to the market — footer tap is a separate touch target and must not propagate to the card's `onPress`.

---

### S49-T5 (HIGH): Top 3 analysts bottom sheet with leaderboard link

**File:** New component `apps/mobile/src/components/top-analysts-sheet.tsx`

**Trigger:** Tapping the BigCallCard footer row (T4).

**Sheet contents:**
- Title: "Top Analysts This Week"
- Subtitle: "Ranked by accuracy — last 7 days"
- List of up to 3 rows, each: rank number (1/2/3), `AnalystCredibilityBadge` (size "md"), `resolvedCount` resolved calls (e.g. "6 calls"). Each row is tappable through to the expert's profile screen.
- Footer link: "See full leaderboard →" — routes to `apps/mobile/src/app/(tabs)/leaderboard.tsx` (or the expert-leaderboard route — CTO must verify the correct route path and use it).
- Use the existing bottom sheet pattern in the codebase (check if `@gorhom/bottom-sheet` is installed; if not, use a `Modal` with a slide-up animation consistent with other sheets in the app).

**Acceptance criteria:**
1. Sheet slides up on footer tap and is dismissible by swipe-down or tapping the backdrop.
2. All 3 rows render with rank, credibility badge, and resolved-count stat.
3. Tapping a row navigates to that expert's profile and closes the sheet.
4. "See full leaderboard →" navigates to the leaderboard screen and closes the sheet.
5. If only 1 or 2 analysts qualify (between 3 and 5 resolved calls is possible), render 1 or 2 rows — do not pad to 3 with empty rows.
6. Uses `ApiTopExpertEntry` type from T1.

---

### S49-T6 (MEDIUM): Empty states — no qualifying analysts, no Big Call today

Two distinct empty states needed:

**Empty state A — no analysts meet the threshold (BigCallCard footer + Top 3 sheet):**
- Footer row renders with: "#1 analyst this week: Not enough resolved calls yet."
- Copy: muted gray text, no chevron, no tap target.
- Top 3 sheet (if somehow opened when empty) shows: "No analysts have 3+ resolved calls this week. Check back soon."

**Empty state B — no Big Call market today:**
- The BigCallCard component currently receives `market` as a required prop. If the Feed API returns no `bigCall` field (or `bigCall: null`), the component is not rendered at all — the card is simply absent from the feed.
- Decision locked: the Top Analyst footer is tied to the BigCallCard. If there is no BigCallCard, the footer does not render as a standalone element. The analyst leaderboard surface is the leaderboard tab, not a free-floating feed widget.
- This means: when `bigCall` is null, neither the card nor the footer renders. This is the correct behavior and requires no additional UI — just ensure the BigCallCard is conditionally rendered in the Feed render logic (verify this is already the case; if not, add the null guard).

**Acceptance criteria:**
1. Footer with "Not enough resolved calls yet" renders when API returns empty array.
2. The footer has no chevron and is not tappable in the empty state.
3. When `bigCall` is null on the Feed API response, BigCallCard is not rendered (null guard confirmed or added).

---

### S49-T7 (MEDIUM): Analytics instrumentation

**What to instrument (add to existing analytics/tracking layer — use the same `mobileApi.trackBigCallOpened` pattern for naming consistency):**

1. `analysts_footer_viewed` — fired when BigCallCard footer row is visible on screen (use `onLayout` or intersection observer equivalent — a simple approach: fire on render when data is loaded, not on scroll-into-view).
2. `analysts_footer_tapped` — fired when the footer row is tapped (before sheet opens).
3. `analysts_sheet_opened` — fired when Top 3 sheet is presented.
4. `analysts_sheet_row_tapped` — fired with `{ rank: 1|2|3, expertId }` when a row is tapped.
5. `analysts_leaderboard_link_tapped` — fired when "See full leaderboard →" is tapped.
6. `analysts_badge_tapped` — fired when `AnalystCredibilityBadge` `onPress` is invoked from any surface (include `{ surface: "feed_card" | "opinion_card" | "leaderboard" | "profile" | "bigcall_footer" }` in the event payload).

**Implementation note:** If the existing analytics layer is `mobileApi.track(eventName, payload)` or a similar thin wrapper, use that. If there is no general `track` method, add one to `apps/mobile/src/lib/api.ts` (POST to `/api/analytics/events` or log-only if no backend endpoint exists yet). CTO must check what analytics infrastructure exists before implementing.

**Acceptance criteria:**
1. All 6 events fire at the described interaction points.
2. No duplicate fires (e.g., `analysts_sheet_opened` fires once per sheet open, not on re-render).
3. TypeScript compiles without errors.

---

## Out of Scope — Explicitly Deferred

The following items were considered and are NOT in Sprint 49:
- **Tab bar reordering** — user decision: Feed-first IA preserved. Off the table.
- **Onboarding copy refresh** — backlog. Not Sprint 49.
- **iOS build / EAS Submit** — operational sprint needed separately, not a feature sprint.
- **Shareable win card** — remains a HIGH priority backlog item (Weak Spot 3 from audit).
- **Expert follow push notification** — remains HIGH backlog (Weak Spot 8).
- **Web landing page copy update** — 2-hour task, backlog.
- **Groups discovery** — backlog (Weak Spot 6).
- **Expert opinion pipeline health dashboard** — backlog (Weak Spot 4).
- **F1 work** — moratorium in effect per audit. Zero F1 tickets in S49-S51.

---

## Open Questions for CTO

1. **Expert accuracy data availability:** The `Expert` model has no `accuracyScore`, `weeklyHitRate`, or `analystTier` field. T1 computes accuracy at query time from `ExpertOpinion` resolution rows. For production this is fine with an index. However, if the Finance section's expert opinion API responses need to include `weeklyStats` for T3, this may require a second join on every opinion fetch. CTO must decide: (a) compute at query time with an index (acceptable for low-volume Finance section), or (b) add a `weeklyHitRate Float?` + `weeklyResolvedCount Int?` derived column to the `Expert` model populated by a nightly cron. Option B is safer at scale. CTO to flag if schema migration is needed — that extends T1's scope.

2. **Bottom sheet library:** Confirm whether `@gorhom/bottom-sheet` is installed in the Expo app. If not, the T5 sheet must use a `Modal` with animation. Check `apps/mobile/package.json`.

3. **Expert profile route:** Confirm the exact Expo Router path for an expert's profile page (likely `apps/mobile/src/app/expert/[id].tsx` or similar). T3 and T5 both need to navigate there.

4. **Finance opinions API response shape:** Does `/api/finance/opinions` (or the equivalent endpoint) currently return expert accuracy/tier data? If not, T3 will require a backend change in addition to the mobile change.

5. **Analytics infrastructure:** Does `mobileApi` already have a `track(event, payload)` method? T7 depends on this. If not, CTO must add a lightweight wrapper — recommend fire-and-forget POST to `/api/analytics/events` with no auth requirement (same pattern as `trackBigCallOpened`).

---

## Risk Callouts

**SEBI Research Analyst regulations — legal flag (ACTION REQUIRED FROM USER, not CTO):**
The GTM strategy document (locked 2026-05-06) explicitly flags: "SEBI Research Analyst regulations need outside-counsel review before public leaderboard launch." Sprint 49 surfaces a publicly visible "Top Analyst" ranking with named individuals and their firm affiliations (HDFC Securities, ICICI Direct). This is the exact scenario that triggered the legal flag. The BigCallCard footer and Top 3 sheet are public-facing, logged-out-visible surfaces. Before shipping T4/T5 to production, the user must confirm with outside counsel whether displaying a named accuracy ranking of SEBI-registered Research Analyst firms requires a RA license or disclosure. The CTO can build the feature; the legal clearance is a separate gate on production deployment.

**Schema migration risk:** If CTO elects Option B on open question 1 (add derived columns to Expert), that is a Prisma migration touching the Expert model. Standard precaution: do not run this migration in the same PR as other schema changes.

---

## Weak Spot Coverage Map — What Sprint 49 Addresses vs What Remains

| Weak Spot | Severity | Sprint 49 Status |
|---|---|---|
| WS1: Analyst Scorecard not visible in Feed | CRITICAL | PARTIALLY ADDRESSED — brand surfaces via BigCallCard footer + badge sweep without tab reorder |
| WS2: Leaderboard buried in nav | CRITICAL | PARTIALLY ADDRESSED — "See full leaderboard →" link provides a path; tab bar remains unchanged per user decision |
| WS3: No shareable win card | HIGH | NOT ADDRESSED — deferred |
| WS4: Expert opinion pipeline health | HIGH | NOT ADDRESSED — deferred |
| WS5: iOS does not exist | HIGH | NOT ADDRESSED — operational sprint needed |
| WS6: Groups have no discovery | HIGH | NOT ADDRESSED — deferred |
| WS7: Web landing page copy stale | MEDIUM | NOT ADDRESSED — 2hr task, deferred |
| WS8: Push loop thin for non-predictors | MEDIUM | NOT ADDRESSED — deferred |
| WS9: F1 sprint cadence drift | MEDIUM | ADDRESSED — moratorium declared, zero F1 tickets in S49 |

Sprint 49 moves the needle on WS1 and WS2 without the tab bar surgery. WS3 (win card) and WS5 (iOS) should be the top two candidates for Sprint 50 given their GTM leverage.

---

**Scope assessment:** 7 tickets is at the upper bound for a single sprint. T1 + T2 are the foundation; T3 through T5 are the delivery; T6 and T7 are polish. If sprint velocity is at risk, cut T7 (analytics) to Sprint 50 — instrumentation is valuable but does not block user-visible delivery. T6 (empty states) should NOT be cut — shipping without them means a broken UI when no qualifying analysts exist in the first week of rollout.

**Written:** 2026-06-07
**Next review:** After Sprint 49 delivery
