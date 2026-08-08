---
name: project_scripting_ss1_qa
description: User Strategy Scripting Sprint SS1 (runtime + persistence core) QA — PASS 2026-08-04, browser-level checks explicitly deferred to SS3 (no Playwright available to either CTO or QA).
metadata:
  type: project
---

SS1 (schema+CRUD, `lib/ta/user-scripts.ts` pure seam, `strategy-worker.ts` Worker
sandbox, `script-runner.ts` orchestration, `PF_SIGNALS` precomputed-script mode)
verified PASS against a real local dev server + real seeded sessions. Full brief:
[[cto_assignment_brief_scripting_ss1]] in the CEO's memory; CTO's own build notes:
`apps/web/.claude/agent-memory/cto-lead-developer/project_scripting_ss1.md`.

**What was verified live (HTTP, real NextAuth sessions minted via the credentials
csrf flow, two disposable `@papertrading-qa.test` accounts, deleted after)**:
full CRUD round-trip (create/list-with-source/rename-collision 409/oversize-source
400/update/delete/404-after-delete), cross-user PATCH+DELETE both 404 (row proven
untouched by re-listing as the owner before the real delete), anonymous 401 on
all 4 methods, 51st-script 422 (looped 49 creates to reach the 50-cap, confirmed
count stays at 50, then deleted all 50 + both accounts — zero DB leftovers
proven via a `findMany` count query, not asserted).

**What was verified via Node (`ta:check`, `verify-papertrading-engine.ts`, tsc, a
throwaway scratch script)**: `resolveSignalsAgainstBars` genuinely pulls
price/timestamp from `bars[index]` only (`RawScriptSignal` has no such fields to
trust even if a script tried); `WRAP_LINE_OFFSET` arithmetic independently
re-derived via the REAL exported `runScriptSync`/`toScriptError` (not a
hand-rolled regex re-implementation — my first attempt at this scratch-verified
wrong because I reimplemented the extraction logic instead of calling the real
function; redid it correctly, see [[feedback_call_real_exports_not_reimplementations]]);
worker chunk (`_app-pages-browser_..._strategy-worker_ts.js`) confirmed as its
own separate async chunk, served 200, zero sync-page references (`grep`
`react-loadable-manifest.json` + `app-build-manifest.json`); `pf-signals.ts`/
`kline-chart.tsx` template branch confirmed prepend-only via `git diff` (the
existing `calcParams`-construction line is byte-identical, only relocated after
a new early-return); dev-harness `notFound()` production guard read at the top
of the component body.

**Baseline note**: `ta:check` is 182/182 (not the 164 named in the original
brief) — a concurrent, unrelated "tool-values-gap-fixes" sprint added 18 more
fixtures mid-session and landed as commit `8c077a1` while this QA pass was
running. Confirmed by the orchestrator mid-session; do not flag 182 as a
discrepancy in future re-reads of this file.

**Explicitly NOT verified — no browser automation available to either the CTO
or QA this sprint** (`npx playwright --version` needs a full download in this
env; per brief, did not spend the session installing it): the actual
click-through in `apps/web/app/dev/scripting-ss1-smoke/page.tsx` — hello-world
round-trip, infinite-loop ~3s `terminate()` timing, rapid-double-run supersede,
zero-network-requests-during-execution (Network tab), and the live pixel-level
"existing template strategy renders identically pre/post SS1" regression the
brief explicitly calls a live check, not a diff check. These are SS3's mandatory
matrix per the brief's own text and remain open — flag clearly to whoever picks
up SS3 that this is a full gap, not a formality.

**Methodology gotcha this session** — a stale `.next` mixed dev+production-build
state, see [[feedback_stale_next_dev_prod_mix]].
