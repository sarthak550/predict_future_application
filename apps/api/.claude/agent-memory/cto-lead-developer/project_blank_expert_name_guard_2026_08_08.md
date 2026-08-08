---
name: project_blank_expert_name_guard_2026_08_08
description: Permanent guard against blank-named Expert rows — root cause was persistExpertOpinions falling back to a blank opinion.expertName whenever isSourceAttribution wasn't explicitly true; fixed with two layered guards + a pure selftest-able resolver, 2026-08-08
metadata:
  type: project
---

Founder found opinions with no analyst name in prod. Root cause: 7 legacy
Expert rows had EMPTY name strings (organization present, e.g. "Goldman Sachs
India") — old extraction produced `expertName: ""` with `isSourceAttribution:
false` (should have been `true` but the AI didn't flag it), and
`persistExpertOpinions` (apps/api/lib/ai/extractExpertOpinions.ts) computed
`displayName = opinion.isSourceAttribution ? "<org> Analysis" : opinion.expertName`
— landing on the blank string. `findOrCreateExpert`
(lib/finance/expertMatch.ts) then had a comment-guarded but functionally
silent path: `nameNormalized.length > 0` gated the candidate lookup, but on
`false` it fell straight through to the CREATE block at the bottom with the
blank name intact, `classifyExpertEntityKind` defaulted blank names to HUMAN
("never insult a blank" — a defensible rule for a genuinely blank pair, wrong
when an organization WAS present). Coordinator fixed the 7 existing prod rows
directly (converted to FIRM rows named by their org, isSourceAttribution set,
merged into existing firm entities) and asked for the permanent guard.

**Three-layer fix, all in this same session**:

1. `expertEntityKind.ts#classifyExpertEntityKind` — blank name now classifies
   `FIRM` when an organization is present (attribute to the org), `HUMAN` only
   as a last-resort fallback when BOTH are blank (a shape callers must reject
   before ever reaching the classifier — see layer 3). Old behavior
   (unconditional HUMAN on blank) was the actual root enabler of the bug;
   the "should not happen" comment was disproven by real prod data.

2. `extractExpertOpinions.ts` — new pure exported function
   `resolveOpinionAttribution(expertName, expertOrganization,
   isSourceAttribution)` returns a discriminated union: `{reject: true}` when
   BOTH name and org are blank (counted via `rejectedBlankCount`, logged, the
   opinion is skipped — never written), or `{reject: false, displayName,
   isEffectivelySourceAttribution}` otherwise. Key rule:
   `isEffectivelySourceAttribution = isSourceAttribution === true ||
   !trimmedName` — a blank name ALWAYS forces the source-attribution shape
   (`"<Org> Analysis"` display name), regardless of what the AI's flag said.
   This value now threads through to BOTH `findOrCreateExpert`'s `verified`
   param AND the created `ExpertOpinion.isSourceAttribution` field (previously
   the raw `opinion.isSourceAttribution ?? false` was used in three separate
   places that could have drifted from the corrected value — now one
   computation, reused everywhere in the loop). Extracted as a standalone pure
   function specifically so it's unit-testable without prisma — see
   `scripts/selftest-opinion-attribution.ts` (14 assertions: both guarded
   branches, whitespace-only-counts-as-blank, and two untouched happy paths).
   Note: `validateRawOpinions`'s existing `if (!effectiveOrg) continue;` gate
   ALREADY rejected the both-blank shape upstream in the normal AI pipeline —
   this phase-3 guard is a second, defense-in-depth check directly at the
   write boundary, not the primary catch.

3. `expertMatch.ts#findOrCreateExpert` — hard guard at the top: `if
   (!name.trim()) throw new Error(...)`. This is the PERMANENT stop — even if
   a future caller regresses layer 2's fix, this function now physically
   refuses to create/reuse an Expert with a blank name rather than silently
   falling through to a blank-named create. The existing
   try/catch in `persistExpertOpinions`'s phase-3 loop already logs-and-
   continues on any thrown error, so this reads as "reject, count it via the
   existing failure path, don't write" — consistent with the ask.

**Selftests**: `scripts/selftest-opinion-attribution.ts` (new, 14/14) +
`scripts/backfill-expert-entity-kind.ts --selftest` (2 new fixtures for the
blank-name classifier branch, 31/31 total, up from 29). Both pure/no-DB, run
standalone with `npx tsx`.

Full sweep of `opinion.isSourceAttribution` references in the phase-3
persist loop — all three (Expert verified flag, ExpertOpinion.isSourceAttribution
field, the "Market Analysis from"/"Expert Opinion by" log label) now read
from the single `isEffectivelySourceAttribution` value instead of the raw
flag, closing the drift risk between them.

Landed alongside [[project_analyst_firm_visibility_round3_2026_08_08]] (same
session, same day) — `tsc --noEmit` clean in apps/api, no other regressions
in `ta:check`/engine verify (those don't touch this path). No commits made.
