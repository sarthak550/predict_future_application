---
name: project_scripts_dashboard_round3_pass_2026_08_06
description: Scripts drawer (script-editor-drawer.tsx merged-effect fix) and dashboard bug-trio (paper-trading-dashboard.tsx architectural round-3 fix, URL no longer a persistence channel) — BOTH PASS on round-3 re-test, 2026-08-06, live Playwright with history-API instrumentation. Both tickets cleared for commit+deploy.
metadata:
  type: project
---

## Round 3 verdict: PASS on both tickets (after 2 prior FAIL rounds each — see [[feedback_strictmode_double_invoke_defeats_ref_guard]] and [[feedback_remountkey_self_defeating_strip_cascade]] / [[feedback_url_state_priority_chain_self_lock]] for the round-1/round-2 history).

### Ticket 1 — script-editor-drawer.tsx (StrictMode-idempotent merged effect)

Fix shape: the mount-restore effect and the `[drawerHeight]` sync effect were
merged into ONE effect, keyed on `[drawerHeight]`, gated by a `hasRestoredRef`
(not a value-based guard). Critically, a SEPARATE `drawerHeightRef` mirrors
the true current height, written synchronously at every site that calls
`setDrawerHeight` (mount-restore branch, `handleDrawerResizeEnd`,
`handleDrawerResizeReset`, the window-resize self-heal effect) — the merged
effect's "sync" branch reads `drawerHeightRef.current`, NEVER the
`drawerHeight` closure argument, so a StrictMode double-invoke replay of the
same stale mount commit reads the ALREADY-correct ref value on its second
firing and reproduces a no-op (`next === current`), not a corrupting write.

Verified live (fresh `next dev`, StrictMode default-on, real Playwright,
`localStorage.setItem` instrumented via `context.addInitScript` monkey-patch):
- Seeded `drawerHeight=480`/`consoleHeight=200`, cold load at viewport
  h=900: drawer clamps to 380px (`clampDrawerHeight(480,900)`), console
  EXPANDED content clamps to exactly 150px (`computeConsoleMaxHeight(380)`)
  — both match the CTO's own worked example precisely.
- Zero extra `setItem` calls to either storage key beyond the initial seed
  — the old bug's signature (two corrupting writes of "130") did NOT
  reproduce. Bug 2 (console-height persistence race) is genuinely closed.
- Drag all 3 handles (drawer/sidebar/console) to non-default values (460/
  240/148) → `page.reload()` → byte-exact localStorage match, confirmed.
- 750px-tall viewport: drawer clamps to 230px, canvas bottom (494) vs
  drawer top (520) = 26px gap (no collision), `elementFromPoint` at the
  handle's own center resolves to the handle div (not the canvas — the
  old bug's exact failure signature), a real `dblclick()` reset works.
- Static gates: `tsc --noEmit` clean, `eslint` exit 0 on all 3 files,
  `ta:check` 514/514.

### Ticket 2 — paper-trading-dashboard.tsx + use-workbench-url-param.ts (architectural fix: URL is no longer BOTH persistence store and one-shot input)

Fix shape: `?symbol=` deleted entirely as a persistence channel — focused
symbol persists to `localStorage` only (`LAST_FOCUSED_SYMBOL_KEY`), written
synchronously by every changer. No more page-level `remountKey` wrapper — a
SINGLE effect keyed on the live `searchParamsString` is the sole consumer of
one-shot deep-link fields (`side`/`productType`/`quantity`/`symbol`/
`linkedOpinionId`): applies them to state, bumps a monotonic `armToken`
(folded into the ticket's `key`), then strips the URL — all in one effect,
so it can fire again for a later deep link without any remount mechanism.

Verified live (real Playwright, `history.pushState`/`replaceState`
instrumented via `context.addInitScript` monkey-patch, kira's account
seeded with 3 real DELIVERY holdings via the REAL `computeOrderCosts`/
`fetchDelayedLtp`/`getOrCreateActiveAccount` code path — market was closed
at IST 00:40, matching [[project_delivery_sell_button_2026_08_04]]'s own
documented workaround):
- Search A(RELIANCE)->refresh->B(TCS)->refresh->C(INFY)->refresh: each
  step's localStorage correctly updates AND restores; **zero**
  `pushState`/`replaceState` calls fire during search-select at all (no URL
  channel exists anymore to race) — B1 (cross-effect same-commit clobber)
  is closed by construction, not by out-ordering.
- Same-page Sell row1 (RELIANCE) then row2 (TCS, IDENTICAL qty=5): each
  click produces a clean `pushState`(full deep-link)->`replaceState`(bare
  strip) pair — no second spurious remount/strip cascade. Ticket correctly
  re-arms SELL/qty=5 for the NEW symbol both times (verified via the real
  `<select>`/`<input placeholder="Qty">` DOM values, not just the URL).
  B2 (remountKey self-defeating strip cascade) is closed by DELETING the
  remount mechanism entirely, not patching it.
- Refresh after Sell: ticket reverts to BUY default, symbol persists (TCS),
  no `side=` in the URL, localStorage focus = TCS. Confirmed.
- `search-select` -> 0 `GET /api/paper-trading/account` refetches.
- `?workbench=1` still round-trips a hard refresh correctly (equality-
  gated write in `setWorkbenchOpen` didn't break the positive case).
- Empty-account first visit (maya@example.com, 0 paper-trading accounts,
  fresh browser context / no localStorage): zero page errors, "Search a
  symbol to start trading" shown correctly, no crash.
- Futures/options genuinely untouched by round 3 — confirmed via BOTH
  `git diff`/file mtime (last modified Aug 4, before round 3's Aug 6
  00:14-00:27 edits) AND a live refresh check on both pages (`?focus=`
  persists correctly, zero page errors).
- Static gates: `tsc --noEmit` clean, `eslint` exit 0, `ta:check` 514/514.

### Two soft findings, NEITHER blocking (both confirmed unreachable via any real UI entry point — did not fail the ticket over them, flagged for CTO awareness only)

1. **`linkedOpinionId`-only deep link permanently suppresses the bootstrap
   fallback.** The deep-link effect sets `bootstrappedRef.current = true`
   unconditionally whenever ANY one-shot key is present in the URL — even
   `linkedOpinionId` alone, with no `symbol=`. Since the bootstrap-fallback
   effect early-returns once `bootstrappedRef` is true, a symbol-less
   `linkedOpinionId` deep link leaves `focusedSymbol` `null` forever (stuck
   on the "Search a symbol" empty state) even when the user has a real
   localStorage-remembered focus and real holdings — live-reproduced.
   BUT: grepped every real call site that ever builds a `linkedOpinionId=`
   link in this codebase (`paper-trade-cta.tsx` line 74, `calls-traded-
   list.tsx` line 161) — both ALWAYS include `symbol=` alongside it. This
   exact shape (opinion id with no symbol) never occurs from any button/
   link in the app; only a hand-crafted/bookmarked URL could trigger it.
   Latent, not reachable, not a round-3 regression (this exact effect
   architecture is new in round 3, but the underlying "should a bare
   opinion-only link still resolve a fallback symbol" question was never
   addressed either way in round 2). Worth a one-line fix later
   (`bootstrappedRef.current = true` only when `symbol` truthy OR treat
   linkedOpinionId-only as "apply but don't suppress bootstrap") but not
   worth blocking this ticket over.
2. The "workbench open + Sell-elsewhere" race I was worried about from a
   pure static trace (two effects, `focusedSymbol` change triggering
   `useWorkbenchAutoRestore`'s close-write in a LATER commit than the
   deep-link effect's own strip-write, both reading `window.location.
   search` fresh) turns out to be **structurally unreachable**: the
   maximized workbench renders `fixed inset-0 z-50`, physically covering
   the holdings tables / Sell links beneath it — a user cannot click Sell
   while the workbench modal is open, confirmed by attempting exactly this
   in Playwright (click intercepted by the workbench overlay). Cold-load
   deep links always start with `workbenchOpen=false` at mount. No live
   test needed beyond confirming unreachability.

### Cleanup (verified)

Seeded 3 disposable `PaperOrder` rows (RELIANCE/TCS/INFY, qty=5 each) on
kira's ALREADY-EXISTING generation-3 ACTIVE account (confirmed via a
pre-check that this account had 0 orders before seeding) using the real
cost/pricing code path, market-hours gate bypassed only at the DB-write
call site (same documented workaround as
[[project_delivery_sell_button_2026_08_04]]). Deleted all 3 by symbol
match post-test — confirmed 0 orders remaining on the account (no need to
archive/reset since the account had no pre-existing orders to disturb).
All 5 disposable `apps/web/scripts/qa-*.ts` files removed. Scratch dir
`.qa-round3-retest-2026-08-06/` removed (login sessions for kira + maya,
screenshots, history-API test scripts). Both dev servers killed (ports
3000/3001 confirmed free), `apps/web/.next` wiped again per this repo's
standing stale-dev/prod-mix trap.

**Login methodology note for future rounds**: this app's `/sign-in` page is
a real NextAuth `CredentialsProvider` form (`getByPlaceholder("you@example.com")`
/ `getByPlaceholder("••••••••")` / `getByRole("button", {name:"Sign in"})`),
not a magic-link or SSO flow — `context.storageState()` after login+
`waitForTimeout(1000)` correctly captures `next-auth.session-token`
(saving too early, right after `waitForURL`, can race the cookie landing —
add the extra wait). kira@example.com/Password123! has real paper-trading
holdings; maya@example.com/Password123! has ZERO paper-trading accounts —
useful as the "empty account" test user without needing to archive kira's.

**Prisma model location gotcha**: `apps/web`'s own `prisma/schema.prisma`
has NO `PaperTrading*`/`PaperOrder` models at all — those live in
`apps/api/prisma/schema.prisma`. `apps/web`'s generated `@prisma/client`
still resolves them at runtime (monorepo node_modules hoisting), so
`prisma.paperTradingAccount`/`prisma.paperOrder` work fine from
`apps/web` scripts — just don't `grep apps/web/prisma/schema.prisma` for
these model shapes, check `apps/api/prisma/schema.prisma` instead.

**Related**: [[feedback_url_state_priority_chain_self_lock]],
[[feedback_frozen_params_needs_remount_wrapper]],
[[feedback_remountkey_self_defeating_strip_cascade]],
[[feedback_strictmode_double_invoke_defeats_ref_guard]] — the round-1/
round-2 failure history this round-3 pass finally closes out.
