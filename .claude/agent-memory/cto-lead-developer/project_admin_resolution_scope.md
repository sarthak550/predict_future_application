---
name: Admin HIT/MISS Resolution UI — Scoping findings
description: Technical gaps, schema state, and architectural constraints discovered during scoping for the upgraded admin opinion resolution flow (India Analyst Scorecard repositioning)
type: project
---

An admin review UI exists at /admin/expert-opinions (S17-T2) but it is scoped only to PENDING opinions, has no pagination beyond a hard take:100 cap, no evidence URL field, no NOT_GRADED verdict, no filtering/sorting, no bulk actions, no re-open/reversal path, and no audit trail tied to AdminAction.

**Key schema facts:**
- `OpinionResolutionStatus` enum has 4 values: PENDING, RESOLVED_HIT, RESOLVED_MISS, NOT_GRADED. The admin UI only exposes 2 (HIT/MISS).
- `ExpertOpinion` has `resolutionNote String?` but NO `evidenceUrl` field. Adding one requires a schema migration.
- `AdminAction` model has no `expertOpinionId` FK — admin resolutions of opinions are not logged to the audit trail. This is a compliance gap.
- The resolve endpoint blocks re-resolution: `if (opinion.resolutionStatus !== "PENDING")` → 400. Reversal is impossible without direct DB access.
- Credibility score is computed on-read (not stored), derived from majority of Poll B (RETROSPECTIVE) votes on resolved opinions. Leaderboard has a 5-minute cache header. No background job — no stale cache invalidation needed.
- Web admin layout uses `requireAdmin()` which gates on Role.ADMIN or Role.MODERATOR. Auth model is already correct.
- Web client.tsx calls relative `/api/admin/...` proxy routes (not apps/api directly). All new admin actions must add corresponding proxy routes in apps/web/app/api/admin/.

**Why:** Scoping for the credibility loop — HIT/MISS verdicts at scale are the product moat. Manual curl calls are the current bottleneck.

**How to apply:** When building the upgraded admin UI, remember: (1) evidenceUrl needs a migration, (2) AdminAction needs expertOpinionId FK for audit logging, (3) the resolve endpoint needs to accept NOT_GRADED and allow re-resolution of already-resolved opinions (with a separate re-open action or an override flag), (4) all web admin pages must proxy through apps/web/app/api/admin/ not apps/api directly.
