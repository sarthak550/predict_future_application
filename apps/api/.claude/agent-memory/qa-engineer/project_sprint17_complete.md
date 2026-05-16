---
name: Sprint 17 complete — Finance polish + admin tooling
description: All 6 S17 tickets passed QA on 2026-05-03; key patterns observed
type: project
---

Sprint 17 passed QA on 2026-05-03. All 6 tickets done in one CTO pass.

**Key observations:**

- Admin web routes (suppress, verify, resolve) correctly use `getSession()` — these are web-only admin panel routes, not mobile-facing. Cookie auth is correct here. Do not flag admin-panel-only routes as Check A failures.

- `/api/finance/markets` does NOT return expertOpinions at all — the T2 suppressedAt filter requirement for that route was technically moot. The Finance tab fetches expert opinions via `getNews({ requireExpertOpinions: true })` which routes through `queries.ts` where suppressedAt IS filtered. Verified: `queries.ts:80` has `where: { suppressedAt: null }` and `queries.ts:126` has the `some: { suppressedAt: null }` guard.

- T4 chip navigates to `/(tabs)/finance` (a real dedicated Finance tab), not `/(tabs)/markets?mode=finance`. This is correct — CTO implemented Finance as a standalone tab, not a mode of Markets. Spec said "confirm exact param from S15-T3" which led CTO to use the dedicated tab route.

- `apps/web/lib/markets/create.ts:218` has a pre-existing TS error (`resolutionRuleText: string | undefined` not assignable to `string`). Not introduced by Sprint 17. Only `apps/web` has any TS errors; `apps/api`, `apps/mobile`, `packages/api-client`, and `packages/types` are all clean.

- The `news/[id]` API route correctly filters `suppressedAt: null` on expertOpinions included in the story response.

**Test account state (kira@example.com):** Server running on localhost:3001. Runtime auth checks were not possible due to sandbox curl restrictions (POST and authenticated requests blocked). Health check at /api/health returns 200.
