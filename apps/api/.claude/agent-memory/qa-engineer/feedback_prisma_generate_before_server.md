---
name: Prisma generate must precede server start when new models or fields are added
description: Any route using a newly-added Prisma model or field returns 500 if prisma generate was not run; this has now occurred in S28-T1 and S30-T1 (second attempt) — treat as systemic CTO blind spot
type: feedback
---

When the CTO adds a new Prisma model OR a new field to an existing model, `npx prisma generate` MUST be run before submitting for QA, AND the dev server must be restarted. If the server is running with a stale generated client, all `prisma.<model>.*` calls that reference the new model/field return HTTP 500.

Additionally: new models MUST have a proper migration file (npx prisma migrate dev --name ...). Using `prisma db push` bypasses the migrations system — the table exists in the DB but the dev server's Prisma client (generated AFTER db push) may still be stale if the server was not restarted.

This has now occurred THREE times:
- S28-T1: ExpertFollow model added, generate not run, all /api/finance/experts routes returned 500.
- S30-T1 (second QA attempt): reasoningUpvotes field added to MarketPosition, ReasoningUpvote model added, generate not run, /api/profile/me returned 500.
- S31-T5: SavedMarket model added WITHOUT a migration file; prisma generate ran at 04:15 but dev server started at 03:30 with old client; all SavedMarket endpoints (POST /api/markets/[marketId]/save, GET /api/users/me/saved-markets, authenticated GET /api/markets) returned 500.

**Why:** The Node.js module system caches the Prisma client at import time. A new model/field only appears in the client after `prisma generate` rewrites the generated types in `@prisma/client`. The dev server's in-memory client has no knowledge of the new model/field until generate is run and the server restarted.

**How to apply:** During QA static checks — before running runtime checks — for any ticket that adds a new Prisma model:
1. Check if a migration file exists: `ls /Users/sarthak/predict_future/apps/api/prisma/migrations/ | sort` — if no migration for the new model, FAIL immediately.
2. Verify node_modules/@prisma/client/index.d.ts contains the new model: `grep -c "SavedMarket" /Users/sarthak/predict_future/node_modules/@prisma/client/index.d.ts`. If count is 0, flag as FAIL.
3. Check server start time vs prisma generate time: if server started before prisma generate ran, the client is stale.

**Escalation:** THREE occurrences now. This is a confirmed systemic CTO blind spot. Must be flagged in every QA report that touches schema changes. The CTO must add a pre-submission checklist step: (1) prisma migrate dev, (2) prisma generate, (3) restart dev server. Consider recommending this be added to CLAUDE.md.
