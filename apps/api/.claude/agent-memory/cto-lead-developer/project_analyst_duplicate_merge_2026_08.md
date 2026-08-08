---
name: project_analyst_duplicate_merge_2026_08
description: Duplicate-Expert merge engine + prevention + shared finance-AI daily cap, built 2026-08-08 off a founder priority brief
metadata:
  type: project
---

Founder priority (verbatim, 2026-08-08): "there are duplicate analysts... same name with
same company are there which does give complete picture and is inconsistent, I first want
to fix that." Root cause: `Expert` has `@@unique([name, organization])`, so any new org
spelling the AI extractor emits for an already-known analyst creates a brand-new row.

**Built three things, all code-complete, dev-verified, NOT pushed to prod (orchestrator's step):**

1. **`apps/api/scripts/merge-duplicate-experts.ts`** — offline merge engine. `dryRun`
   default, `--execute` to write, `--selftest` for pure-logic fixtures (25 assertions,
   no DB), `--json-only`. Classification core lives in
   `apps/api/lib/finance/expertDedup.ts` (`normalizeExpertName`, `orgVariantConfidence`,
   `clusterOrgVariants` — union-find over pairwise org-variant confidence within a
   name-cluster, so a third "bridge" org variant can transitively connect two org
   strings that don't directly match each other). Both the merge script AND the
   extraction-time prevention path (`lib/finance/expertMatch.ts`) import this SAME
   module — they must never diverge on what counts as "the same analyst".

2. **Prevention** — `apps/api/lib/finance/expertMatch.ts#findOrCreateExpert` replaced
   the direct `prisma.expert.upsert()` in `extractExpertOpinions.ts`. Looks up by the
   new indexed `Expert.nameNormalized` column (additive, `@default("")`, migration
   `20260808082958_add_expert_name_normalized`), applies the same org-variant test,
   reuses a confident match WITHOUT overwriting its org string ("stability wins" — a
   single article's spelling isn't a reliable enough signal to keep rewriting a
   profile). Backfill script: `scripts/backfill-expert-name-normalized.ts` (mirrors
   `backfill-expert-slugs.ts` pattern) — ran clean against dev (473 of 480 backfilled,
   7 blank-name source-attribution rows correctly left at `""`).

3. **Shared daily AI cap** — `apps/api/lib/ai/financeAiDailyCap.ts`. The founder's
   batch-size-raise ask ("stay within FINANCE_AI_DAILY_CAP=500") assumed the cap
   already governed the auto-resolve-opinions cron; it didn't — `FINANCE_AI_DAILY_CAP`
   only ever gated `extractExpertOpinions.ts`. `evaluateOpinionResolution.ts#aiCall`
   (used by both preprocess Pass 1 and resolve Pass 3) now shares the exact same
   counter. Cap-reached is surfaced to callers identically to a 429 rate-limit
   (`wasLastCallRateLimited()` returns true) — zero changes needed in the cron route
   or the two standalone scripts, they already skip-without-burning-an-attempt on that
   signal. Deliberately did NOT shrink `CRON_PREPROCESS_LIMIT`/`CRON_RESOLVE_LIMIT`
   (currently 250/120, already safe, already fixed a real starvation bug in July) —
   those bound DB rows scanned, not AI calls; the shared cap is now cadence-agnostic
   safety, valid whether this cron runs 1x/day (current vercel.json) or the founder's
   floated 12x/day (an EC2 crontab change outside this repo — flagged, not made).
   `.env.example`'s `CRON_PREPROCESS_LIMIT=30`/`=25` comments were stale (pre-July-bump)
   — fixed to the real 250/120 defaults; this stale doc is the likely source of the
   founder's "raise to 50/60" math being anchored to the wrong baseline.

**Classifier validated against real dev-DB data (480 experts, 49 same-name clusters),
not just synthetic fixtures** — caught real landmines correctly: two different
well-known "Nilesh Shah"s (Kotak AMC MD vs Envision Capital founder) correctly split
into separate components; "Independent" never auto-matches a named org even for the
exact same name (hard law, explicit in the brief); acronym expansion ("ABSL AMC" vs
"Aditya Birla Sun Life AMC") deliberately NOT attempted — falls to REVIEW, a
documented, accepted limitation rather than a fragile hardcoded acronym dictionary.
37 auto-merge groups, 12 review-only clusters, zero observed false positives on
manual inspection of every one.

**Non-obvious bug caught by real execution, not just the dry run**: updating
canonical's organization to the "best" (longest) variant BEFORE deleting the dupe
rows violates `@@unique([name, organization])` when the best-org string IS literally
one of the dupes' current org values (extremely common — that's WHY it was picked as
best). Fixed by moving the canonical field-update to the end of the per-cluster
transaction, after every dupe is already deleted. Would not have been caught by
`--selftest` (pure logic, no DB) — only surfaced on the actual `--execute` run against
dev.

**Shadow-portfolio conflict handling** (`Portfolio.ownerExpertId` has
`onDelete: Cascade` off `Expert`): if only the dupe owns a SHADOW portfolio, it's
reassigned to canonical. If BOTH already own one, the dupe's is deleted (not hand-
merged) — confirmed by reading `lib/portfolios/shadowGenerator.ts` that shadow
portfolios are fully regenerated from scratch every incremental run
("found-or-created per Expert", transaction list "recomputed from scratch every
run"), so canonical's existing portfolio naturally absorbs the merged-in opinions on
the next `portfolios-shadow` cron run — no manual transaction-history reconciliation
needed or attempted. Verified end-to-end with a synthetic seeded pair (opinion-quote
collision, follow collision, dual-portfolio conflict) in dev, then cleaned up.

**Dev environment gotcha**: `npx prisma migrate dev` currently fails in this sandbox
with P3006 on an OLD unrelated migration (`20260502131955_add_finance_expert_opinions`
— `type "MarketCategory" does not exist` in the shadow DB) — pre-existing, not caused
by this work. There's also a pre-existing `_prisma_migrations` row
(`20260516000001_add_leaderboard_snapshot`) with `finished_at: null`, which is likely
the actual root cause. Worked around via `prisma migrate diff --from-url ... --to-
schema-datamodel ... --script` to generate exact SQL, hand-placed it into a dated
migration folder, applied with `prisma db execute --file`, then recorded it with
`prisma migrate resolve --applied <name>`. Use this same pattern for any future dev
schema change until the underlying shadow-db drift is fixed — flag it to whoever owns
migration hygiene next.

Regression baselines confirmed unchanged: `verify-papertrading-engine.ts` 275/275,
web's `ta:check` 575/575, `tsc --noEmit` clean in both api and web.
