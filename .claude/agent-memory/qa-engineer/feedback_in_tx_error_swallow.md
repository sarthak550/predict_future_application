---
name: In-transaction side-effect must be wrapped in try/catch
description: Any non-critical side-effect (quest engine, notifications, analytics) called inside a Prisma transaction MUST be wrapped in try/catch or the parent transaction rolls back on side-effect error
type: feedback
---

When a side-effect function is `await`-ed bare inside a `prisma.$transaction(async (tx) => { ... })` block, any throw from that function causes Prisma to roll back the ENTIRE transaction — including the user's primary action (bet, vote, market create).

**Why:** S24-T4 (2026-05-06) — CTO wired `checkAndCompleteQuests(userId, action, tx)` inside the position/vote/market-create transactions without wrapping in try/catch. If the quest engine throws (DB error, wallet not found, notification create failure), the user's bet rolls back and they get a 400 error for what should have been a successful action.

**How to apply:** For every new side-effect function called inside a Prisma transaction:
1. Ask: "If this throws, should the parent action (bet/vote/market) fail?"
2. If NO (quest rewards, notifications, analytics, audit logs) → wrap in `try { await sideEffect(...) } catch (e) { console.error('[context]', e); }`
3. If YES (wallet debit, position creation itself) → no wrapping needed.

Pattern for safe in-tx side effects:
```typescript
// CORRECT — quest failure does not roll back the bet
try {
  await checkAndCompleteQuests(user.id, "PREDICTION", tx);
} catch (e) {
  console.error("[quest engine] non-fatal error:", e);
}

// WRONG — if quest engine throws, the bet rolls back
await checkAndCompleteQuests(user.id, "PREDICTION", tx);
```

Files to audit on every ticket touching in-transaction side effects:
- apps/api/app/api/markets/[marketId]/positions/route.ts
- apps/api/app/api/markets/[marketId]/vote/route.ts
- apps/api/lib/markets/create.ts
