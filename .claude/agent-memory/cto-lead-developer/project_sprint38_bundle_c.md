---
name: project_sprint38_bundle_c
description: S38 Bundle C (T6/T10/T11/T12): wallet double-spend guard, BigCallTap idempotency, AI retry cap, WalletTransaction unique idempotency — all qa-review
metadata:
  type: project
---

S38 Bundle C all four tickets implemented and in qa-review.

**Migration:** Single migration `20260524000002_s38_wallet_guard_big_call_tap_opinion_retry_idempotency` applied via `db push` (shadow DB was broken — `migrate dev --create-only` failed with P3006). Applied cleanly; 0 duplicate WalletTransaction rows found before unique constraint.

**T6 — Wallet double-spend guard:**
- Binary positions: removed pre-tx balance read; replaced `wallet.update(decrement)` with `wallet.updateMany(where: balance >= amount)` + count===0 throw.
- Multi-choice: removed balance check outside tx; same guarded updateMany inside tx.
- Tip route: removed pre-tx fast-fail check; guarded updateMany inside tx + INSUFFICIENT_BALANCE error code.
- DB CHECK constraint: `ALTER TABLE "Wallet" ADD CONSTRAINT wallet_balance_nonnegative CHECK (balance >= 0)`.

**T10 — big-call-tap + news/debug gates:**
- `big-call-tap`: requires `getUserIdFromRequest`; uses `BigCallTap` model (@@unique userId+marketId+dateIST). Unique violation returns `{ alreadyTapped: true }` without incrementing counter.
- `news/debug`: requires `getUserIdFromRequest` + DB role check for ADMIN or MODERATOR.
- New `BigCallTap` model in schema with `getIstDateString()` for dateIST.

**T11 — AI retry cap:**
- Added `preprocessAttempts Int @default(0)`, `lastPreprocessAttemptAt DateTime?`, `resolutionAttempts Int @default(0)`, `lastResolutionAttemptAt DateTime?` to ExpertOpinion.
- Phase 1: increments counter before AI call; on 5th failure sets NOT_GRADED permanently.
- Phase 2: same cap with resolutionAttempts; also skips Pass 1 when instrument+instrumentTicker+resolutionWindowDays all cached.
- `evaluateOpinionResolution()` now accepts `instrument?` and `instrumentTicker?` params; when all three cache fields present, bypasses the Pass 1 AI call entirely.

**T12 — WalletTransaction idempotency:**
- `@@unique([walletId, marketId, type, positionId])` added to WalletTransaction schema.
- `settleMultiChoiceMarket` CANCELLED path (line 724 area) now uses `createUniqueWalletTransaction` with positionId.
- `settleMultiChoiceMarket` WIN path (line 829 area) now uses `createUniqueWalletTransaction` with positionId.

**Why:** `db push` (not `migrate dev`) was used because shadow DB was at an older migration baseline (MarketCategory enum missing). Migration file was created manually then marked applied with `prisma migrate resolve`.

**How to apply:** When touching wallet balance debit in any future route, always use the `updateMany(where: balance >= amount)` + count check pattern. Never use raw `wallet.update(decrement)` for staking flows.
