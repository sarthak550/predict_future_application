---
name: reference-prod-db-qa-methodology
description: How to safely run runtime QA against the live prod Neon DB with local dev servers — session minting, secret handling, test-data isolation, cleanup pattern.
metadata:
  type: reference
---

Established 2026-07-23 during the Paper Trading Phase 1 QA pass — reusable for any
future ticket whose QA brief says "verify against prod" instead of a local/seeded DB.

**Fetching secrets from EC2 without leaking them**: `DBURL="$(ssh ... | cut -d= -f2-)"`
then immediately write to a scratchpad file and only ever read it back via
`$(cat file)` inside a command substitution — never `echo "$DBURL"`. Same pattern for
`CRON_SECRET`. Verify you got something by printing only `${#VAR}` (length), never the
value.

**Running local dev servers against prod data**: `apps/api` on :3001 and `apps/web` on
:3000, both with `DATABASE_URL` overridden to the prod value via env var on the `next
dev` invocation (not written to any `.env` file — keeps it out of the working tree).
`apps/web` additionally needs `API_INTERNAL_URL=http://127.0.0.1:3001` for its loopback
proxy routes (LTP fetch, etc.) and `NEXTAUTH_URL=http://localhost:3000`. Source the
existing local `.env` first for `NEXTAUTH_SECRET`/other non-sensitive vars, then override
`DATABASE_URL`/`CRON_SECRET` after — `source apps/api/.env` can throw spurious "command
not found" for lines with special characters (e.g. `MSG91_AUTH_KEY`) but the server still
boots fine; confirmed harmless by checking the server actually serves real prod data
(e.g. a 200 with real instrument data) right after.

**Minting a real session cookie for apps/web's NextAuth (credentials/JWT strategy)**
without a browser: `GET /api/auth/csrf` with `-c cookiejar` to capture the CSRF cookie +
token, then `POST /api/auth/callback/credentials` with `csrfToken`, `email`, `password`,
`json=true` as form-urlencoded, `-b`/`-c` the same jar. Every subsequent authenticated
curl call just needs `-b cookiejar`. This is a real, unmocked auth path — it exercises
the exact same route apps/web's own sign-in page hits.

**Test-user isolation**: create the user directly via a disposable `npx tsx` script
placed INSIDE `apps/api/scripts/` (not the harness scratchpad — `tsx`'s module
resolution for `@prisma/client` needs to run from inside the workspace package that has
it installed) with an email under a clearly-fake domain (e.g.
`@papertrading-qa.test`). Delete the script file after use — it's not a deliverable,
leaving it in the tracked working tree just adds noise for the next `git status`.

**When a scenario needs backdated data to exercise a cooldown/aging code path** (e.g. a
30-day reset cooldown) it's fine to directly `UPDATE` a test-owned row's `createdAt`
via Prisma rather than waiting — it's a data mutation on a row you created and will
delete, not a code change, and it exercises the REAL route logic (the route still reads
the real `createdAt` and computes real eligibility) rather than mocking the function.

**When a market-hours (or similar wall-clock) gate blocks HTTP-level testing of OTHER
validation rules**: import the exact pure functions the route imports and reproduce its
conditionals against the real DB state in a throwaway script, OR (if the route needs to
write data you need for a later read-side test, e.g. "Calls I've traded" needs real
PaperOrder rows) insert the row directly via Prisma using the same cost/derivation
functions the write path would have called, then hit the REAL read endpoint over HTTP
with the real session cookie. Always state clearly in the report which method was used
for which check — don't blur "verified live over HTTP" with "verified via direct
function/DB exercise", the QA brief explicitly wants that distinction preserved.

**Cleanup is mandatory and must be proven, not asserted**: delete in FK-dependency order
(child rows → parent rows → root), then re-query counts for every deleted scope and
print them (expect 0). Also delete any throwaway scripts placed inside the tracked repo
(not scratchpad) — confirm with `git status --porcelain` afterward. Kill both dev server
PIDs (`lsof -ti :PORT -sTCP:LISTEN`) and confirm the ports are free.

**Connection interruptions mid-session**: dev servers launched with `run_in_background`
survive a harness reconnect — check `lsof -i :PORT -sTCP:LISTEN` and re-curl a known-good
endpoint before assuming anything died. The session cookie jar and any scratchpad state
also survive (files on disk). Don't blindly restart everything — verify first, since a
premature restart can double up test data creation or lose track of what's already been
seeded/cleaned.

**NEVER forward-date a global/account-scanning cron's `now` param** (learned the hard way
in [[project_paper_trading_phase3_qa]] — caused and had to remediate a real prod-data
incident). Backdating `now` into the PAST is always safe (a past date only ever matches
positions that are genuinely already due). Forward-dating `now` into the future on any
cron function that sweeps ALL accounts by a date match (no account-scoping param) will
find and act on OTHER real users' genuinely-not-yet-due data — a real mutation, not a
test artifact. If a future real listed-expiry/event date is genuinely needed (e.g. to
reach real market data that doesn't exist for "today"), either (a) run a cross-account
collision query first — `groupBy` the relevant date/kind columns across the WHOLE table,
not just your test account, and confirm zero other accounts have anything at that date
— or (b) skip the global-sweep entrypoint entirely and exercise only the underlying pure
functions plus direct single-account writes. If a global sweep with a forward `now` is
run anyway and touches a real account: check the blast radius immediately (query the
affected table by `createdAt` in the last few minutes ACROSS ALL accounts, not just
yours), and if a real account was hit, verify whether the affected model has any
separately-stored mutable state (e.g. a cash balance column) vs. being purely
ledger-derived — deleting the erroneous rows only fully restores state in the latter
case.

**Multiple Prisma schemas in one monorepo — only ever `prisma generate` from the
authoritative one.** If a stale/duplicate `prisma/schema.prisma` exists in another app
(e.g. `apps/web/prisma/schema.prisma` mirroring `apps/api/prisma/schema.prisma`'s hoisted
client output path), running `prisma generate` from the WRONG app silently clobbers the
shared `node_modules/.prisma/client` with the stale schema's types — both apps' dev
servers then run against a client missing whatever the authoritative schema just added
(discovered in [[project_paper_trading_phase3_qa]]: a Phase-3-added enum value vanished
from the generated client after generating from `apps/web`'s stale schema). Only run
`prisma generate` from the app whose schema is the source of truth (check the CTO's
memory notes for which one that is in this repo) — for every other app, just start its
dev server, never regenerate. If in doubt, `grep` the newest schema change's distinctive
string (an enum value, a new field) against `node_modules/.prisma/client/index.d.ts`
immediately after starting any server, before trusting it.
