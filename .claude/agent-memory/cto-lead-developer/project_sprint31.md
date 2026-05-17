---
name: Sprint 31 implementation summary
description: S31 T1-T6 — Manifold integration quality, Markets discoverability, Saved markets
type: project
---

S31 all 6 tickets verified or implemented (2026-05-17).

**T1 (CRIT)** — Bulk-approve route was already implemented in a prior session:
- `apps/api/app/api/admin/markets/bulk-approve/route.ts` — POST, ADMIN/MOD auth, ids[] or originPlatform+status, cap 500, AdminAction per market, skips follower notifications for imported markets, idempotent.
- `apps/web/components/admin/bulk-approve-manifold-form.tsx` — "Approve all pending Manifold markets" button wired.
- `apps/web/app/(admin)/admin/moderation/page.tsx` — BulkApproveManifoldForm rendered.

**T2 (HIGH)** — Already implemented:
- Search bar in markets.tsx is always visible (no mode guard).
- `RelatedMarketsRail` component in `apps/mobile/src/app/market/[id].tsx` (line 2086+).

**T3 (HIGH)** — Already implemented:
- Trending carousel at top of Markets tab (public, live, not-search mode).
- Feather "trending-up" icon + horizontal ScrollView of 5 hero cards.
- State: trendingMarkets, loadingTrending.

**T4 (HIGH)** — Already implemented:
- `apps/mobile/src/components/market-summary-card.tsx`: host line hidden when `originPlatform != null`, "Source: Manifold ->" tappable attribution when `resolutionSourceUrl` present.

**T5 (MED)** — Implemented this session:
- Schema: `SavedMarket` model added to `apps/api/prisma/schema.prisma` with back-relations on User.savedMarkets and Market.savedByUsers. `prisma db push` run.
- `apps/api/app/api/markets/[marketId]/save/route.ts` — POST toggle, idempotent, 404 if market not publicly accessible.
- `apps/api/app/api/users/me/saved-markets/route.ts` — GET cursor-paginated, populates iSaved: true.
- `packages/types/src/index.ts` — `iSaved?: boolean` added to ApiMarketSummary.
- `apps/api/app/api/markets/route.ts` — now resolves viewerId once, batch-fetches SavedMarket for page, populates iSaved.
- `packages/api-client/src/index.ts` — `toggleSaveMarket(marketId)`, `getSavedMarkets(query)` added.
- `apps/mobile/src/app/(tabs)/markets.tsx` — StatusTab extended with "saved", savedMarkets state, loadSavedMarkets fetches /me/saved-markets, empty state: "Tap the bookmark icon on any market to save it for later."
- `apps/mobile/src/components/market-summary-card.tsx` — bookmark icon (Feather "bookmark") in topRowActions, optimistic toggle, accent color = saved.

**T6 (MED)** — Import run:
- `import-manifold-markets.ts --open-only --limit=500`: 300 new markets imported (all BINARY).
- Script mechanism filter updated: PSEUDO_NUMERIC markets use "pseudonumeric" mechanism not "cpmm-1".
- NUMERIC count = 0 (Manifold API's publicly accessible open markets are all BINARY in the pages we can fetch).
- `backfill-manifold-probability-history.ts --limit=200 --min-traders=5`: 194 markets backfilled, 7378 snapshots.
- 500 manifold markets remain in PENDING_REVIEW status — bulk-approve button in admin UI will approve them.

**Why:** Manifold PSEUDO_NUMERIC markets use "pseudonumeric" mechanism but the old filter only allowed "cpmm-1"/"cpmm-multi-1". Fix applied but no open NUMERIC markets surfaced in the fetch window.
