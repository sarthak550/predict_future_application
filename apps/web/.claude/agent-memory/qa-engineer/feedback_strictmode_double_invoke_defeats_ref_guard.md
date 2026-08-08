---
name: feedback_strictmode_double_invoke_defeats_ref_guard
description: An isFirstRender-style useRef guard meant to skip an effect's FIRST invocation does not protect against React 18 StrictMode's dev-only double-invocation of the same render's mount effects — both invocations share the same stale closure, and the guard only blocks the first of the pair, not the second. Caught re-testing the Scripts drawer console-height persistence race, 2026-08-05.
metadata:
  type: feedback
---

**Pattern to grep for**: a `useRef(false)` guard used like
`if (!ref.current) { ref.current = true; return; }` at the top of a
dependency-array effect, specifically to make that effect a no-op on the
component's initial mount (skip logic that would otherwise act on a stale
pre-restore value) while still running normally on later real changes.

**Why this fails under React 18 + Next.js App Router's default
`reactStrictMode: true`**: in dev, React intentionally double-invokes a
component's INITIAL mount effects — run all mount effects once, immediately
run their cleanups, then run all mount effects again — specifically to help
developers catch effects that aren't idempotent/side-effect-safe. Both
invocations of that pair operate on the exact SAME render's closure (no new
render happens between them), so any state/props/derived-values the effect
closes over are IDENTICAL and STALE across both calls. A `useRef` guard
persists across this synthetic unmount/remount (refs are tied to the fiber,
not the effect invocation), so it correctly treats invocation #1 as "the
first" and skips it — but WRONGLY treats invocation #2 as "a real
subsequent change" and runs the full body, still against the same stale
closure invocation #1 was meant to protect against.

**Concrete case**: `apps/web/components/paper-trading/workbench/user-scripts/script-editor-drawer.tsx`'s
`[drawerHeight]` sync effect, guarded by `drawerHeightSyncedOnceRef`, meant
to skip its own body on mount (since the mount-restore effect above it
already handles the correct one-time clamp using a local, non-stale value).
StrictMode's double-invoke makes the SECOND of the two synthetic mount
firings slip through the guard, recompute `computeConsoleMaxHeight` against
the STALE pre-restore `drawerHeight` (the default, not the just-restored
value), and PERSIST the corrupted result to localStorage before the real
subsequent re-render (with the correct restored height) even lands — and by
then the corrupted value already satisfies the new clamp, so nothing
self-heals. Reproduced live 3/3 runs by instrumenting `localStorage.setItem`
to count calls: exactly TWO identical corrupting writes per cold load,
matching the double-invoke theory precisely (a single-stale-invocation
theory would only predict one).

**How to apply**: when reviewing (or QA-verifying) a fix that adds an
`isFirstRender`/`ranOnceRef`-style guard specifically to prevent an effect
from acting on a stale value during mount, check whether this repo runs dev
with StrictMode (`next.config.mjs`'s `reactStrictMode` — App Router defaults
to `true` unless explicitly overridden). If so, that guard pattern is
insufficient by itself. The robust fix is almost always to eliminate the
cross-effect staleness window entirely rather than guard around it — e.g.
merge the two effects into one (so there's no second effect that could ever
see an intermediate stale state), or derive the value via `useMemo` from
current render state instead of an effect's closure, using an effect only
for the persistence write with a value-equality check. Always test with a
REAL dev server (`next dev`, StrictMode default-on) rather than assuming a
guard is correct from a code read alone — this class of bug is invisible in
a plain code review and only shows up live.

**Related**: [[feedback_prisma_server_restart]] and other "code looks right,
only breaks live" entries in this file — same broader lesson that dev-mode
runtime behavior (StrictMode, stale Prisma client, etc.) can silently defeat
a fix that reads correctly on paper.
