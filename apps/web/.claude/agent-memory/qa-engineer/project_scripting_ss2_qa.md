---
name: project_scripting_ss2_qa
description: User Strategy Scripting Sprint SS2 (CodeMirror editor drawer UI) QA — PASS 2026-08-04, curl-level runtime + full static/code-trace verification; live in-browser click-through still deferred to SS3 (no Playwright).
metadata:
  type: project
---

SS2 (CodeMirror 6 bottom drawer: code-editor.tsx, script-editor-drawer.tsx,
script-list-sidebar/toolbar/console.tsx, drawer-resize-handle.tsx,
draft-storage.ts, user-scripts-api.ts, lib/ta/example-scripts.ts, plus
chart-workbench.tsx/strategy-panel.tsx/selfcheck.ts widening) verified PASS.
Full brief: [[cto_assignment_brief_scripting_ss2]] (CEO memory). CTO build
notes: `apps/web/.claude/agent-memory/cto-lead-developer/project_scripting_ss2.md`.
Depends on [[project_scripting_ss1_qa]] (apps/api QA dir) — SS1's runtime
core (`lib/ta/user-scripts.ts`, `script-runner.ts`, `strategy-worker.ts`)
was NOT touched this sprint (confirmed via `git diff --stat`, zero hunks).

**File-scope discipline** (per [[feedback_verify_file_scope_not_just_diff_stat]]):
this tree had a large unrelated concurrent diff (apps/api Manifold-market
routes, apps/mobile market/[id].tsx, dozens of untracked CEO/CTO memory
files from other programs). Scoped to exactly the CEO brief's named files
via `git status --short` + `find`, not trusted from any file count.

**Static (all independently re-run, not trusted from the CTO's report)**:
`tsc --noEmit` clean for both apps/web and apps/api (re-ran a second time
with `.next` fully absent, not just after a stale build, to rule out the
CTO's own documented `.next/types` staleness gotcha from the deleted
`/dev/scripting-ss1-smoke` page — clean both times). `eslint` clean (exit 0,
zero output) across all 9 new files + 3 modified files. `ta:check` 192/192
(matches the CTO's claimed delta of +10 from SS1's 182). Engine
`verify-papertrading-engine.ts` 264/264, untouched.

**Lazy-chunk discipline (D2/D3), re-measured independently in DEV mode
(not a `next build`, per this session's explicit no-build constraint)**:
grepped the whole repo — zero static `codemirror`/`@codemirror/*` imports
outside `user-scripts/code-editor.tsx`; `chart-workbench.tsx` reaches the
drawer only via `next/dynamic(..., {ssr:false})`; zero page-level file
under `app/` imports the drawer/editor directly. Live-server proof: started
a fresh `npm run dev` (after `rm -rf .next`, this repo's own documented
stale-build trap), fetched `/paper-trading`'s initial HTML + its `page.js`
bundle — zero references to `codemirror`/`script-editor-drawer` in either;
`.next/react-loadable-manifest.json` (dev's own version of the artifact,
same inspection method W2 established) shows the drawer as a SEPARATE
manifest entry from `chart-workbench.tsx`'s own existing entry, proving
2-level nesting; fetched the drawer chunk directly (200, contains
`EditorView`/`EditorState` — real, not empty) and separately fetched the
`chart-workbench.tsx` chunk and confirmed its one "codemirror" string hit
was the file's OWN JSDoc prose ("never statically imports... `codemirror`"),
not actual bundled CodeMirror code — a real false-positive catch, not
assumed clean from a raw grep count.

**Single-mount + independent-stats contract (code trace)**: `[Ticket |
Chain | Strategy]` tab machinery (`rightPanelTab`, `hasOpenedStrategyTab`,
`chainLabel`) — zero diff hunks touch these lines at all (confirmed via
`git diff`, not just eyeballing). The Scripts drawer is a wholly separate,
full-width block using the identical sticky-mount-then-CSS-toggle pattern
(`hasOpenedScriptDrawer`/`scriptDrawerOpen`). `StrategyConfigPanel` and
`StrategyDisclaimerFooter` (both call sites, verified by line) are wired
exclusively to `strategyRunResult` (template-only React state);
`script-editor-drawer.tsx`'s `scriptRunResult` is a fully separate
`useState` — the two producers cannot corrupt each other's stats card.
`activeSignalsSource` ("template"|"script"|null) is the ONLY thing that
decides which producer's markers paint the shared `PF_SIGNALS` chart
instance — "last run wins" is scoped to chart markers alone, confirmed
correct via `handleClearSignals` only resetting `activeSignalsSource` when
it was `"template"`, never touching a live script run's markers.

**Honesty + safety (code trace)**: disclaimer text in `script-toolbar.tsx`
character-matches the brief's D8 quote verbatim. Examples are read-only via
a CodeMirror `Compartment` toggle (`readOnly: openScript.kind === "example"`)
— Run/Save disabled, only Duplicate-to-edit active, confirmed in both
`script-toolbar.tsx`'s mode branch and `script-editor-drawer.tsx`'s
`handleRun`/`handleSave` early-returns. Autosave (`draft-storage.ts`) uses
localStorage exclusively inside `useEffect`s (after mount), same idiom as
every other persisted preference in this file family — no SSR-mismatch
risk (component is `"use client"` throughout regardless). Discard
(`handleDiscardDraft`) calls the real `clearScriptDraft`, verified by
reading the call, not assumed from the name. **Zero `eval`/`new Function`/
`.exec(` anywhere in the 9 new SS2 files** (grepped) — Run still routes
through SS1's real `runUserScript` (spawn-per-run Worker, 3s terminate),
confirmed by import + call-site read, no parallel/bypass execution path
introduced.

**Runtime (curl-level, dev server)**: `/paper-trading`, `/paper-trading/
futures`, `/paper-trading/options` all 200 (note: NOT `/futures`/`/options`
at the repo root — the actual route nesting, caught my own first curl
attempt's 404 before concluding anything). `GET /api/user-scripts`
anonymous → 401 `{"error":"Authentication required."}` (this route uses
web-only `getSession()`, which is CORRECT here — apps/web is NextAuth
session-cookie auth, not the mobile Bearer-JWT architecture; this route
was untouched by SS2 regardless, committed under SS1). `GET /dev/
scripting-ss1-smoke` → 404 (deleted page confirmed gone, not just
code-deleted but actually unreachable).

**Explicitly NOT verified this sprint (same gap SS1 documented, unchanged)**:
live in-browser click-through — opening the drawer, writing a script from
scratch, clicking Run, watching markers actually paint; opening an Example,
confirming visual read-only state, Duplicate-to-edit; triggering a live
syntax error/3s timeout and reading the console strip; the draft
restore-prompt's actual on-screen appearance after a real page reload;
switching Strategy tab ↔ script run and eyeballing the chart doesn't
flicker/corrupt. No Playwright available in this env, same constraint SS1
hit. This task's own explicit scope (VERIFY items 1-6) only asked for
curl/manifest-level runtime checks, not a browser matrix — consistent with
the brief's own SS1 precedent of deferring the full live matrix to SS3.
Whoever picks up SS3 should treat this as a real, still-open gap across
BOTH sprints, not a formality.

**Methodology note**: killed the dev server and `rm -rf .next` again after
verification (this repo's own documented stale-dev/prod-mix trap — see
[[feedback_stale_next_dev_prod_mix]] — leaving a `.next` around after a
`next dev` session risks the NEXT session that runs `next build` or a fresh
`next dev` hitting confusing artifacts).
