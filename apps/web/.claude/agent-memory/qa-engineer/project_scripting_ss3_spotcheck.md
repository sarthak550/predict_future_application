---
name: project_scripting_ss3_spotcheck
description: User Strategy Scripting Sprint SS3 (security hardening) INDEPENDENT SPOT-CHECK — PASS 2026-08-04, all 4 sampled security-matrix items reproduced live with own Playwright run, diff-audit confirms SS1 sandbox untouched.
metadata:
  type: project
---

Independent spot-check (not full re-run) of the CTO's SS3 self-report
(`apps/web/.claude/agent-memory/cto-lead-developer/project_scripting_ss3.md`,
13/13 matrix claimed PASS). Full brief: CEO's
`cto_assignment_brief_scripting_ss3.md`. Depends on
[[project_scripting_ss2_qa]] (apps/web QA dir) and SS1 QA
(`apps/api/.claude/agent-memory/qa-engineer/project_scripting_ss1_qa.md`).

**Why a spot-check and not a re-trust**: this feature executes
user-written JS via a sandboxed Worker — the security boundary must not
rest on one agent's self-report, per explicit orchestrator instruction.

## Diff audit (own `git diff`, not trusted from the CTO's stat)

`git diff --stat` on the 6 named files: `+230 -24` — byte-for-byte matches
the CTO's claimed delta. Read every hunk in full (not just the stat):
`chart-workbench.tsx` is genuinely a 2-line prop-passing addition,
`user-scripts.ts` adds only `signalCapMessage()` + wires it into
`runScriptSync`'s `logs` (validation/truncation logic itself untouched),
`selfcheck.ts` adds exactly 3 new assertions to
`checkSignalCapTruncation`, `code-editor.tsx`/`script-editor-drawer.tsx`
add the Mod-Enter/Mod-S keymap plumbing described, `script-list-sidebar.tsx`
is the empty-state CTA + responsive Tailwind classes. Nothing outside
these 5 stated categories (shortcuts, cap log, empty state, responsive,
3 fixtures) appears anywhere in the diff.

**Sandbox core files**: `git diff fd7edd7 -- script-runner.ts
strategy-worker.ts` → **zero lines**, both against the prior commit AND
against the current working tree (no uncommitted changes either) — the
denylist (`Object.defineProperty(self, key, {writable:false,
configurable:false})` for `fetch`/`XMLHttpRequest`/`WebSocket`/
`EventSource`/`importScripts`/etc., 19 keys total) and the 3000ms
`RUN_TIMEOUT_MS` terminate logic are provably byte-identical to the
already-QA'd SS1/SS2 state. `packages/business-rules` and both
`prisma/schema.prisma` also confirmed empty-diff.

## Static gates, independently re-run

- `npx tsc --noEmit -p apps/web/tsconfig.json` — clean, zero output.
  Matches CTO claim.
- `npm run ta:check` (apps/web) — **195 passed, 0 failed**. Matches CTO's
  claimed 192→195 delta exactly.

## Live browser re-run (own Playwright session, not reused from CTO)

Playwright 1.62.1 + chromium binary were already present in
`~/Library/Caches/ms-playwright` and root `node_modules` (CTO's `--no-save`
install persisted at the hoisted root, as their memory documented) — no
reinstall needed, `package.json`/lock untouched (confirmed via `git status`
before/after). Fresh `rm -rf apps/web/.next`, fresh `npm run dev` for both
apps/web (3000) and apps/api (3001) — the candles-proxy-needs-both-servers
gotcha the CTO's memory flagged was real and confirmed again independently.

**Disposable account**: `ss3-spot@papertrading-qa.test` via the real
`/api/auth/register` endpoint (not a DB-direct insert) → real
`/sign-in` UI login → `/paper-trading` → searched+selected TCS →
"Maximize chart" → real `ChartWorkbench` with the `</> Scripts` button,
exactly as the CTO's memory described. Content was set via
clipboard-permission + paste (`ControlOrMeta+v`), following the CTO's own
documented gotcha (typing char-by-char corrupts brackets via
`closeBrackets()`) — confirmed this gotcha is real by reading
`code-editor.tsx` before writing the harness, not rediscovered the hard
way. Run button located via `getByRole('button', {name: /^Run$|^Running…$/})`
and clicked via `el.evaluate(el => el.click())` (bypasses Playwright's
actionability/scroll-intersection check, which the CTO's memory correctly
flags as unreliable against this app's `position: fixed inset-0`
taller-than-viewport workbench layout — confirmed this is a real
Playwright/layout quirk, not assumed).

**All 4 sampled checks reproduced independently, own measured numbers**:

| Check | CTO's claimed number | My independently measured number | Verdict |
|---|---|---|---|
| [a] zero-network (fetch/XHR/WebSocket/EventSource/importScripts/`globalThis.fetch`/`new Function` all typeof undefined, canary-hostname requests) | all `typeof...undefined`, 0 canary requests | all `typeof...undefined`; every call attempt (`fetch(...)`, `new XMLHttpRequest()`, `new WebSocket()`, `new EventSource()`) **threw** (`"X is not a constructor"`/`"fetch is not a function"`); `page.on('request')` canary-hostname hits = **0** | MATCH |
| [b] infinite-loop terminate | 3053–3066ms across 3 runs | **3028ms** (1 run), console showed the exact `SCRIPT_TIMEOUT_MESSAGE` | MATCH (same ~3000ms window) |
| [c] rapid double-Run final state (chose this over forged-postMessage, task said pick one) | final settled state = 2nd run's real result, Run re-enabled, never stuck on "superseded" | Trades stat = `1`, Run button text = `"Run"` (not `"Running…"`), `disabled=false` | MATCH |
| [d] 25k-signal cap log line | `"Signal cap reached — showing the first 20,000 of 25,000 signals."` | **byte-identical string** rendered in the drawer's console panel | MATCH |

Zero `pageerror` events across the whole session. Zero TypeScript/build
noise.

## Cleanup (verified, not assumed)

Deleted the disposable user via a throwaway `tsx` script hitting Prisma
directly (`prisma.user.delete`) — first confirmed **0** saved
`UserStrategyScript` rows existed (never clicked Save, only Run, across
all 4 checks) via a count query, then confirmed post-delete
`findUnique` returns `null` (cascade verified working, not assumed from
the schema annotation alone). Scratch Playwright files
(`apps/web/.qa-ss3-scratch/`) `rm -rf`'d. Both dev servers killed,
`apps/web/.next` removed again at session end (this repo's own documented
stale-dev/prod-mix trap). `git status` at close shows only the same 6
pre-existing SS3 product-file diffs this session started with — nothing
new added or left behind.

## Verdict

**PASS.** No contradiction found anywhere between the CTO's SS3 report and
this independent spot-check — diff scope, sandbox-untouched claim, both
gate numbers, and all 4 sampled live-browser security checks all
independently reproduced with matching (or tighter) evidence. Full 13-item
matrix was NOT re-run (out of scope per the task — this was an explicit
spot-check, not a re-run) — items 4, 6-12 remain trusted from the CTO's
report only.
