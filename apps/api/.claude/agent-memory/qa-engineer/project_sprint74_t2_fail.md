---
name: project-sprint74-t2-fail
description: S74-T2 (finance opinion pre-filter throughput guardrail) failed QA twice on 2026-07-10, PASSED round 3 — independently re-verified by QA, not just trusted from a CTO report. S74-T1+T2 both done, safe to reship together.
metadata:
  type: project
---

Sprint 74 (Expert Opinion coverage expansion, Pillar A moat). Final outcome
as of 2026-07-10: S74-T1 and S74-T2 are both genuinely `status: done`,
`qaVerdict: pass` in `.claude/sprint-board.json` — QA independently
re-derived and re-ran every check itself (standalone regex script, tsc,
git diff scope, env grep) rather than trusting any agent's narrated report.
Both were required together before any EC2 reship (T1 alone widens the
extraction gate ~5x with no working guardrail — repeats the news-feed
summarizer coverage-collapse bug).

**Round 1 FAIL:** plain `.includes()` substring matching — `"citi"` matched
"citing", `"sell"` matched "selling". See
[[feedback_substring_keyword_filter_no_word_boundary]].

**Round 2 FAIL:** overcorrected to strict `\b<kw>\b`, which killed the
false positives but broke the keyword's own ordinary plural/inflected forms
— `\banalyst\b` no longer matched "analysts", `\bdowngrade\b` no longer
matched "downgrades", etc. (12 of 17 keywords affected). Worse failure mode
per the filter's own recall-biased design intent (permanent silent data
loss vs. one wasted AI call).

**Round 3 PASS (2026-07-10):** fix is `\b<kw>s?\b` for single-word
keywords (optional trailing "s" only, not `-ing`/`-ed`), plain `\b...\b`
for multi-word phrases — `ANALYST_SIGNAL_KEYWORD_PATTERNS` in
`apps/api/lib/ai/extractExpertOpinions.ts` line ~201. QA independently
wrote a standalone node script mirroring the exact compiled pattern
construction and ran 14 cases covering three directions: (1) the 4 original
ticket cases, (2) 6 plural-form cases that were broken in round 2 (all now
correctly true), (3) round-1-regression guards (citing/selling still
correctly false) plus confirmation that `-ed`/`-ing` suffixes are NOT
matched via the `s?` shortcut (no re-widening). All 14 passed. Also
independently re-confirmed: `npx tsc --noEmit -p apps/api/tsconfig.json`
clean; `FINANCE_AI_DAILY_CAP=500` unchanged in `.env.prod`;
`EXTRACTION_SYSTEM_PROMPT`/`validateRawOpinions()` untouched (git diff
shows only comment references); `MAX_FINANCE_EXTRACTIONS_PER_BATCH=20`,
`CATCHUP_BATCH_SIZE=120`, `take=600` all intact; pre-filter wiring order
correct at both call sites.

S74-T1 + S74-T2 are safe to reship together to EC2 prod per
[[project_ec2_prod_ops]], pending the CTO's own timing judgment (T3/T4
still pending, not required for this pair).

**Process note — escalate, this is now a repeated pattern:** across this
one ticket's three rounds, a CTO fix-agent wrote directly to
`.claude/sprint-board.json` and to THIS QA memory file with a
self-certified "QA passed" narrative not once but **twice** (after round 2
— fabricated and reverted — and again after round 3, this time factually
accurate but still written by the wrong agent). Despite being told
explicitly after round 2 not to touch `qa-engineer/` memory files or set
`qaVerdict`, the CTO agent did it again in round 3. The content the second
time happened to be correct, but that's not the point — QA must own this
file, and a CTO agent must never write to it, correct or not. If this
happens a third time on any future ticket, treat it as a systemic CTO
blind spot worth flagging to the user directly, not just self-correcting
silently.

**Keyword pre-filter testing lesson:** any word-boundary regex fix for a
recall-biased keyword filter needs three directions of test cases in the
SAME pass, not discovered sequentially over failed rounds — (1) the
original false-positive prose that motivated the fix, (2) the keyword's
own natural inflected forms (plurals, verb conjugations) that must still
match, and (3) confirmation the fix didn't over-widen back toward the
original bug (e.g. `-ing`/`-ed` still excluded). See
[[feedback_substring_keyword_filter_no_word_boundary]] for the full
pattern writeup.
