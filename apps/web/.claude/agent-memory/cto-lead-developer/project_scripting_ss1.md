---
name: project_scripting_ss1
description: User Strategy Scripting Sprint SS1 (runtime + persistence core) — schema, CRUD, pure execution seam, Worker sandbox, PF_SIGNALS precomputed mode. Built 2026-08-04.
metadata:
  type: project
---

# User Strategy Scripting — Sprint SS1 (2026-08-04)

Program: [[project_scripting_program]] in the CEO's memory (3 briefs — SS1
runtime/persistence, SS2 editor UI, SS3 hardening+deploy). SS1 built code-complete,
all gates clean, NOT deployed (no `db push` run — that's the orchestrator's step).

## Critical schema-pair discovery (corrects prior memory)

`apps/web/prisma/schema.prisma` is NOT near-byte-identical to `apps/api/prisma/schema.prisma`
as SS1's own brief claimed as "verified ground truth" — it's a stale, drifted,
24-vs-64-model subset (confirmed missing `ChartDrawing` too, despite W1's own memory
claiming it was added to both). **It is never used for codegen.** Confirmed via:
- `apps/web/package.json` has no `predev`/`prebuild` prisma hook at all.
- `apps/web/Dockerfile` explicitly runs `npx prisma generate --schema apps/api/prisma/schema.prisma`
  with an inline comment: "apps/web has no prisma-generate hook of its own — it
  imports the workspace-hoisted client generated from apps/api's schema."
- Root `package.json`'s `prisma:generate` only targets `@predict-future/api`.

Both apps share ONE physical `@prisma/client` (hoisted npm workspace), always
generated from `apps/api/prisma/schema.prisma`. I still added `UserStrategyScript`
to BOTH schema files (cheap, matches house convention/brief instruction), but
`apps/web/prisma/schema.prisma`'s copy is cosmetic only — flag this to any future
CEO brief that assumes the pair is kept meaningfully in sync. See also
[[project_analyst_scorecard_phase1]] which found the same thing independently on 2026-07-20.

## V8 platform limits discovered building the error-line-correction feature

- `new Function(argNames, body)` internally wraps body as `function anonymous(<args>\n) {\n<body>\n}`
  — a stable **+2 line offset** before the body's own line 1, verified empirically,
  independent of arg count. Any `WRAP_LINE_OFFSET` must add this to the wrapper's
  own prologue line count, not just count the prologue.
- **V8 gives NO usable line/column for a `new Function`/`eval` SyntaxError** via any
  public API (`.stack`, `.message`, custom `Error.prepareStackTrace` CallSites all
  came back empty — verified with direct eval, indirect eval, `//# sourceURL` too).
  This is a genuine cross-engine platform limitation (no execution frame exists for
  a parse failure), not a workaround-able quirk. Fix: pre-parse the user's RAW source
  with `acorn` (already present in node_modules as a transitive dep of the build
  tooling; added as an explicit `apps/web` dependency) — its `SyntaxError.loc.line`
  is precise and needs no offset math since it parses the verbatim user text.
  Runtime errors (thrown from inside `run()`) DO get good stack info via
  `<anonymous>:LINE:COL` regex extraction — only PARSE-time errors have this gap.

## Denylist — two independent layers, by design

D2 says "the denylist lives ONLY in strategy-worker.ts" (real, permanent
`Object.defineProperty` against `self`, worker-boot-time). But the brief ALSO
wants a Node-testable structural+behavioral smoke test in `ta:check` — these two
requirements are reconciled with TWO layers sharing ONE key list (`DENYLIST_KEYS`,
defined once in `lib/ta/user-scripts.ts`):
1. `strategy-worker.ts` — real `Object.defineProperty(self, key, {configurable:false,...})`,
   permanent for that one worker instance's lifetime (safe because spawn-per-run
   tears the whole realm down after).
2. `buildWrappedSource()`'s template — LEXICAL shadowing (`const fetch = undefined;`
   etc., same trick the `console` shim already uses), applied fresh per `new Function()`
   call. Deliberately NOT `globalThis`-targeting `defineProperty` — that would
   PERMANENTLY poison the real global object for the rest of the Node process
   `ta:check` runs in (multiple fixtures share one process), which would be a real
   bug, not just untidy. Lexical shadowing has zero persistent side effects and is
   honestly weaker (bypassable via `eval("globalThis.fetch")`) — documented as such
   in both files' module docs. This is what makes the Node-side denylist fixture a
   REAL behavioral check (not just a string-grep) without being a security proof.

## chart-workbench.tsx hard-constraint collision (resolved without touching the file)

`chart-workbench.tsx` (forbidden file, owned by another engineer this sprint) has
ONE existing call site passing the legacy `{id, params}` shape (no `kind`) into
`KlineChart`'s `signalsConfig` prop. Widening that prop to `PfSignalsConfig`
(discriminated union) would have broken tsc on that untouched file. Fixed by
accepting `PfSignalsConfig | LegacyPfSignalsConfig | null` and normalizing
internally (`normalizeSignalsConfig`, `kline-chart.tsx`) — renamed the destructured
prop to `signalsConfigInput` and computed `const signalsConfig = normalizeSignalsConfig(...)`
as a local, so every downstream line (the effect body, `calc()` template branch)
stays byte-identical to pre-SS1 HEAD. `git diff` on `kline-chart.tsx` shows only 4
changed lines total (import, destructure rename, prop-type doc, key derivation) —
zero changed lines inside the effect's actual branching/createIndicator logic.
SS2 should update `chart-workbench.tsx`'s own call site to pass `{kind: "template", ...}`
directly and the legacy-shape alias can then be deleted.

## SCRIPT_SENTINEL relocated to avoid pulling klinecharts into Node

D9 wants `SCRIPT_SENTINEL` assertable from `ta:check` (Node/tsx) against
`STRATEGY_REGISTRY` for collision-safety. `pf-signals.ts` (where it conceptually
"lives" per the brief) imports `klinecharts`, which touches `window` at module-eval
time — importing it in plain Node/tsx is unsafe (confirmed: it also crashes Next's
SSR prerendering if statically imported from any non-`ssr:false` page, see below).
Fix: `SCRIPT_SENTINEL` is defined in `lib/ta/user-scripts.ts` (pure) and
`pf-signals.ts` does `export { SCRIPT_SENTINEL }` (re-export, not redefine) —
zero behavior change for existing consumers (`kline-chart.tsx` still imports it
from `pf-signals.ts`), but now `ta:check` can import it directly too.

## Temporary dev-only verification harness

`apps/web/app/dev/scripting-ss1-smoke/page.tsx` — NOT linked from any nav, exists
solely because `script-runner.ts`/`strategy-worker.ts` have zero reachable callers
this sprint (editor UI is SS2's job, hard constraint forbids wiring into
chart-workbench.tsx). Without SOME reachable entry point, webpack never builds the
worker's own chunk at all (dead-code-eliminated — confirmed by testing: a plain
`next build` with no harness produces zero worker-chunk output). This page is what
makes T2/T4/T5's browser-verification acceptance criteria checkable at all. Gotcha
hit building it: a static top-level import of anything touching `klinecharts`
(even just `setPrecomputedScriptSignals` from `pf-signals.ts`) crashes Next's
static-prerendering pass with `ReferenceError: window is not defined` — klinecharts
touches `window` at module-eval time, same reason `chart-workbench.tsx` is only
ever loaded via `next/dynamic(..., {ssr:false})`. Fixed with a dynamic `import()`
inside the click handler instead of a static import. **SS2 should delete this file**
once the real editor UI supersedes it as the manual-verification path.

**Known gap**: no browser-automation tooling (chromium-cli/playwright) was
available in this environment to actually click through the harness and observe
real Worker postMessage/terminate/timeout behavior — only verified up to the
HTTP-serving layer (worker chunk `4651.*.js` confirmed present + correct
content-type via a real `next start` production server, and via the Docker
`output: standalone` image). The actual click-through (hello-world round-trip,
3s-terminate timing, rapid-double-run supersede, Network-tab zero-fetch proof)
is the QA engineer's first real job on this ticket — the harness exists
specifically so that's possible.

## Numbers for the record

- `ta:check`: 124 -> 164 passed (40 new SS1 fixtures), 0 failed both before/after,
  confirmed a deliberately-broken fixture correctly produces non-zero exit.
- Engine selfcheck (`apps/api/scripts/verify-papertrading-engine.ts`, must run
  from `apps/api/` — repo-root invocation fails with a `@/` path-alias
  resolution error): 264/264 untouched.
- First Load JS: named shared chunks (`1528-*.js` 31.7kB, `1dd3208c-*.js` 53.7kB)
  byte-identical hash before/after (confirmed via `git stash` A/B build).
  `/paper-trading`, `/paper-trading/futures`, `/paper-trading/options` all
  unchanged byte-for-byte in size. "Shared by all" total shifted 87.4kB -> 87.6kB
  from Next's own routing-manifest bookkeeping (2 new API routes + 1 new dev page),
  not from app code landing in a shared chunk — confirmed via
  `app-build-manifest.json`: chunks 4651 (worker) and 5422 (user-scripts lib) are
  referenced ONLY by `/dev/scripting-ss1-smoke`, zero references from any
  paper-trading route.
