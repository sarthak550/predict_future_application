---
name: project_analyst_dedup_round2_2026_08_08
description: Round-2 analyst dedup (firm-entity clustering, near-dup names, alias map, entityKind) + firm search/filter on web directory — built and EXECUTED on dev 2026-08-08
metadata:
  type: project
---

Round 2 built on top of [[project_analyst_duplicate_merge_2026_08]] (round 1, same
day). Founder's concrete complaint: "JM Financials and JM Financials Analysis...
technically they both are same but separately named." Root cause found: these are
NOT a name-spelling variant (round 1's whole model) — they're the SAME underlying
"firm as analyst" identity wearing two totally different name strings. Round 1's
clusterer only ever grouped by exact `normalizeExpertName` match first, so two
different name strings for the same firm never even entered the org-comparison step.

**Four new mechanisms, all gated by the founder-confirmed invariant "merge only
when BOTH name AND firm match"** (documented at the top of `expertDedup.ts`):

1. **`Expert.entityKind` (HUMAN | FIRM, additive enum, default HUMAN)** — new
   column, migration `20260808120000_add_expert_entity_kind` (hand-applied via the
   `prisma migrate diff` + `db execute` + `migrate resolve` workaround — same
   shadow-DB-drift issue documented in round 1's memory). Classifier lives in
   `lib/finance/expertEntityKind.ts#classifyExpertEntityKind(name, org, opts)`.
   **Critical bug caught mid-build**: an early version used the FULL
   `orgVariantConfidence` (substring/shared-token) test to detect "name IS its own
   org" — this produced real false positives against founder-eponymous boutique
   firms on real dev data: "Anshul Saigal"/"Saigal Capital", "Ed Yardeni"/"Yardeni
   Research", "Ajay Kedia"/"Kedia Commodities", "Puneet Dalmia"/"Dalmia Bharat",
   "Mark Mobius"/"Mobius Emerging Opportunities Fund", "Sandip Sabharwal"/
   "asksandipsabharwal.com" — all real humans misclassified FIRM because their own
   surname is also their firm's brand token. Fixed by restricting that specific
   rule to EXACT (cosmetic-normalization) identity only (`orgVariantMatch(...).
   reason === "identical"`), never the fuzzy substring/shared-token rules. Final
   dev backfill: 44 FIRM rows (from 435 total), zero observed false positives on
   manual review — "should be small, ~dozens" per founder ask, confirmed.
   `scripts/backfill-expert-entity-kind.ts` (dry-run default, prints the FIRM list
   for review, `--selftest` for 30 pure-logic fixtures) — **executed on dev**.

2. **FIRM-bucket cross-name clustering** (`scripts/merge-duplicate-experts.ts`,
   `buildPlan` pass 1): every `entityKind=FIRM` row in the WHOLE table (not
   grouped by name first) is clustered purely on `orgVariantConfidence` over
   organization strings. This is what makes "JM Financial Analysis" (name≠org
   textually) merge with bare "JM Financial" (name=org) — a firm's name field
   carries no stable identity, unlike a person's.

3. **Near-duplicate PERSON names** (`nameTokenSubset` in `expertDedup.ts` +
   `unionNearDuplicateNameGroups` in the merge script): folds two HUMAN
   name-groups together when one's token set is a subset of the other's (>=2
   tokens each side, unequal lengths) AND at least one cross-group org pair passes
   `orgVariantConfidence`. Guards the "Rahul Shah" ⊂ "Rahul Shah Gupta" landmine
   explicitly (two different real people). No real HUMAN case existed in dev data
   to exercise this end-to-end (only the FIRM-bucket mechanism actually fired on
   real data) — mechanism is selftested but NOT yet observed on a live merge.

4. **Curated firm-alias map** — moved to `packages/business-rules/src/experts/
   firmAliases.ts` (NOT apps/api/lib — needed by both apps/api's dedup engine AND
   apps/web's analyst directory for display canonicalization; apps/web cannot
   import apps/api server code). Two mechanisms: `FIRM_ALIAS_TOKENS` (bare
   acronym word -> full name, expanded INSIDE `expertDedup.ts`'s `tokenizeOrg` so
   ordinary shared-token matching does the rest — composes correctly with
   acronym-plus-real-words strings like "ABSL Mutual Fund") and
   `FIRM_ALIAS_PHRASES` (whole-string phrase aliases like "HDFC Sec" -> "HDFC
   Securities" — "Sec" alone is too generic/dangerous as a bare token, HDFC Sec
   and ICICI Sec are different firms). `canonicalizeOrgDisplay` used at THREE
   points to guarantee "MOFSL never appears next to Motilal Oswal Financial
   Services": (a) `expertMatch.ts` canonicalizes on CREATE of a brand-new expert,
   (b) merge script canonicalizes `bestOrg` at merge time, (c) read-time in
   `apps/web/lib/finance/analysts.ts` and the mobile-facing search/leaderboard API
   routes (belt-and-suspenders for legacy rows).

**`pickBestOrgString` bug found via real --pairs dry-run**: "Independent" (11
chars) is textually LONGER than many real short org names ("ET Now", 6 chars), so
the pure longest-string heuristic would regress a just-merged Swaminathan Aiyar
profile FROM "ET Now" BACK TO "Independent". Fixed: "Independent" is now excluded
from ever winning the comparison against any real alternative (round-1's own hard
law already treats it as a non-informative placeholder for MATCHING; this extends
the same treatment to the best-string PICK).

**`--pairs` mode** added to the merge script for founder/orchestrator-reviewed
manual merges that structurally cannot be auto-caught (Independent-vs-named-org,
career moves). Reads `scripts/data/expert-merge-pairs.json`
(`{canonicalId, dupeIds, note}[]`), reuses the exact same `finalizeGroup` +
`migrateGroup` machinery as the auto-clusterer. Idempotent (already-merged
dupeIds are reported in a `skipped` list, not an error).

**Dedup-against-auto-catch discipline**: of the founder's original 14-pair list,
4 (Raamdeo Agrawal, Rahul Shah, A Balasubramanian, Prateek Agarwal) were fully
auto-caught by the alias-map once entityKind ran, 1 partially (Siddhartha Khemka's
MOFSL/MOSL leg auto-caught, only the Independent leg needed a manual pair). 2 were
found NOT ACTIONABLE on live dev data (Kunal Vora: no "BNP Paribas" row exists,
only "Independent" — single row, nothing to merge; Mahesh M Ojha: single row
exists, no dupe) — founder's brief data had drifted from live dev state; always
re-verify against the live DB before writing a pairs file, don't trust a memo's
counts. Sahil Kapoor's canonical org was determined by LATEST opinion
`publishedAt` per founder's explicit recency rule (DSP Mutual Fund 2026-03-27 >
360 ONE Wealth 2026-03-18), NOT opinion count (360 ONE actually had 5 vs DSP's 4)
— a deliberate override of the usual most-opinions canonical-pick default.

**Web directory (apps/web/app/analysts)**: `/analysts` now filters to
`entityKind: "HUMAN"` only (FIRM entities excluded from the personal-credibility
scorecard — matches the existing "Market Analysis from X" display convention,
publications don't have an individual track record to rank). Firm filter
(`components/finance/analyst-firm-filter.tsx`) is the SAME `router.push`+
`useSearchParams` URL-state idiom as `OpinionsFilterBar` — `?firm=` composes with
the existing `?sort=` param (both preserved across navigation). Since this page
already fetches ALL indexable analysts server-side before slicing to top 100
(no SQL pagination), filtering before that slice was the simplest correct
mechanism — no client re-fetch needed. `[slug]/page.tsx` now branches on
`entityKind`: FIRM profiles get `@type: Organization` JSON-LD (never `Person`),
title "Market Analysis from X", `robots.index: false` always (no personal
credibility score to rank/index), "Recent analysis" not "Recent calls" heading.
Verified live via `npm run dev` + curl (both apps) — SSR filtering, sort-param
composition, and FIRM-profile rendering all confirmed correct on real dev data.
No Playwright/browser tool was available in this environment, so the
client-side `<select onChange>` -> `router.push` wiring itself was NOT exercised
in a real browser — only the resulting SSR'd URL states were curl-verified
(equivalent to what a page refresh would render). Flag for QA's next real-browser
pass if picking this up.

**Mobile**: `apps/mobile/src/app/expert-search.tsx` already searched name OR org
and displayed org (placeholder literally says "Search by name or firm…") —
NO mobile code changes made, per explicit instruction to skip surfaces that
already comply. Only backend changes benefit mobile automatically: `/api/finance/
experts/search` and `/api/finance/experts/leaderboard` (apps/api) now
canonicalize `organization` through the alias map, and the leaderboard route now
excludes `entityKind: FIRM` (same personal-credibility-ranking reasoning as the
web directory).

**Everything executed on DEV, nothing on prod** — orchestrator's step per the
brief's explicit gate. Idempotency double-checked by re-running both the
auto-clusterer and `--pairs --execute` a second time post-execution: 0 groups
processed either time, confirming clean convergence. Final dev state: 0 remaining
auto-mergeable dupes; only the deliberately-excluded review cases remain (Nilesh
Shah — two real different people; Ajit Nayak — thin evidence, left for a human).

Regression baselines confirmed unchanged: `verify-papertrading-engine.ts` 275/275,
web's `ta:check` 575/575, `tsc --noEmit` clean in apps/api AND apps/web,
`--selftest` on both scripts (50 + 30 assertions, up from round 1's 25).
