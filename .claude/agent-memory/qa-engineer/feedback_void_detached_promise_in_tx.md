---
name: void-detached-promise-in-closed-transaction
description: void promise.catch() inside a Prisma transaction callback silently fails — tx is closed before detached promise runs
type: feedback
---

A `void asyncFn(tx).catch(handler)` call inside a function that is itself `await`-ed inside a Prisma `$transaction()` callback will silently fail.

**Why:** When the outer async function returns (its promise resolves), the Prisma transaction commits and closes the `tx` client. The detached promise launched via `void` is still queued in the microtask queue and will try to use the now-closed `tx`. All DB operations will throw "Transaction already closed" or similar, which is silently swallowed by `.catch()`. The side-effect never actually executes.

This is distinct from the S24-T4 pattern (bare await inside tx rolling back on side-effect failure). This pattern (void+catch) looks safe from rollback but in reality silently no-ops because the tx is already done.

**Caught at:** S24-T5 — `apps/api/lib/stats.ts:232` — `void checkStreakMilestone(userId, streakData.current, tx).catch(...)`. The streak milestone payout never executes because `refreshUserStats` is always awaited inside a `$transaction()` callback.

**How to apply:** When reviewing any function called inside a Prisma transaction: if it uses `void asyncFn(tx).catch(...)` for a side-effect, flag it as a race condition. The correct pattern is `try { await asyncFn(tx); } catch (err) { console.error(err); }` which keeps the call atomic inside the open transaction. If truly non-atomic side-effects are needed (e.g., push notifications), they must be called AFTER the transaction resolves, using the raw `prisma` client.
