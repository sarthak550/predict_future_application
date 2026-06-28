---
name: project-sprint57
description: S57 Member self-service — leave group, transfer ownership, archive. 5 tickets, no schema changes. All COMPLETE.
metadata:
  type: project
---

Sprint 57 — Member Self-Service: Leave, Transfer, Archive (2026-06-07)

All 5 tickets implemented. No schema changes needed.

## Files created
- `apps/api/app/api/groups/[id]/leave/route.ts` — POST leave route
- `apps/api/app/api/groups/[id]/transfer-ownership/route.ts` — POST transfer route
- `apps/api/app/api/groups/[id]/archive/route.ts` — POST archive route

## Files modified
- `apps/api/lib/groups/service.ts` — added GroupServiceError class + leaveGroup, transferOwnership, archiveGroup service functions
- `apps/api/app/api/groups/[id]/route.ts` — added isArchived guard (returns 404 for archived groups)
- `packages/validation/src/group.ts` — added transferOwnershipSchema
- `packages/api-client/src/index.ts` — added leaveGroup, transferOwnership, archiveGroup methods
- `apps/mobile/src/app/group/[id].tsx` — replaced handleLeave stub, added handleArchive, updated openAdminActions with owner-only Transfer + Archive entries, added Leave button for MEMBER status in JoinCTA
- `apps/mobile/src/app/group/[id]/members.tsx` — added transfer mode (mode=transfer param), banner, Make Owner button, empty state, handleTransferTo

## Key decisions
- Outgoing owner after transfer → ADMIN (not MEMBER). Rationale: retains moderation power for cleanup.
- Transfer transaction: prisma.$transaction([...]) array form — 3 ops atomic: demote caller, promote target, update Group.ownerId.
- Archive preserves all GroupMembership rows. isArchived=true is the sole tombstone.
- Archive NOT reversible in v1. // S58 if needed.
- GET /api/groups/[id] now gates on isArchived (was missing before S57).
- T5 choice: sheet on existing members screen (not new screen) via mode=transfer query param. Matches existing members screen pattern; no new file needed.

## Error codes
- leave: 400 not_member, 403 banned, 404 group_not_found, 409 owner_must_transfer_or_archive
- transfer: 400 self_transfer, 400 ineligible_target, 403 forbidden, 404 group_not_found
- archive: 403 forbidden, 404 group_not_found (200 idempotent if already archived)

**Why:** [[project-sprint56]] wired join-request growth (real users discovering groups). Those users need a clean exit. Ownership transfer closes the sole-OWNER walk-away gap.
**How to apply:** GroupServiceError typed errors are the pattern for all group service throws going forward. Route handlers switch on err.code.
