---
name: Sprint 34 — ExpertOpinionPostCard
description: S34-T1 redesigned Finance feed card (LinkedIn-style), feature flag, react-native-view-shot
type: project
---

S34-T1: Redesigned ExpertOpinionPostCard for the Finance feed.

**Files created/modified:**
- `apps/mobile/src/components/expert-opinion-post-card.tsx` — new standalone card
- `apps/mobile/src/lib/feature-flags.ts` — `USE_POST_CARD = true` constant
- `apps/mobile/src/components/expert-opinion-card.tsx` — flag-gated switch at top of component, legacy path preserved
- `apps/mobile/package.json` — added `react-native-view-shot ^5.1.0`

**Key design decisions:**
- Each opinion gets its own post card (no grouped bylines) when USE_POST_CARD=true — cleaner LinkedIn-like visual separation
- ShareView is rendered off-screen (position: absolute, top: -9999) via a sibling View node, not a Modal — avoids sheet flicker on share
- `captureRef(currentRef, ...)` not `captureRef(shareViewRef, ...)` — required to satisfy TS non-nullable constraint from react-native-view-shot
- Poll A is shown for PENDING opinions, Poll B replaces it for RESOLVED (Poll B returns null when isLocked=true, which is the PENDING case)
- "RESOLVED" stamp is a simple absolute-positioned View at top-right — no canvas/image manipulation needed
- Verdict badge label appends "· HIT" or "· MISS" on resolution; badge bg/border shift to success/failure tint

**Component hierarchy (new card):**
- ExpertOpinionPostCard (main export)
  - ExpertAvatar (initials fallback with deterministic color, or image)
  - AnalystTierBadge (reused from existing component)
  - ConsensusBar (duplicate of the one in news-feed-card.tsx — intentional, keeps card self-contained)
  - PollA (slider + submit, same logic as news-feed-card.tsx original)
  - PollB (HIT/MISS retrospective, hidden when isLocked)
  - ShareView (off-screen capture target with wordmark strip)

**Recon findings:**
- `ExpertOpinionRow` is a named export from news-feed-card.tsx (not a separate file)
- No `ExpertFollowButton` component exists — follow logic is inline in ExpertOpinionRow; replicated in post card
- `ApiExpertOpinionItem` has `instrument` and `instrumentTicker` fields (optional, nullable)
- `analystTier` and `hitRatePct` are not on ApiExpertOpinionItem — caller must pass them separately from profile/leaderboard data; in the current feed they are absent (props are optional, gracefully hidden)
- ConsensusBar is not a named export from news-feed-card.tsx — it's a local function. Replicated self-contained in the new card.
- `react-native-view-shot` was not installed; added as `^5.1.0`

**How to apply:**
- To revert to old design: set `USE_POST_CARD = false` in `src/lib/feature-flags.ts`
- To pass `analystTier` / `hitRatePct` in future: update the render site in finance-mode.tsx to pull from the expert profile data
