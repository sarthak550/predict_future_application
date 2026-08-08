---
name: project_trading_terminal_sprint_a_qa
description: Trading Terminal UI Overhaul Sprint A QA — first pass FAIL (Express re-arm guardrail bypassed by the T6 searchParams-remount trade-off), CTO fix re-verified by code-read same day — overall PASS 2026-07-25, deploy unblocked. Premium capture pipeline, index intraday, todayNetPnl, deep-links, P1-P3 regression all verified clean live against prod DB.
metadata:
  type: project
---

Runtime QA for Trading Terminal UI Overhaul Sprint A (CEO brief
`cto_assignment_brief_trading_terminal_ui.md`, CTO notes
`project_trading_terminal_sprint_a.md`) ran against the LIVE PROD Neon DB via
[[reference_prod_db_qa_methodology]]. **First-pass verdict: FAIL** — one
blocking bug in the Express mode guardrail, everything else clean. **CTO
fixed same day; re-verified by code-read → overall verdict flips to PASS,
deploy unblocked.** See the fix-verification section below the original
findings.

**THE BLOCKING BUG — Express's "explicit re-tap to re-arm" guardrail is
silently bypassed by the T6 remount trade-off.** `options-page-client.tsx`'s
outer `OptionsPageClient` keys `OptionsPageClientInner` on
`searchParams.toString()` (a deliberate, documented trade-off so a NEW
deep-link gets a fresh `autoSelectedRef` instead of being swallowed by a
stale one-shot guard). `useExpressMode()`'s mount effect
(`use-express-mode.ts`) re-arms automatically whenever `storedEnabled &&
document.visibilityState === "visible"` at mount time — with NO way to
distinguish "first-ever navigation to this terminal" from "an internal
remount triggered by a searchParams change while the user never left the
page." Since `armed` is plain `useState(false)` local to the mounted
instance (no sessionStorage/module-level backing), a full remount always
wipes AND re-derives it from the persisted `enabled` preference. Concretely:
Express idle-disarms after 30 minutes of no order activity (tab stays
visible the whole time, so the visibility-based disarm never fires) →
`armed` correctly becomes `false` → user taps ANY position chip's Sell link
in `PositionsStrip` (always visible, bottom-pinned, present on the options
terminal) → the Sell link's query params differ from the current URL →
`searchParams.toString()` changes → `OptionsPageClientInner` remounts →
`useExpressMode()`'s mount effect sees `enabled=true` (untouched by the idle
disarm) and tab visible → silently sets `armed=true` again → the very next
ladder `[B]`/`[S]` tap instant-fires with **zero explicit re-arm tap**,
directly violating the spec's own words: "Re-arming after any disarm
requires an explicit `arm()` call... NEVER automatic, including a
hidden->visible transition after the initial mount." This is a real,
ordinary-usage path (idle-then-Sell-an-existing-position is a completely
plausible flow for an active options trader), not a contrived edge case, and
it defeats the exact risk class ("left it on... fat-fingered a stale
session") the guardrail exists to prevent on a feature whose own spec calls
fills immutable/undoable. Verified by code trace only (deterministic from
`options-page-client.tsx` line 103's `key={searchParams.toString()}` +
`use-express-mode.ts`'s mount-effect `useEffect(..., [])` — no live UI
exploit needed, and none attempted since Saturday/no-live-poll-data made an
end-to-end browser repro low-value relative to the code-level certainty).

**Fix shape for the CTO (not prescriptive, just the gap):** `armed`'s
re-arm-on-mount logic needs to distinguish "this browser tab's first mount
of the terminal this visit" from "an internal remount of the SAME visit." A
`sessionStorage` flag (cleared only on true tab close, distinct from the
`localStorage` preference) or lifting `armed` out of the remount boundary
(e.g. into a ref/context that survives the `key` change, only reset on an
actual tab-visibility-hidden or true top-level page navigation) would both
work — the CTO should pick, this note is scoped to identifying the gap.

**Everything else verified clean, live, against prod DB:**

- **Premium capture pipeline (T3)** — schema matches brief exactly (verified
  `grep` on `prisma/schema.prisma`). Cron auth: wrong secret 401, correct
  secret on a Saturday returns `{ok:true, ranOutsideMarketHours:true,
  snapshotsWritten:0}` — clean self-gated no-op, not an error. Lib-level
  `runPremiumCapture(now)` exercised with a backdated `now` (safe — this
  function only READS PaperOrder and WRITES unowned market-data rows, never
  an account-mutating global sweep, so the forward-date incident class from
  [[project_paper_trading_phase3_qa]] doesn't apply here at all) against a
  REAL live NIFTY chain: wrote exactly 22 rows (11 strikes × CE/PE) for ATM
  23750 ± 5×50 against a live spot of 23767.45 — ATM±5 selection confirmed
  exact. Recently-viewed candidate path confirmed independently of the
  open-position path: a fresh script process (empty in-memory
  `recentlyViewedCache`) with a seeded real BANKNIFTY open position (BUY leg
  written via the same `computeOptionOrderCosts` derivation the real route
  uses, since Saturday blocks HTTP order placement) correctly found it via
  `collectOpenPositionCandidates()`'s DB scan alone — 22 more rows, exact
  ATM±5 again. That same run also picked up a REAL other production
  account's already-open NIFTY position via the same union-across-accounts
  scan (expected, by design — the whole point of the candidate set is "every
  account," and this is read-only + writes only unowned shared market data,
  no risk to that account). Prune cron: seeded one row at capturedAt=50 days
  ago, ran with `CRON_SECRET`, `deletedCount: 1` exactly, the 66 recent rows
  untouched — reverified by direct count. All `OptionPremiumSnapshot` rows
  (0 before this session, table is brand-new) deleted at cleanup, reverified
  0.
- **Index intraday (T2)** — NIFTY and BANKNIFTY both return real multi-point
  series (376 points each) via both the apps/api route and the apps/web
  proxy; response shape (`symbol, prevClose, points, asOf, sessionLabel,
  volume`) byte-identical key set to the existing equity intraday route's
  shape (diffed both directly). Invalid symbol (FINNIFTY, GARBAGE) → clean
  400 on both apps/api and the proxy passthrough.
- **`todayNetPnl` (T4/T5)** — fresh account starts at exactly 0. Seeded a
  REAL option BUY (live chain premium, real `computeOptionOrderCosts`) placed
  "today" moved `todayNetPnl` to exactly `-totalCosts`. Then seeded a SECOND
  real equity DELIVERY BUY with `createdAt` explicitly backdated to
  yesterday (same derivation function, safe pattern — a row this session
  owns and deletes, not a global sweep) — `todayNetPnl` stayed byte-identical
  (`-39.966294173`, unchanged) while `lifetimeNetPnl`/`lifetimeCostsPaid`
  moved to include both orders' costs (`48.269876173` = `39.966294173 +
  8.303582` exactly). Confirms the diff-of-two-replays exclusion filter
  (`createdAt < istDayStartAsUtcInstant()`) is correct.
- **Deep-links (T4-T8)** — all five URL shapes (`/paper-trading` bare +
  `?symbol=&side=&productType=&linkedOpinionId=`, `/paper-trading/options`
  bare + `?underlying=&optionType=&linkedOpinionId=` +
  `?underlying=&expiry=&strike=&optionType=&side=SELL`) return 200 over real
  authenticated HTTP. Code-read confirms every param threads into
  `OptionChainBrowser`'s `initial*` props and the one-shot
  `autoSelectedRef`/`handleChainData` auto-select logic exactly as before —
  that part of the T6 remount trade-off works as documented. Only the
  Express side of that same trade-off is broken (see the bug above).
- **P1-P3 regression** — `option-trade-panel.tsx`'s diff is a pure
  extraction (`submitOptionOrder()` in the new
  `lib/paperTrading/optionOrdersClient.ts`), same route
  (`/api/paper-trading/options/orders`), same payload shape, zero drift
  (diffed line-by-line). `option-chain-browser.tsx`'s polling/flash/ATM/
  deep-link/expiry logic is byte-unchanged — only the cell markup became a
  premium value + `[B]`/`[S]` chip pair, `[S]` correctly `disabled` when
  `heldLots === 0`. `paper-trading-dashboard.tsx` still has "Calls I've
  traded" nav, reset button (unmodified `handleReset`), Options nav link, and
  `OrderHistoryTable`/`OptionPositionsTable` reading the SAME
  `account.recentOrders`/`account.optionPositions` shape as before.
- **Static footguns** — `tsc --noEmit` clean on `apps/api`, `apps/web`, and
  `packages/business-rules` (all exit 0, empty output — note: must run from
  EACH app's own directory with an explicit `-p tsconfig.json`; running from
  the repo root silently resolves to nothing since there is no root
  `tsconfig.json`, giving a false-clean read the first time). `eslint` clean
  on every changed/new file in both apps (explicit exit-code check, not just
  empty-output — empty output can also mean the glob matched zero files, as
  it did once here with an unescaped `[symbol]` path segment). Both
  `app/paper-trading/page.tsx` and `app/paper-trading/options/page.tsx` wrap
  their `useSearchParams()`-reading client component in `<Suspense>`.
  `terminal-shell.tsx` has no `"use client"` and no hooks — correctly a pure
  layout primitive, not a server→client leak (it just renders whatever
  ReactNode props it's handed). New `findMany` calls: the
  `eod-series` route is `take: 260`-bounded and symbol-scoped;
  `premiumCapture.ts`'s `collectOpenPositionCandidates()` does an unbounded
  full-table scan for "every account with any option order ever" then an
  unbounded per-account order fetch — same judgment call already accepted in
  [[project_paper_trading_phase3_qa]] for this domain's volume, not flagged
  as a new violation of [[feedback_api_select_clause]].

**Methodology notes for next time:**
- `tsc --noEmit -p tsconfig.json` run from the WRONG cwd (e.g. repo root,
  which has no `tsconfig.json` of its own) fails with `TS5058: path does not
  exist` but a careless `| tail -N` pipeline can swallow that error text
  entirely, making it look like a clean pass. Always check the exit code of
  `tsc`/`eslint` itself (capture to a file first, or `echo EXIT:$?`
  immediately after the direct command, never after a pipe) — don't trust
  empty tail output alone.
- `/tmp` is NOT writable in this harness's sandbox for redirect targets
  (`read-only file system`) — always redirect command output to the
  session's own scratchpad path, not `/tmp`.
- Test user + accounts created via the REAL `/api/auth/register` HTTP route
  cascade-delete cleanly through a single `prisma.user.deleteMany` (Wallet,
  UserStats, Notification, PaperTradingAccount → PaperOrder are all
  `onDelete: Cascade` from User down to PaperOrder) — no need to manually
  delete each table in FK order for this domain specifically, unlike some
  other tables in this schema. Verified by explicit before/after counts.
- `OptionPremiumSnapshot` (this sprint's new table) has zero FK to any
  account — it's fine to `deleteMany({})` the WHOLE table at cleanup as long
  as you proved the count was 0 at the start of the session (confirmed here)
  — no risk of deleting a real row that predates your session, since there
  were none.

Test user (`qa-tt-2607@papertrading-qa.test`, id
`cms04nthw00006i6sm7gxhi9u`), its account
(`cms04pdzf00066i6skr9u9cbe`, 2 seeded orders), and all 66
`OptionPremiumSnapshot` rows produced this session were deleted; reverified
0/0/0/0 via direct count. All three throwaway
`apps/api/scripts/qa-tt-*.ts` scripts deleted; `git status --porcelain |
grep qa-tt` empty. Both dev servers (ports 3000/3001) killed and reverified
free. Scratchpad secret files (prod DB URL, CRON_SECRET, session cookie jar)
deleted at session end.

## Fix re-verification (same day, 2026-07-25) — PASS, overall verdict flips

CTO fix: `useExpressMode()` moved OUT of the remounted
`OptionsPageClientInner` into the stable outer `OptionsPageClient` wrapper
(`options-page-client.tsx:130-134`); the resulting `ExpressModeState` is
threaded down as a prop (`express`). `use-express-mode.ts` itself is
byte-unchanged (confirmed — same `setArmed` call sites at the same line
numbers as the pre-fix read: mount effect L103, hidden-disarm L120,
idle-disarm L129, toggle-tap L154/L161/L165, acknowledge L174).

Re-verified by code-read only (deterministic, same method as the original
finding — no live browser repro needed either time):

1. **Blocking trace closed.** The ONLY `setArmed(true)` call sites in the
   whole file are: the one-time mount effect (now inside the OUTER
   component, which does not carry a `key` tied to `searchParams` and so
   does NOT remount on an internal deep-link navigation), and the two
   explicit-tap paths inside `handleToggleTap` (off→on, disarmed→re-arm) plus
   `confirmAcknowledgementAndEnable` (acknowledgement modal confirm). None of
   these fire as a side effect of `OptionsPageClientInner` remounting. Grepped
   every `setArmed`/`.armed`/`handleToggleTap` reference across
   `components/paper-trading/` to confirm no other call site exists anywhere
   in the diff. Idle-disarm → Sell-chip tap → inner remount now correctly
   leaves `armed` at its already-`false` value, requiring an explicit re-tap.
2. **Benign case confirmed as coded, and the reading is accepted.** Armed →
   immediate Sell-chip tap with no disarm event → `armed` persists across the
   remount, because it's the OUTER component's stable state passed down as a
   prop, and the outer component itself never unmounts on an internal
   searchParams change. This is a legitimate reading of the spec: the
   guardrail's stated purpose is idle/hidden risk ("left it on... fat-fingered
   a stale session"), not "re-tap on every in-page re-render" — forcing a
   re-tap on ordinary continuous trading navigation would be unrequested
   friction that undermines Express's whole reason to exist. Accepted.
3. **Fresh-navigation auto-arm still works.** The same (unchanged) mount
   effect now fires from the outer wrapper on a genuine full navigation to
   `/paper-trading/options` (e.g. clicking "Options" from the equity
   dashboard, or a hard reload) — `enabled && visible` still auto-arms,
   unchanged behavior for that case.
4. **No prop-threading regressions.** `ExpressControls` still takes the same
   `ExpressModeState` shape it always did (unchanged file, `git diff` empty).
   `ExpressFillToast` and `DockedOrderTicket` never consumed `express`
   directly (only `Inner` calls `express.noteActivity()` in their callback
   props) — no shape change needed there. The one-time acknowledgement gate
   (`needsAcknowledgement`/`confirmAcknowledgementAndEnable`) is untouched.
   The `?side=SELL` deep-link path (`handleChainData` →
   `autoSelectedRef`/`setSelectedContract`/`setPresetSide`) never reads
   `express` at all — it's a fully separate code path from
   `handleLadderAction`'s `express.armed` check, so Express has zero
   interference with deep-link ticket pre-fill by construction, before or
   after this fix. `tsc --noEmit` clean (apps/web, exit 0), `eslint` clean
   (exit 0) on the full terminal directory + `options-page-client.tsx`.

**Overall Sprint A verdict: PASS. Deploy unblocked.** No DB/runtime
re-verification needed for this fix (it's a pure client-side state-lifetime
change with no server/DB interaction) — the original pass's live prod-DB
verification of the premium capture pipeline, index intraday, `todayNetPnl`,
deep-link routing, and P1-P3 regression all stand unchanged.
