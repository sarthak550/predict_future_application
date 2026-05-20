---
name: Computed field computed but not returned in API response shape
description: S32-T4 failure pattern: expertCount computed/available inside helper but omitted from results.map() return object
type: feedback
---

The `computeExpertProbability` function in `flagship-events/route.ts` knows how many expert positions exist (it filters them and checks `length < 3`) but does not return that count. The `results.map()` block returns `expertProbability` but never includes `expertCount`. The mobile component then falls back to `expertCount ?? 0` and always displays "Experts (0):" even when real experts exist.

**Why:** The helper function was written to return only the probability map (or null). The count is a side-effect of computing it. When the outer code forgets to extract and forward the count, TypeScript does not complain because `expertCount` is typed as optional in `ApiFlagshipEvent`.

**How to apply:** When a ticket spec says "return X alongside Y", check both the helper function signature AND the final return object in the route. An optional type in the TypeScript interface means the field can be absent — it does NOT guarantee the API returns it. Always verify the `results.map()` return object includes every field the spec requires.
