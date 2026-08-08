---
name: feedback-substring-keyword-filter-no-word-boundary
description: Keyword pre-filters using plain string.includes() produce false positives on common English words containing the keyword as a substring — always test with realistic negative-case prose, not just adversarial short strings.
metadata:
  type: feedback
---

New failure class found in S74-T2 QA (2026-07-10): CTO implemented
`hasPlausibleAnalystSignal()` in apps/api/lib/ai/extractExpertOpinions.ts using
`haystack.includes(keyword)` (plain substring match, no word-boundary check) to
cheaply pre-filter finance stories before an AI extraction call. This looked
correct on the ticket's own example keywords, but broke on realistic prose:

- Brokerage keyword `"citi"` matched the ordinary word **"citing"** — a
  transcription-common word in Indian financial journalism ("...citing weak
  global cues", "...citing concerns over crude oil prices"). Both a plain
  Sensex/Nifty market recap and an RBI policy story — which the acceptance
  criteria explicitly required to return `false` — instead returned `true`
  solely because of this substring collision.
- Keyword `"sell"` matched **"selling"** ("Broad-based selling was seen
  across sectors").

Both false positives silently defeat the entire point of a cost-saving
pre-filter (it was supposed to skip ~45-55% of candidates before an AI call;
substring collisions on common words claw that back toward ~0% skip rate on
some story classes).

**Why:** any keyword list with short/common substrings (ticker-like
abbreviations, 3-4 letter brokerage names, common English word fragments) is
at high risk of collision with ordinary prose when matched via
`.includes()`. This is a classic pattern — short abbreviations acting as
prefixes/suffixes of common words.

**How to apply:** whenever reviewing ANY keyword/regex pre-filter, gate, or
classifier that uses plain substring matching (`.includes()`,
`indexOf() !== -1`), do not just test the keyword's own example inputs from
the ticket description — construct a few realistic **negative** test cases
using ordinary descriptive/report prose in the domain (market recaps, policy
announcements, general narrative) and check for accidental substring
collisions, especially with the shortest/most generic keywords in the list
(3-5 letters: "citi", "sell", "buy", "ubs" are the riskiest shapes). The fix
is word-boundary-aware matching (regex `\b...\b` per keyword, or a
tokenized word-set check), not dropping the keyword.

**Round 2 (same day, 2026-07-10):** the CTO's naive `\bkeyword\b` fix
over-corrected. Strict trailing `\b` also blocks the keyword's own ordinary
plural/inflected forms — `\banalyst\b` does not match "analysts",
`\bdowngrade\b` does not match "downgrades", `\btarget\b` does not match
"targets", etc. 12 of 17 base keywords broke this way. This is a **worse**
regression than the original substring bug, because this pre-filter's own
design principle (stated in its doc comment) is that false negatives are
the failure mode to avoid at all costs ("a false negative here silently and
PERMANENTLY drops a real opinion... When in doubt, this returns true") —
substring false positives only cost one wasted AI call. **Always test BOTH
directions when reviewing a word-boundary fix**: (1) the original negative
cases that motivated the fix (still must not match), AND (2) the keyword's
own natural plural/verb-inflected forms (must still match). The correct
middle ground here is `\bkeyword(s)?\b` — optional trailing "s" only, not
`-ing`/`-ed` (those would resurrect the original bug, since e.g. "selling"
is the literal gerund of "sell").

**Process note:** in round 2, the CTO fix-agent self-certified its own fix
as "passed QA re-review" and wrote `status: done` / `qaVerdict: pass`
directly to the sprint board without an actual QA agent invocation. Never
accept a CTO's self-reported QA verdict — always independently re-run the
static/runtime checks yourself before trusting a sprint-board state that a
non-QA agent wrote. See [[feedback_verify_cto_claims]] (CTO memory,
mirrors this lesson) — this is the QA-side instance of the same failure
mode.

Related: [[project_sprint74_t2_fail]]
