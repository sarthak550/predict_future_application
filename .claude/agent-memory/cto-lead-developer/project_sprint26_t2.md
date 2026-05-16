---
name: Sprint 26 T2 Comment Tips
description: S26-T2 Comment Tips mechanic — schema fields, tip route, daily cap pattern, mobile gift button
type: project
---

S26-T2 Comment Tips — COMPLETE (qa-review).

Schema additions:
- `tipsReceived Int @default(0)` on MarketComment
- `tipsReceivedTotal Int @default(0)` on User
- `TIP_GIVEN` / `TIP_RECEIVED` added to WalletTransactionType enum
- `COMMENT_TIPPED` added to NotificationType enum
- Applied via `prisma db push`

Key implementation decisions:
- Daily cap: 50 pts/day per tipper. Uses IST midnight boundary via `getIstDayBoundsUtc()` (same pattern as quests engine). TIP_GIVEN amounts stored as negative (debit); `Math.abs()` used for sum.
- Route: POST /api/comments/[commentId]/tip — returns 429 (not 400) for daily cap exceeded, per ticket spec.
- Single Prisma transaction: debit tipper wallet, credit commenter wallet, increment MarketComment.tipsReceived, increment User.tipsReceivedTotal, create COMMENT_TIPPED notification.
- Notification creation is wrapped in try/catch inside the transaction per systemic S24 rule.
- Mobile: fixed 5 pts default (no picker in v1). Gift icon (Ionicons `gift-outline`) visible on non-own comments only. Toast for success, Alert for daily cap error.
- Mobile comment item type extended with `tipsReceived: number` and `user.id: string` (needed for self-tip hide logic).

**Why:** How to apply: when adding any new tip-like mechanic, follow same pattern — IST day bounds for cap, negative TIP_GIVEN amount in wallet, try/catch notification inside tx.
