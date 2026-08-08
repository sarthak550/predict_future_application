---
name: project_analyst_firm_visibility_round3_2026_08_08
description: Round-3 firm visibility — inline "Name · Firm" sweep across web+mobile, web firm links to /analysts?firm=, mobile Firm filter bar (chip row) on search+leaderboard, new /api/finance/experts/firms endpoint — built and dev-verified 2026-08-08
metadata:
  type: project
---

Follows [[project_analyst_dedup_round2_2026_08_08]] (same day). Founder's
concrete complaint: "against the analyst name in the column we can have firm
name as well — let's say we know Karthikraj Lakshmanan is from UTI AMC, it is
only seen if someone clicks on analyst name; what if someone wants to see
other analysts of UTI AMC, we do not have any pipeline for that." Mid-task
coordinator refinement REORDERED priority: "not one click on UTI AMC but
another filter with Analyst where you can filter the firms" — a visible
**Firm filter control** became the primary deliverable, name-click navigation
became optional polish (kept anyway on web since it was trivial there).

**Web audit sweep** — every surface rendering an expert/analyst name was
missing either the firm text entirely or a link on it. Fixed all of:
`/analysts` directory rows, `/analysts/[slug]` profile header (own firm now
links to the filtered directory — this is literally the founder's UTI AMC
scenario), homepage `TopAnalysts` + `LatestGradedCalls` (org was fetched but
never rendered), `BigCallCard`, `/calls/[id]` share page, `/opinions` table
(org wasn't even queried — added to `opinionsQuery.ts`'s `fetchOpinionsPage`),
instrument page's opinions table (same gap, `lib/finance/instrument.ts`),
Market Pulse `top-movers-card.tsx` (same gap, `marketPulse.ts`), and
`calls-traded-list.tsx` / paper-trading "Calls I've traded" (org wasn't even
in the type or the Prisma select in `lib/paperTrading/queries.ts`).

**Shared web helpers** (new): `lib/finance/firmLink.ts#firmHref(org)` builds
`/analysts?firm=<encoded>` — MUST match `/analysts/page.tsx`'s exact
`searchParams?.firm` read (raw canonicalized-org-string equality, NOT a
slug — there is no firm-slug scheme, the param value IS the display string).
`components/finance/firm-link.tsx#FirmLink` wraps that in a `<Link>`, with a
`linkable=false` escape hatch for FIRM-entity ("Market Analysis from X")
attributions where there's no verified human roster to filter to (used on the
profile page only; other FIRM-attribution surfaces were left as a known gap —
verifying "does this firm have human analysts" per render site wasn't done,
noted as a limitation).

**Stretched-link gotcha**: several cards wrap the WHOLE card in a `<Link
href=".../slug">` (directory rows, homepage TopAnalysts) — nesting a second
`<Link>` for the firm inside that is invalid HTML (nested `<a>`, browsers
mis-render/misplace it). Fixed via the standard "stretched link" pattern:
`<Card className="relative">` + `<Link className="absolute inset-0 z-0"
aria-label={name} />` as the default click target, `<CardContent
className="pointer-events-none relative z-10">` so it visually sits on top but
doesn't intercept clicks, then the inner `FirmLink` gets
`pointer-events-auto relative z-20` to reclaim its own click target. Same
pattern needed anywhere else a whole-card profile link wraps content that
should have an independently-clickable sub-link.

**Blank-org-string canonicalization discipline**: every query file that reads
`expert.organization` needed `canonicalizeOrgDisplay()` applied at read time
(belt-and-suspenders, same convention as `analysts.ts`) — `bigCall.ts`,
`opinionsQuery.ts`, `instrument.ts`, `marketPulse.ts`,
`lib/paperTrading/queries.ts` all had RAW organization strings flowing to the
UI before this pass; none of them were canonicalizing.

**Web filter prominence**: `analyst-firm-filter.tsx`'s `<Select>` now has a
visible "Firm" text label (`<label>Firm <Select>...`) — it previously relied
on the closed select showing "All firms" as its only affordance, which reads
as a placeholder more than a labeled control.

**Mobile — the actual gap**: `apps/mobile`'s expert-search and
expert-leaderboard screens already displayed "Name · Org" via the existing
shared `AnalystCredibilityBadge` (nothing to fix there), but had NO firm
filter at all. Built `components/firm-filter-bar.tsx` — a horizontal
scrollable pill/tab row, visually modeled on the existing
`CategoryFilterBar` idiom (same underline-tab treatment already used for
Feed/Markets category filtering, so it reads as "the same kind of control" the
user already knows) but data-driven (`{firm, count}[]` prop) instead of a
fixed enum. "All firms" is always first/default (`ALL_FIRMS` const). Wired
into BOTH `expert-search.tsx` and `expert-leaderboard.tsx` — chose both since
each independently lists experts and the founder said "the expert list"
generically; leaderboard didn't need a query first so was the more natural
fit, search needed a UX change (see below) to make firm-only browsing work at
all.

**Backend for the mobile filter** (new): `GET
/api/finance/experts/firms` (apps/api) returns canonical `{firm, count}[]` —
HUMAN experts with >=1 public opinion, canonicalized + counted, mirrors
`buildFirmOptions` in `apps/web/lib/finance/analysts.ts` so web and mobile
never disagree on what counts as a filterable firm. `experts/search/route.ts`
now accepts `?firm=` and — important UX change — RELAXES its `q.length<2`
gate when a firm is selected, so the mobile search screen can browse a firm's
whole roster with nothing typed (was previously "type 2+ chars or see a hint,"
now "type 2+ chars OR pick a firm"). Firm matching is done POST-fetch against
`canonicalizeOrgDisplay(organization)`, never a raw-column WHERE, because
legacy rows predating the alias map wouldn't raw-match; the search route
widens `take` to 500 when doing a firm-only browse (no text query) since the
firm filter can't be pushed into Prisma's WHERE. `leaderboard/route.ts`
already had an unused `?org=` param wired to a raw exact-match WHERE (dead
code, never exposed in any UI) — fixed to compare canonicalized values and
renamed the primary param to `firm` (`org` kept as a fallback). Also: the
leaderboard's `MIN_THRESHOLD=3` "don't show a sparse leaderboard" gate is
SKIPPED when a firm filter is active — a single firm legitimately having 1-2
qualified analysts is still a meaningful answer, unlike the unfiltered
top-of-market view that gate protects.

**Verified live against real dev data** (both `next dev` servers, not the
stale `next-server` prod-mode process already running on :3002 — see
[[feedback_stale_next_dev_prod_mix]] in the QA memory for why that
distinction matters): `GET /api/finance/experts/firms` returns real firms
incl. "UTI AMC" (count 3); `search?firm=UTI+AMC` with no query returns exactly
Karthikraj Lakshmanan + 3 others from UTI AMC — the founder's literal example,
confirmed working end-to-end. `leaderboard?firm=UTI+AMC` correctly returns
`[]` (none of UTI AMC's analysts are credibility-qualified yet in dev data —
expected, not a bug). Web `/analysts?firm=LKP+Securities` round-trips
correctly (click firm link on an unfiltered card → filtered directory shows
that analyst, no empty state); the directory's OWN firm dropdown is sparse
(only 1 option) because dev data has very few analysts with 5+ graded calls —
expected, matches the pre-existing "indexable" gate, not something this pass
touched. `/opinions`, `/instruments/[symbol]`, `/calls/[id]`,
`/analysts/[slug]` all confirmed rendering real `?firm=` links via curl.
`/pulse` Top Movers analyst-attribution link was NOT observed live (no
currently-qualifying rows in the 14-day lookback against dev data at test
time) — code path mirrors the already-verified opinions/instrument pattern,
type-checked, but not runtime-observed.

**Gates**: `tsc --noEmit` clean in apps/api, apps/web, apps/mobile.
`ta:check` 575/575. `verify-papertrading-engine.ts` 275/275.
`selftest-opinion-attribution.ts` 14/14 (new, see the sibling blank-name-guard
memory). `backfill-expert-entity-kind.ts --selftest` 31/31 (2 new fixtures for
the blank-name branch). ESLint could NOT be run clean end-to-end — apps/api's
`next lint` fails on an UNRELATED pre-existing rule-config error
(`@typescript-eslint/no-explicit-any` not found, in
`app/api/finance/markets/route.ts`, a file this pass never touched) and
apps/mobile's `expo lint` fails on a pre-existing missing `eslint-config-expo`
dependency — both confirmed pre-existing/environmental (also fail on
completely unrelated files / with zero code changes), not caused by this
pass. Flag for whoever next touches the lint toolchain.

**No commits made** — pipeline protocol, work handed back for review/commit
decision.
