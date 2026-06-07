---
name: project_sprint42_bundle_b
description: S42 Bundle B — schema hotfix: multiChoicePositionId FK, ExpertOpinion index drift, externalLastSyncedAt, referral race, tip TOCTOU — all qa-review
metadata:
  type: project
---

Sprint 42 Bundle B — 4 schema-touching tickets in one migration (`s42_hotfix_schema`).

**T1 — Multi-choice payout P2003 fix**
- Added `WalletTransaction.multiChoicePositionId String?` FK to `MultiChoicePosition` with `onDelete: SetNull`
- Added back-relation `MultiChoicePosition.walletTransactions WalletTransaction[]`
- Added `@@unique([walletId, marketId, type, multiChoicePositionId])` to WalletTransaction
- Extended `createUniqueWalletTransaction()` to accept `multiChoicePositionId?` and prefer it over `positionId` when set
- Changed CANCELLED refund path and winner-payout path to use `createUniqueWalletTransaction` with `multiChoicePositionId: position.id`
- Files: `apps/api/prisma/schema.prisma`, `apps/api/lib/markets/payouts.ts`

**T3 — ExpertOpinion unique index drift**
- Migration only: drops COALESCE-based functional index, recreates as plain `("expertId", "storyId", "quoteHash")`
- Schema was already correct (`@@unique([expertId, storyId, quoteHash])` plain). No schema.prisma change needed.
- File: migration SQL only

**T6 — Manifold sync staleness**
- Added `Market.externalLastSyncedAt DateTime?` to schema
- Migration backfills `= updatedAt` for all existing Manifold markets
- `sync-manifold-resolutions` cron now filters by `externalLastSyncedAt IS NULL OR < 6hAgo`, stamps `externalLastSyncedAt = new Date()` after each sync
- File: `apps/api/app/api/cron/sync-manifold-resolutions/route.ts`

**T8 — Tip TOCTOU + referral double-credit**
- Tip cap: added `SELECT ... FOR UPDATE` on `Wallet` row at start of `$transaction` to serialise concurrent tips from same user
- Referral: added `User.referralBonusCreditedAt DateTime?` to schema; replaced count-gate with `user.updateMany({where:{id, referralBonusCreditedAt:null},...})` atomic claim; `claimResult.count === 1` gates the credit
- Migration backfills `referralBonusCreditedAt = NOW()` for users who already have a `REFERRAL_BONUS_REFEREE` transaction
- Files: `apps/api/app/api/comments/[commentId]/tip/route.ts`, `apps/api/app/api/markets/[marketId]/positions/route.ts`

**Migration**: `apps/api/prisma/migrations/20260524000006_s42_hotfix_schema/migration.sql`

**Important context**: Working tree is HEAD + large stash of uncommitted Sprint 38-41 changes. The schema in working tree is missing many fields that exist in the stash (`notifiedAt`, `analystCallAt`, `headline`, `preprocessAttempts`, `quoteHash`, etc.). Pre-existing TypeScript errors (~40) from those stash-only fields are NOT caused by S42 work. S42-specific files all compile cleanly.

**Why:** The S38-T12 migration changed the multi-choice settlement code path to pass `positionId: position.id` where `position` is a `MultiChoicePosition`, but the FK targets `MarketPosition`. P2003 on every multi-choice settle. referral/tip races can cause 2x bonus/cap bypass under concurrent requests.
