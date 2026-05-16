---
name: Multi-choice settlement netGain guard missing
description: S24-T10 failure — settleMultiChoiceMarket called updateLeagueMonthPoints without if (netGain > 0) guard; binary/numeric had it correctly
type: feedback
---

In settleMultiChoiceMarket (payouts.ts), the CTO called `updateLeagueMonthPoints(entry.userId, netGain, tx)` at line 805 without checking `if (netGain > 0)` first.

The binary settlement at line 562 and numeric settlement at line 450 both correctly guard with `if (netGain > 0)`. The multi-choice path was inconsistent.

**Why:** AC explicitly says "only positive deltas pass to updateLeagueMonthPoints." Passing 0 or negative values to a points-increment function is semantically wrong and can result in incorrect league standings.

**How to apply:** On every new market type settlement function, verify the netGain guard is present before calling updateLeagueMonthPoints. Also check that createNotification + refreshUserStats in settlement loops are try/caught.
