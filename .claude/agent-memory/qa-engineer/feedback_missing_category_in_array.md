---
name: Missing category in CATEGORIES constant — feature gating silently unreachable
description: S32-T3 failure pattern: FlagshipEventSection guarded by category === "FINANCE" but FINANCE was never added to CATEGORIES array
type: feedback
---

The CTO implemented a UI feature conditionally rendered when a specific category is selected, but forgot to add that category to the options array. The `FlagshipEventSection` in `create.tsx` only renders when `category === "FINANCE"`, but the `CATEGORIES` constant (line 33) never included `FINANCE` as a selectable option. TypeScript does not catch this because `AppMarketCategory` includes FINANCE as a valid type — the bug is purely a runtime data omission.

**Why:** This class of bug (gate logic added, gating option never added to selector) is invisible to tsc because both sides of the comparison are valid types.

**How to apply:** Whenever a ticket gates a UI section on a category/type/enum value, grep for that value in the selector/options array on the same screen. If the value is not in the array, the feature is unreachable. This must be checked explicitly — tsc will not catch it.
