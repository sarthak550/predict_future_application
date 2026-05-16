---
name: Prisma generate must precede server start when new models or fields are added
description: Any route using a newly-added Prisma model or field returns 500 if prisma generate was not run; this has now occurred in S28-T1 and S30-T1 (second attempt) — treat as systemic CTO blind spot
type: feedback
---

When the CTO adds a new Prisma model OR a new field to an existing model, `npx prisma generate` MUST be run before submitting for QA. If the server is running with a stale generated client, all `prisma.<model>.*` calls that reference the new model/field return HTTP 500.

This has now occurred twice:
- S28-T1: ExpertFollow model added, generate not run, all /api/finance/experts routes returned 500.
- S30-T1 (second QA attempt): reasoningUpvotes field added to MarketPosition, ReasoningUpvote model added, generate not run, /api/profile/me returned 500.

**Why:** The Node.js module system caches the Prisma client at import time. A new model/field only appears in the client after `prisma generate` rewrites the generated types in `@prisma/client`. The dev server's in-memory client has no knowledge of the new model/field until generate is run and the server restarted.

**How to apply:** During QA static checks — before running runtime checks — verify that node_modules/@prisma/client/index.d.ts contains references to every new model and field added in the ticket. Use `grep -c "<new-field>" /Users/sarthak/predict_future/node_modules/@prisma/client/index.d.ts`. If count is 0 and the schema has the field, flag as FAIL with the instruction: "CTO must run `cd apps/api && npx prisma generate` and restart the dev server." Do not wait for a 500 to surface this.

**How to apply at escalation level:** This is now a systemic CTO blind spot (2+ occurrences). Include a warning in QA reports that the CTO should add `prisma generate` to their local submission checklist (e.g., a pre-push hook or documented step in CLAUDE.md) before this happens on a third ticket.
